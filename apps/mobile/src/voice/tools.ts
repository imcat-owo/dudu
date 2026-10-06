/**
 * Podcast / long-audio generation — AI tool. PURE module: no direct
 * React Native / expo imports (lazy inside ./podcast.ts).
 *
 * The tool returns a voice_message JSON string. Include it in your reply —
 * the app detects it and renders a playable WeChat-style voice bubble,
 * even if you add a short intro line around it. Never attach it as a file.
 */

import { type LocalTool, ToolError } from "../api-groups/local-tools";
import { enStrings } from "../i18n/en";
import { zhHansStrings } from "../i18n/zh-Hans";
import { type AlarmBackend, createAlarmStore } from "./alarms";
import { loadAlarmKitNative, loadNotificationsNative } from "./alarms-instance";
import { resolveSpeakEmotion, VOICE_EMOTIONS, type VoiceEmotion } from "./emotion";
import { estimateDurationFromText, generatePodcastAudio, splitPodcastText } from "./podcast";
import { type SynthesizeOptions, synthesizeSpeech } from "./tts";
import { defaultVoiceSettings, type TtsConfig } from "./types";
import { persistVoiceMessage } from "./voice-message-files";

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

/** Same envelope chat.tsx parses into a VoiceBubble — no RN imports needed. */
function encodeVoiceMessage(uri: string, duration: number): string {
  return JSON.stringify({ type: "voice_message", uri, duration });
}

export type PodcastLocale = "zh-Hans" | "en";

/**
 * Tiny pure i18n for tool-written task-card strings. The full t() lives in
 * ../i18n/index.js but pulls in react — these string tables are pure.
 */
function pickStrings(locale: PodcastLocale) {
  const pack = locale === "en" ? enStrings : zhHansStrings;
  return {
    stage: (done: number, total: number) =>
      (pack["voice.podcast.stage"] as string)
        .replace("{done}", String(done))
        .replace("{total}", String(total)),
    failed: pack["voice.podcast.failed"] as string,
    defaultTitle: pack["voice.podcast.defaultTitle"] as string,
  };
}

/**
 * Translate raw TTS/podcast failures into something she can act on.
 * Custom-TTS errors arrive as English technical strings ("TTS HTTP 401: …");
 * relaying them verbatim reads as gibberish to her. This maps the common
 * cases to plain Chinese with a concrete next step. (P2-4)
 * `what` names the thing that failed ("播客" for podcast, "语音" for a
 * short voice message) so the message doesn't blame the wrong feature.
 */
export function friendlyPodcastError(e: unknown, what = "播客"): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (/TTS request failed/i.test(raw)) {
    const detail = raw.replace(/^TTS request failed:\s*/i, "").slice(0, 120);
    return (
      `${what}没能生成：连不上她配置的自定义语音服务${detail ? `（${detail}）` : ""}。` +
      `让她检查一下自定义 TTS 的地址和网络，或者换回默认语音再试一次。`
    );
  }
  const http = raw.match(/TTS HTTP (\d+)/i);
  if (http) {
    if (http[1] === "401" || http[1] === "403") {
      return `${what}没能生成：自定义语音服务的密钥不对或过期了（HTTP ${http[1]}）。让她去语音设置里检查一下密钥。`;
    }
    return `${what}没能生成：自定义语音服务返回了错误（HTTP ${http[1]}）。让她稍后再试，或者换回默认语音。`;
  }
  if (/empty audio/i.test(raw)) {
    return `${what}没能生成：语音服务没有返回任何音频。让她换个语音或稍后再试。`;
  }
  if (/needs MP3/i.test(raw)) {
    return `${what}没能生成：当前语音只能合成非 MP3 格式，拼不成播客文件。让她换一个能出 MP3 的语音（比如默认语音）。`;
  }
  if (/edge-tts/i.test(raw)) {
    return `${what}没能生成：默认语音服务出了点问题，让她稍后再试一次。`;
  }
  if (/empty text/i.test(raw)) {
    return `${what}没能生成：要读的文本是空的。让她给我一段文字。`;
  }
  return `${what}没能生成：${raw.slice(0, 200)}。让她稍后再试，或换个语音。`;
}

