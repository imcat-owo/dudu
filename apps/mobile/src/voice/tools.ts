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
import { generatePodcastAudio, splitPodcastText } from "./podcast";
import type { TtsConfig } from "./types";

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
 */
export function friendlyPodcastError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (/TTS request failed/i.test(raw)) {
    const detail = raw.replace(/^TTS request failed:\s*/i, "").slice(0, 120);
    return (
      `播客没能生成：连不上她配置的自定义语音服务${detail ? `（${detail}）` : ""}。` +
      `让她检查一下自定义 TTS 的地址和网络，或者换回默认语音再试一次。`
    );
  }
  const http = raw.match(/TTS HTTP (\d+)/i);
  if (http) {
    if (http[1] === "401" || http[1] === "403") {
      return `播客没能生成：自定义语音服务的密钥不对或过期了（HTTP ${http[1]}）。让她去语音设置里检查一下密钥。`;
    }
    return `播客没能生成：自定义语音服务返回了错误（HTTP ${http[1]}）。让她稍后再试，或者换回默认语音。`;
  }
  if (/empty audio/i.test(raw)) {
    return "播客没能生成：语音服务没有返回任何音频。让她换个语音或稍后再试。";
  }
  if (/needs MP3/i.test(raw)) {
    return "播客没能生成：当前语音只能合成非 MP3 格式，拼不成播客文件。让她换一个能出 MP3 的语音（比如默认语音）。";
  }
  if (/edge-tts/i.test(raw)) {
    return "播客没能生成：默认语音服务出了点问题，让她稍后再试一次。";
  }
  if (/empty text/i.test(raw)) {
    return "播客没能生成：要读的文本是空的。让她给我一段文字。";
  }
  return `播客没能生成：${raw.slice(0, 200)}。让她稍后再试，或换个语音。`;
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
 * Build the alarm tool set — let the AI set alarms on request.
 *
 * The native AlarmKit module and expo-notifications are loaded lazily
 * (they don't exist in the node test env).
 */
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

  async function alarmKit() {
    try {
      // expo-modules-core is an optional native dependency — resolve it
      // dynamically so the module stays importable without it (tests).
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const req = (typeof require !== "undefined" ? require : null) as
        | ((id: string) => unknown)
        | null;
      const mod = req
        ? (req("expo-modules-core") as { NativeModulesProxy?: Record<string, unknown> })
        : null;
      const native = mod?.NativeModulesProxy?.DuduAlarmKit as
        | {
            isAvailable(): boolean;
            requestAuthorization(): Promise<boolean>;
            scheduleAlarm(fireAt: number, label: string): Promise<string>;
            cancelAlarm(id: string): Promise<void>;
          }
        | undefined;
      if (!native) return null;
      return {
        isAvailable: () => native.isAvailable(),
        requestAuthorization: () => native.requestAuthorization(),
        scheduleAlarm: (fireAt: number, label: string) => native.scheduleAlarm(fireAt, label),
        cancelAlarm: (id: string) => native.cancelAlarm(id),
        listAlarms: async () => [] as Array<{ id: string; fireAt: number; label: string }>,
      };
    } catch {
      return null;
    }
  }

  async function notifications() {
    try {
      const mod = await import("expo-notifications");
      return {
        requestPermissionsAsync: async () => {
          const r = await mod.requestPermissionsAsync();
          return { granted: r.granted };
        },
        scheduleNotificationAsync: (opts: {
          content: { title: string; body: string; sound: boolean };
          trigger: { type: "date"; date: Date };
        }) =>
          mod.scheduleNotificationAsync({
            content: opts.content,
            // expo-notifications v0.32+: date trigger needs explicit type.
            trigger: { type: mod.SchedulableTriggerInputTypes.DATE, date: opts.trigger.date },
          }),
        cancelScheduledNotificationAsync: (id: string) => mod.cancelScheduledNotificationAsync(id),
      };
    } catch {
      return null;
    }
  }

  const store = createAlarmStore({ backend, alarmKit, notifications });

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
          return t("voice.alarmSetOk") + `（${when}，${alarm.label}）`;
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
            return `- ${when} ${a.label} (id: ${a.id})`;
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
        await store.cancel(id);
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
