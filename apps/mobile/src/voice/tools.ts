/**
 * Podcast / long-audio generation — AI tool. PURE module: no direct
 * React Native / expo imports (lazy inside ./podcast.ts).
 *
 * The tool returns a voice_message JSON string. Include it in your reply —
 * the app detects it and renders a playable WeChat-style voice bubble,
 * even if you add a short intro line around it. Never attach it as a file.
 */

import { type LocalTool, ToolError } from "../api-groups/local-tools.js";
import { enStrings } from "../i18n/en.js";
import { zhHansStrings } from "../i18n/zh-Hans.js";
import { generatePodcastAudio, splitPodcastText } from "./podcast.js";
import type { TtsConfig } from "./types.js";

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
  voiceStore: import("./store.js").VoiceStore,
  taskStore: import("../our-space/task-progress.js").TaskProgressStore,
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

        const taskId = `podcast_${Date.now().toString(36)}`;
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
 * Build the TTS voice tool set — let the AI change the voice on request.
 */
export function createTtsVoiceTools(voiceStore: import("./store.js").VoiceStore): LocalTool[] {
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
        await voiceStore.setTts(next);
        const parts: string[] = [];
        if (voice) parts.push(`voice → ${voice}`);
        if (speed !== null) parts.push(`speed → ${speed}x`);
        return `TTS updated: ${parts.join(", ")}.`;
      },
    },
  ];
}
