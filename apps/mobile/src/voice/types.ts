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
 * - "minimax": MiniMax TTS (speech-02-hd etc.), Chinese voices are
 *   excellent. POST {baseUrl}/t2a_v2, SSE with hex audio.
 * - "fish-audio": Fish Audio TTS, great for character voices.
 *   POST {baseUrl}/v1/tts, Bearer + model header, raw audio bytes.
 * - "stepfun": StepFun TTS, OpenAI-compatible /audio/speech.
 * - "qwen": Alibaba DashScope Qwen TTS. POST
 *   {baseUrl}/services/aigc/multimodal-generation/generation, SSE with
 *   base64 PCM audio (converted to WAV).
 */

import type { VoiceEmotion } from "./emotion";

export type TtsProvider =
  | "edge-tts"
  | "custom"
  | "minimax"
  | "fish-audio"
  | "stepfun"
  | "qwen";

export interface TtsConfig {
  provider: TtsProvider;
  /** Voice id. edge-tts: e.g. "zh-CN-XiaoxiaoNeural". custom: provider's voice id. */
  voice: string;
  /** Speech speed multiplier, 0.5 (slow) to 2.0 (fast). 1.0 is normal. */
  rate?: number;
  /** Custom provider only: base URL, e.g. https://api.openai.com/v1 (no trailing slash). */
  customUrl?: string;
  /** Custom provider only: secret, SecureStore-backed. */
  customKey?: string;
  /** Custom provider only: model id sent as `model`, e.g. "tts-1". */
  customModel?: string;
  /**
   * API key for minimax/fish-audio/stepfun/qwen. SecureStore-backed
   * (the whole TtsConfig lives in SecureStore — see ./store.ts).
   */
  providerKey?: string;
  /** Base URL override for minimax/fish-audio/stepfun/qwen. Defaults per provider. */
  providerUrl?: string;
  /** Model id for minimax/fish-audio/stepfun/qwen. Defaults per provider. */
  providerModel?: string;
}

export const EDGE_TTS_DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";

/** Default base URLs per provider (user can override). */
export const TTS_PROVIDER_DEFAULTS: Record<
  Exclude<TtsProvider, "edge-tts" | "custom">,
  { baseUrl: string; model: string }
> = {
  minimax: { baseUrl: "https://api.minimaxi.com/v1", model: "speech-2.8-turbo" },
  "fish-audio": { baseUrl: "https://api.fish.audio", model: "s2.1-pro" },
  stepfun: { baseUrl: "https://api.stepfun.com/v1", model: "stepaudio-2.5-tts" },
  qwen: { baseUrl: "https://dashscope.aliyuncs.com/api/v1", model: "qwen3-tts-flash" },
};

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
  | "voiceRequired"
  | "ttsKeyRequired";
export function validateTtsConfig(c: TtsConfig): TtsValidationProblem | null {
  if (c.provider === "edge-tts") {
    if (!c.voice.trim()) return "voiceRequired";
    return null;
  }
  if (c.provider === "custom") {
    const url = (c.customUrl ?? "").trim().replace(/\/+$/, "");
    if (!url) return "ttsUrlRequired";
    if (!/^https?:\/\//i.test(url)) return "ttsUrlInvalid";
    if (!(c.customModel ?? "").trim()) return "ttsModelRequired";
    if (!(c.voice ?? "").trim()) return "voiceRequired";
    return null;
  }
  // minimax / fish-audio / stepfun / qwen: key required, URL/model optional (have defaults).
  if (!(c.providerKey ?? "").trim()) return "ttsKeyRequired";
  const url = (c.providerUrl ?? "").trim();
  if (url && !/^https?:\/\//i.test(url)) return "ttsUrlInvalid";
  return null;
}

export type SttProvider = "group" | "custom" | "dashscope" | "stepfun";

export interface SttConfig {
  /**
   * "group": use the active API group's OpenAI-compatible
   * `/audio/transcriptions` endpoint (same base URL + key).
   * "custom": a dedicated STT endpoint the user fills in.
   * "dashscope": Alibaba Bailian (DashScope) OpenAI-compatible endpoint —
   *   good Chinese/dialect accuracy, user fills key + optional model.
   * "stepfun": StepFun OpenAI-compatible endpoint — user fills key.
   */
  provider: SttProvider;
  customUrl?: string;
  customKey?: string;
  customModel?: string;
  /** API key for dashscope/stepfun presets. SecureStore-backed. */
  presetKey?: string;
  /** Model override for dashscope/stepfun presets. Defaults per preset. */
  presetModel?: string;
}

/** Defaults for the STT presets. */
export const STT_PRESET_DEFAULTS: Record<
  Exclude<SttProvider, "group" | "custom">,
  { baseUrl: string; model: string }
> = {
  dashscope: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen3-asr-flash",
  },
  stepfun: { baseUrl: "https://api.stepfun.com/v1", model: "stepaudio-2.5-asr" },
};

export function blankSttConfig(): SttConfig {
  return { provider: "group" };
}

export type SttValidationProblem =
  | "sttUrlRequired"
  | "sttUrlInvalid"
  | "sttModelRequired"
  | "sttKeyRequired";
export function validateSttConfig(c: SttConfig): SttValidationProblem | null {
  if (c.provider === "group") return null;
  if (c.provider === "custom") {
    const url = (c.customUrl ?? "").trim().replace(/\/+$/, "");
    if (!url) return "sttUrlRequired";
    if (!/^https?:\/\//i.test(url)) return "sttUrlInvalid";
    if (!(c.customModel ?? "").trim()) return "sttModelRequired";
    return null;
  }
  // dashscope / stepfun presets: key required.
  if (!(c.presetKey ?? "").trim()) return "sttKeyRequired";
  return null;
}

/** What the mic button does when the user records. */
export type MicMode = "voice-message" | "transcribe";

export interface VoiceSettings {
  micMode: MicMode;
  /**
   * Auto-read AI replies: when true, each finished AI message is
   * synthesized and played automatically. Default false — it's
   * opt-in because it spends TTS quota on every reply.
   */
  autoRead: boolean;
  /**
   * Emotional TTS: his voice follows the message's emotion (rate/pitch/
   * volume per emotion, see ./emotion.ts). Default true — her voice brief
   * already describes an emotional voice ("轻重快慢随情绪变化，不平铺直叙").
   * Off = the old flat voice, byte for byte.
   */
  emotionalTts: boolean;
  /**
   * Pinned tone for every synthesis, or null = auto (follow the words).
   * Her pin beats auto-classification; the AI's per-message explicit
   * emotion beats the pin.
   */
  emotionPin: VoiceEmotion | null;
}

export function defaultVoiceSettings(): VoiceSettings {
  // Transcribe by default: "recording must not be decorative" — the AI
  // should hear what the user says. Voice messages stay one toggle away.
  return { micMode: "transcribe", autoRead: false, emotionalTts: true, emotionPin: null };
}
