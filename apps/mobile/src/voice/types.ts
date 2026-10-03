/**
 * Voice configuration model: TTS + STT + mic behavior.
 *
 * The user fills everything herself — nothing is pre-provisioned and
 * nothing ever enters the repo (open source). Secrets (TTS/STT keys)
 * live in expo-secure-store via ./store.ts; everything else is in
 * AsyncStorage.
 *
 * TTS providers:
 * - "edge-tts": Microsoft's free neural voices, no key needed. Built-in
 *   default because it's free and the Chinese voices are high quality.
 *   Implemented in ./edge-tts.ts (WebSocket protocol).
 * - "custom": any OpenAI-compatible `/audio/speech` endpoint — the user
 *   fills URL + key + model + voice herself.
 */

export type TtsProvider = "edge-tts" | "custom";

export interface TtsConfig {
  provider: TtsProvider;
  /** Voice id. edge-tts: e.g. "zh-CN-XiaoxiaoNeural". custom: provider's voice id. */
  voice: string;
  /** Custom provider only: base URL, e.g. https://api.openai.com/v1 (no trailing slash). */
  customUrl?: string;
  /** Custom provider only: secret, SecureStore-backed. */
  customKey?: string;
  /** Custom provider only: model id sent as `model`, e.g. "tts-1". */
  customModel?: string;
}

export const EDGE_TTS_DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";

/** A few curated high-quality Chinese voices for the picker. */
export const EDGE_TTS_CHINESE_VOICES: Array<{ id: string; label: string }> = [
  { id: "zh-CN-XiaoxiaoNeural", label: "晓晓（女声，亲切）" },
  { id: "zh-CN-XiaoyiNeural", label: "晓伊（女声，活泼）" },
  { id: "zh-CN-YunjianNeural", label: "云健（男声，沉稳）" },
  { id: "zh-CN-YunxiNeural", label: "云希（男声，年轻）" },
  { id: "zh-CN-YunyangNeural", label: "云扬（男声，专业）" },
  { id: "zh-CN-XiaochenNeural", label: "晓辰（女声，温柔）" },
];

export function blankTtsConfig(): TtsConfig {
  return { provider: "edge-tts", voice: EDGE_TTS_DEFAULT_VOICE };
}

/** User-facing validation — returns the first problem key, or null when valid. */
export type TtsValidationProblem =
  | "ttsUrlRequired"
  | "ttsUrlInvalid"
  | "ttsModelRequired"
  | "voiceRequired";
export function validateTtsConfig(c: TtsConfig): TtsValidationProblem | null {
  if (c.provider === "edge-tts") {
    if (!c.voice.trim()) return "voiceRequired";
    return null;
  }
  const url = (c.customUrl ?? "").trim().replace(/\/+$/, "");
  if (!url) return "ttsUrlRequired";
  if (!/^https?:\/\//i.test(url)) return "ttsUrlInvalid";
  if (!(c.customModel ?? "").trim()) return "ttsModelRequired";
  if (!(c.voice ?? "").trim()) return "voiceRequired";
  return null;
}

export type SttProvider = "group" | "custom";

export interface SttConfig {
  /**
   * "group": use the active API group's OpenAI-compatible
   * `/audio/transcriptions` endpoint (same base URL + key).
   * "custom": a dedicated STT endpoint the user fills in.
   */
  provider: SttProvider;
  customUrl?: string;
  customKey?: string;
  customModel?: string;
}

export function blankSttConfig(): SttConfig {
  return { provider: "group" };
}

export type SttValidationProblem =
  | "sttUrlRequired"
  | "sttUrlInvalid"
  | "sttModelRequired";
export function validateSttConfig(c: SttConfig): SttValidationProblem | null {
  if (c.provider === "group") return null;
  const url = (c.customUrl ?? "").trim().replace(/\/+$/, "");
  if (!url) return "sttUrlRequired";
  if (!/^https?:\/\//i.test(url)) return "sttUrlInvalid";
  if (!(c.customModel ?? "").trim()) return "sttModelRequired";
  return null;
}

/** What the mic button does when the user records. */
export type MicMode = "voice-message" | "transcribe";

export interface VoiceSettings {
  micMode: MicMode;
}

export function defaultVoiceSettings(): VoiceSettings {
  // Transcribe by default: "recording must not be decorative" — the AI
  // should hear what the user says. Voice messages stay one toggle away.
  return { micMode: "transcribe" };
}
