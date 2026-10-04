/**
 * Podcast / long-audio generation — AI tool. PURE module: no direct
 * React Native / expo imports (lazy inside ./podcast.ts).
 *
 * The tool returns a voice_message JSON string. The AI must output it
 * VERBATIM as its reply message so chat renders a playable WeChat-style
 * voice bubble — never as a file attachment.
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

export function createPodcastTools(
  voiceStore: import("./store.js").VoiceStore,
  taskStore: import("../our-space/task-progress.js").TaskProgressStore,
  locale: PodcastLocale = "zh-Hans",
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
        "Output that JSON VERBATIM as your entire reply message (no other text around it) so it renders as a " +
        "WeChat-style voice bubble she can tap to play. Never describe it, never attach it as a file.",
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
          throw new ToolError(e instanceof Error ? e.message : "podcast generation failed");
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