export function createPodcastTools(
  voiceStore: import("./store").VoiceStore,
  taskStore: import("../our-space/task-progress").TaskProgressStore,
  locale: PodcastLocale = "zh-Hans",
  opts?: { isIncognito?: () => boolean },
): LocalTool[] {
  const s = pickStrings(locale);
  return [
    {
      name: "generate_podcast",
      description:
        "Generate long-form spoken audio (podcast-style) from text and return it as a playable voice bubble. " +
        "Use when she asks you to read something aloud at length, make her a bedtime story, a morning briefing, " +
        "or any text too long for a single TTS call — the tool splits it into segments, synthesizes each, and " +
        "joins them into one audio file. " +
        "IMPORTANT: the tool returns a JSON string like " +
        '{"type":"voice_message","uri":"file:///...","duration":123}. ' +
        "Include that JSON in your reply (a short intro line is fine — the app finds it and renders " +
        "a WeChat-style voice bubble she can tap to play). Never describe it, never attach it as a file.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description:
              "Full text to speak. Plain prose reads best — markdown is stripped automatically.",
          },
          title: {
            type: "string",
            description:
              "Short title shown on the progress card while generating, e.g. '晚安故事'.",
          },
          voice: {
            type: "string",
            description:
              "Optional voice id override for this generation only (edge-tts voice id, e.g. 'zh-CN-XiaoxiaoNeural'). Empty = her configured TTS voice.",
          },
        },
        required: ["text"],
        additionalProperties: false,
      },
      manualId: "voice",
      run: async (args) => {
        const text = strArg(args, "text");
        if (!text.trim()) throw new ToolError("text is required.");
        const title = strArg(args, "title") || s.defaultTitle;
        const voiceOverride = strArg(args, "voice").trim();

        const cfg: TtsConfig = voiceStore.getSnapshot().tts;
        const ttsCfg: TtsConfig = voiceOverride ? { ...cfg, voice: voiceOverride } : cfg;

        const segments = splitPodcastText(text);
        if (segments.length === 0) throw new ToolError("text is empty.");

        // P3-17: random suffix — same-millisecond generations must not collide.
        const taskId = `podcast_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        await taskStore.upsert({
          id: taskId,
          name: title,
          progress: 0,
          stage: s.stage(0, segments.length),
          status: "running",
          backgroundUri: null,
        });
        await taskStore.saveIndex();

        try {
          const { uri, durationSec } = await generatePodcastAudio(
            text,
            ttsCfg,
            async (done, total) => {
              await taskStore.upsert({
                id: taskId,
                name: title,
                progress: done / total,
                stage: s.stage(done, total),
                status: "running",
                backgroundUri: null,
              });
            },
            // Incognito: the audio file goes to cache (temp), not documents.
            { ephemeral: opts?.isIncognito?.() === true },
          );
          await taskStore.remove(taskId);
          await taskStore.saveIndex();
          return encodeVoiceMessage(uri, durationSec);
        } catch (e) {
          await taskStore.upsert({
            id: taskId,
            name: title,
            progress: 0,
            stage: s.failed,
            status: "stuck",
            backgroundUri: null,
          });
          await taskStore.saveIndex();
          throw new ToolError(friendlyPodcastError(e));
        }
      },
    },
  ];
}

/**
 * Build the short-voice-message tool set — let the AI send her a ~10s
 * WeChat/QQ-style voice bubble on request ("给我发条语音").
 *
 * Unlike generate_podcast (long-form, task-progress card, MP3 join), this
 * is one TTS call → stable file → voice_message envelope. The envelope is
 * the same one chat.tsx parses into a VoiceBubble, so playback reuses the
 * existing bubble player — nothing new to render or play.
 */

/** Max chars for a voice note (~10s of speech at ~5 CJK chars/sec, with
 *  headroom). Longer text belongs in generate_podcast. */
export const MAX_VOICE_MESSAGE_CHARS = 100;

export interface VoiceMessageToolDeps {
  synthesize: (text: string, cfg: TtsConfig, opts?: SynthesizeOptions) => Promise<string>;
  /** Copy the synthesized file into stable voice-message storage. */
  persist: (srcUri: string) => Promise<string>;
  estimateDuration: (text: string) => number;
}

/**
 * Core pipeline, deps-injected so tests can run it without network/audio.
 * Returns the voice_message JSON string chat.tsx renders as a VoiceBubble.
 */
export async function makeVoiceMessage(
  text: string,
  cfg: TtsConfig,
  deps: VoiceMessageToolDeps,
  opts?: { emotion?: VoiceEmotion | null },
): Promise<string> {
  const clean = text.trim();
  if (!clean) throw new ToolError("text is required.");
  if (clean.length > MAX_VOICE_MESSAGE_CHARS) {
    throw new ToolError(
      `text is too long for a voice message (${clean.length} > ${MAX_VOICE_MESSAGE_CHARS} chars). ` +
        "Use generate_podcast for anything longer than a sentence or two.",
    );
  }
  let uri: string;
  try {
    uri = await deps.synthesize(clean, cfg, { emotion: opts?.emotion ?? null });
  } catch (e) {
    throw new ToolError(friendlyPodcastError(e, "语音"));
  }
  const stable = await deps.persist(uri);
  const duration = Math.max(1, Math.round(deps.estimateDuration(clean)));
  return encodeVoiceMessage(stable, duration);
}

export function createVoiceMessageTools(
  voiceStore: import("./store").VoiceStore,
  locale: PodcastLocale = "zh-Hans",
  opts?: { isIncognito?: () => boolean; deps?: Partial<VoiceMessageToolDeps> },
): LocalTool[] {
  // Locale is accepted for symmetry with createPodcastTools; user-facing
  // strings here go through the shared friendly-error path.
  void locale;
  return [
    {
      name: "speak_as_voice",
      description:
        "Send her a SHORT voice message (WeChat/QQ-style voice bubble, ~10 seconds). " +
        "Use when she says '给我发条语音' / '发条语音' / '用语音跟我说', or when a short spoken " +
        "reply fits better than text — a quick goodnight, a one-line answer, a short sweet nothing. " +
        "text must be SHORT: one or two sentences, max 100 characters. For anything longer " +
        "(stories, briefings, paragraphs), use generate_podcast instead. " +
        "EMOTION: his voice follows the feeling of the words. Pass emotion to set the tone " +
        "explicitly (happy, excited, gentle, sad, playful, calm, serious) — omit it and the " +
        "tone is classified from the text automatically. Her pinned tone (if she set one) " +
        "beats auto-classification; turning her 情绪化语音 switch off makes it flat. " +
        "The tool returns a JSON string like " +
        '{"type":"voice_message","uri":"file:///...","duration":8}. ' +
        "Include that JSON in your reply (a short intro line is fine — the app finds it and renders " +
        "a WeChat-style voice bubble she can tap to play). Never describe it, never attach it as a file.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description:
              "Short text to speak — one or two sentences, max 100 characters. Plain prose; markdown is stripped.",
          },
          emotion: {
            type: "string",
            description:
              "Optional tone for this message: one of " +
              VOICE_EMOTIONS.join(", ") +
              ". Omit for auto — the tone follows the words.",
          },
        },
        required: ["text"],
        additionalProperties: false,
      },
      manualId: "voice",
      run: async (args) => {
        const text = strArg(args, "text");
        const emotionArg = strArg(args, "emotion").trim() || null;
        const cfg: TtsConfig = voiceStore.getSnapshot().tts;
        // Old test fakes return no settings — fall back to defaults.
        const settings = voiceStore.getSnapshot().settings ?? defaultVoiceSettings();
        const emotion = resolveSpeakEmotion(
          text,
          {
            emotionalTts: settings.emotionalTts ?? true,
            emotionPin: settings.emotionPin ?? null,
          },
          emotionArg,
        );
        const ephemeral = opts?.isIncognito?.() === true;
        const deps: VoiceMessageToolDeps = {
          synthesize: synthesizeSpeech,
          // Incognito: skip the durable copy — same rule as her recorded
          // voice notes (chat.tsx): the temp URI plays fine in-session and
          // nothing durable is left on disk.
          persist: ephemeral ? async (u) => u : persistVoiceMessage,
          estimateDuration: estimateDurationFromText,
          ...opts?.deps,
        };
        return makeVoiceMessage(text, cfg, deps, { emotion });
      },
    },
  ];
}

/**
 * Build the alarm tool set — let the AI set alarms on request.
 *
 * The native AlarmKit module and expo-notifications are loaded lazily
 * (they don't exist in the node test env).
 */
/**
 * D34: honest result copy — a scheduled-notification fallback is not a
 * system alarm, so it must not claim "闹钟定好了，到点叫你".
 */
export function alarmSetOkKey(viaAlarmKit: boolean): string {
  return viaAlarmKit ? "voice.alarmSetOk" : "voice.alarmSetOkNotif";
}

export function createAlarmTools(
  backend: AlarmBackend,
  locale: PodcastLocale = "zh-Hans",
): LocalTool[] {
  const strings: Record<string, string> =
    locale === "en"
      ? (enStrings as unknown as Record<string, string>)
      : (zhHansStrings as unknown as Record<string, string>);
  const t = (key: string, vars?: Record<string, string>): string => {
    let s = strings[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
    }
    return s;
  };

  const store = createAlarmStore({
    backend,
    alarmKit: loadAlarmKitNative,
    notifications: loadNotificationsNative,
  });

  return [
    {
      name: "set_alarm",
      description:
        "Set an alarm that rings at a specific time. Use when she says " +
        "'明天 7 点叫我' / '定个闹钟' / '提醒我'. The alarm uses iOS AlarmKit " +
        "(system alarm UI) when available, otherwise a scheduled notification. " +
        "fireAt is an ISO 8601 datetime with timezone, e.g. '2026-10-06T07:00:00+08:00'. " +
        "Always confirm what was set in your reply.",
      parameters: {
        type: "object",
        properties: {
          fireAt: {
            type: "string",
            description:
              "ISO 8601 datetime with timezone offset, e.g. '2026-10-06T07:00:00+08:00'.",
          },
          label: {
            type: "string",
            description: "Short label, e.g. '起床'. Defaults to '闹钟'.",
          },
        },
        required: ["fireAt"],
        additionalProperties: false,
      },
      manualId: "voice",
      run: async (args) => {
        const fireAtRaw = strArg(args, "fireAt").trim();
        const label = strArg(args, "label").trim() || t("voice.alarmSet");
        if (!fireAtRaw) throw new ToolError("fireAt is required.");
        const fireAt = Date.parse(fireAtRaw);
        if (!Number.isFinite(fireAt)) {
          throw new ToolError(`Cannot parse fireAt as a date: ${fireAtRaw}`);
        }
        try {
          const alarm = await store.schedule(fireAt, label);
          const d = new Date(alarm.fireAt);
          const when = `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
          // D34: be honest about what was actually scheduled — a
          // notification fallback is not a system alarm.
          return t(alarmSetOkKey(alarm.viaAlarmKit)) + `（${when}，${alarm.label}）`;
        } catch (e) {
          throw new ToolError(
            t("voice.alarmSetFail", { msg: e instanceof Error ? e.message : String(e) }),
          );
        }
      },
    },
    {
      name: "list_alarms",
      description: "List upcoming alarms. Use when she asks '我定了哪些闹钟'.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "voice",
      run: async () => {
        const alarms = await store.list();
        if (!alarms.length) return t("voice.alarmEmpty");
        return alarms
          .map((a) => {
            const d = new Date(a.fireAt);
            const when = `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
            // Disabled alarms stay in the list (she manages them in
            // settings) — mark them so the model doesn't call them upcoming.
            const off = a.enabled === false ? ` (${t("voice.alarmOff")})` : "";
            return `- ${when} ${a.label}${off} (id: ${a.id})`;
          })
          .join("\n");
      },
    },
    {
      name: "cancel_alarm",
      description: "Cancel an alarm by id (see list_alarms). Use when she says '把那个闹钟删了'.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Alarm id from list_alarms." },
        },
        required: ["id"],
        additionalProperties: false,
      },
      manualId: "voice",
      run: async (args) => {
        const id = strArg(args, "id").trim();
        if (!id) throw new ToolError("id is required.");
        // D33: store.cancel throws on unknown ids — surface it honestly
        // instead of reporting a phantom success.
        try {
          await store.cancel(id);
        } catch (e) {
          throw new ToolError(
            t("voice.alarmDeleteFail", { msg: e instanceof Error ? e.message : String(e) }),
          );
        }
        return t("voice.alarmDelete") + " done.";
      },
    },
  ];
}
/**
 * Build the TTS voice tool set — let the AI change the voice on request.
 */
export function createTtsVoiceTools(voiceStore: import("./store").VoiceStore): LocalTool[] {
  return [
    {
      name: "set_tts_voice",
      description:
        "Change the text-to-speech voice. Use when she says '换个声音' / '换个好听的声音' / '声音太快了'. voice is the voice id (e.g. 'zh-CN-XiaoxiaoNeural' for edge-tts, or a voice id from her custom provider). Leave voice empty to keep the current voice and only change speed.",
      parameters: {
        type: "object",
        properties: {
          voice: {
            type: "string",
            description:
              "Voice id, e.g. 'zh-CN-XiaoxiaoNeural'. Empty string keeps the current voice.",
          },
          speed: {
            type: "number",
            description:
              "Speech speed multiplier, 0.5 (slow) to 2.0 (fast). 1.0 is normal. Omit to keep current.",
          },
        },
        additionalProperties: false,
      },
      manualId: "voice",
      run: async (args) => {
        const voice = strArg(args, "voice").trim();
        const speedRaw = args.speed;
        const speed =
          typeof speedRaw === "number" && Number.isFinite(speedRaw)
            ? Math.min(2.0, Math.max(0.5, speedRaw))
            : null;
        if (!voice && speed === null) {
          throw new ToolError("provide a voice id, a speed, or both.");
        }
        const snap = voiceStore.getSnapshot();
        const next: TtsConfig = { ...snap.tts };
        if (voice) next.voice = voice;
        if (speed !== null) next.rate = speed;
        const saved = await voiceStore.setTts(next);
        if (!saved) {
          throw new ToolError(
            "The TTS setting could not be saved (storage write failed). Tell her honestly the change didn't stick and ask her to try again from settings.",
          );
        }
        const parts: string[] = [];
        if (voice) parts.push(`voice → ${voice}`);
        if (speed !== null) parts.push(`speed → ${speed}x`);
        return `TTS updated: ${parts.join(", ")}.`;
      },
    },
  ];
}
