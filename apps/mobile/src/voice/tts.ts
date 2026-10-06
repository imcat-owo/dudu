/**
 * Unified TTS entry point: text → playable audio file.
 *
 * Routes to the configured provider:
 * - edge-tts (default, free, no key): WebSocket protocol in ./edge-tts.ts.
 * - custom: any OpenAI-compatible `POST {url}/audio/speech`
 *   with `{model, input, voice}` returning raw audio bytes.
 *
 * Returns a local file URI playable by expo-audio. Files are cached by
 * content hash so repeat plays of the same text+voice don't re-synthesize.
 */

import { edgeTtsSynthesize } from "./edge-tts";
import { emotionProsody, type VoiceEmotion } from "./emotion";
import {
  type NetworkTtsProvider,
  synthesizeWithProvider,
  toProviderProsody,
} from "./tts-providers";
import type { TtsConfig } from "./types";

export class TtsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TtsError";
  }
}

/** Custom-server timeout: a hanging server must not hang the UI forever. */
const CUSTOM_TTS_TIMEOUT_MS = 60000;

/**
 * POST to the custom TTS endpoint with an abort timeout — RN fetch has no
 * default timeout, so a half-open server would otherwise hang the speak
 * button forever. Exported for tests: the rest of synthesizeCustom needs
 * expo-file-system, which the node test env can't import.
 */
export async function postCustomSpeech(
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CUSTOM_TTS_TIMEOUT_MS);
  try {
    return await fetch(url, { method: "POST", headers, body, signal: controller.signal });
  } catch (e) {
    if ((e as { name?: string } | null)?.name === "AbortError") {
      throw new TtsError(
        `TTS request timed out after ${CUSTOM_TTS_TIMEOUT_MS / 1000}s — the custom server didn't respond`,
      );
    }
    throw new TtsError(`TTS request failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function loadFs() {
  // Legacy API surface (cacheDirectory, writeAsStringAsync, …) — this is
  // the import shape the rest of the app uses (see details.tsx).
  const mod = await import("expo-file-system/legacy");
  return mod as typeof import("expo-file-system/legacy");
}

function hashText(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

async function cacheDir(): Promise<string> {
  const fs = await loadFs();
  const dir = `${fs.cacheDirectory ?? fs.documentDirectory}dudu-tts/`;
  const info = await fs.getInfoAsync(dir);
  if (!info.exists) await fs.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
}

/** Pick a file extension from a response Content-Type (P3-3: don't lie about the format). */
function extForContentType(ct: string | null): string {
  const t = (ct ?? "").toLowerCase();
  if (t.includes("wav")) return "wav";
  if (t.includes("ogg")) return "ogg";
  if (t.includes("flac")) return "flac";
  if (t.includes("m4a") || t.includes("mp4")) return "m4a";
  if (t.includes("webm")) return "webm";
  // mpeg/mp3 and unknown: expo-audio sniffs content anyway, mp3 is the safe default.
  return "mp3";
}

async function writeBytes(bytes: Uint8Array, ext: string): Promise<string> {
  const fs = await loadFs();
  const dir = await cacheDir();
  // base64 via chunked String.fromCharCode (large arrays blow the stack otherwise)
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  // btoa isn't in Hermes — use a manual base64 encoder for the binary string.
  const b64 = base64Encode(binary);
  // P2-17: random suffix — two concurrent syntheses must never share a
  // temp name (Date.now() alone collides within the same millisecond).
  const uri = `${dir}tts_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  await fs.writeAsStringAsync(uri, b64, { encoding: "base64" });
  return uri;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64Encode(binary: string): string {
  let out = "";
  for (let i = 0; i < binary.length; i += 3) {
    const a = binary.charCodeAt(i);
    const b = i + 1 < binary.length ? binary.charCodeAt(i + 1) : 0;
    const c = i + 2 < binary.length ? binary.charCodeAt(i + 2) : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < binary.length ? B64[(n >> 6) & 63] : "=";
    out += i + 2 < binary.length ? B64[n & 63] : "=";
  }
  return out;
}

async function synthesizeEdgeTts(
  text: string,
  voice: string,
  rate = 1.0,
  prosody?: { pitchHz: number; volumePct: number },
): Promise<string> {
  let bytes: Uint8Array;
  try {
    bytes = await edgeTtsSynthesize(text, voice, rate, prosody);
  } catch (e) {
    throw new TtsError(e instanceof Error ? e.message : "edge-tts failed");
  }
  return writeBytes(bytes, "mp3");
}

async function synthesizeNetworkProvider(
  text: string,
  cfg: TtsConfig,
  prosody?: { pitchHz: number; volumePct: number } | null,
): Promise<string> {
  let audio;
  try {
    audio = await synthesizeWithProvider(
      cfg.provider as NetworkTtsProvider,
      text,
      cfg,
      undefined,
      prosody ? toProviderProsody({ rate: cfg.rate ?? 1.0, ...prosody }) : null,
    );
  } catch (e) {
    throw new TtsError(e instanceof Error ? e.message : "TTS provider failed");
  }
  return writeBytes(audio.bytes, audio.ext);
}

async function synthesizeCustom(text: string, cfg: TtsConfig): Promise<string> {
  const url = `${(cfg.customUrl ?? "").trim().replace(/\/+$/, "")}/audio/speech`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = (cfg.customKey ?? "").trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  const res = await postCustomSpeech(
    url,
    headers,
    JSON.stringify({
      model: (cfg.customModel ?? "").trim(),
      input: text,
      voice: cfg.voice,
      // OpenAI-compatible speed: 0.25–4.0. Only send when non-default.
      ...(cfg.rate && cfg.rate !== 1.0 ? { speed: cfg.rate } : {}),
    }),
  );
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new TtsError(`TTS HTTP ${res.status}: ${body}`);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength === 0) throw new TtsError("TTS returned empty audio");
  return writeBytes(new Uint8Array(buf), extForContentType(res.headers.get("content-type")));
}

/**
 * Options for synthesizeSpeech. `emotion` is the resolved emotion (or null
 * for the flat voice). Callers resolve it with resolveSpeakEmotion(); this
 * layer only applies it. Null/omitted = the old behavior, byte for byte.
 */
export interface SynthesizeOptions {
  emotion?: VoiceEmotion | null;
}

/** Effective synthesis parameters for an emotion. Exported for tests. */
export interface EffectiveEmotionParams {
  /** Effective rate: her base speed × emotion rate, clamped to 0.5–2.0. */
  rate: number;
  pitchHz: number;
  volumePct: number;
}

/**
 * Resolve the concrete parameters an emotion produces on her config.
 * Pure — the tests assert these exact numbers reach the synthesizer.
 * Null emotion = flat: her rate untouched, zero pitch/volume delta.
 */
export function resolveEmotionParams(
  cfg: TtsConfig,
  emotion: VoiceEmotion | null,
): EffectiveEmotionParams {
  const base = cfg.rate ?? 1.0;
  if (!emotion) return { rate: base, pitchHz: 0, volumePct: 0 };
  const p = emotionProsody(emotion);
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  return {
    rate: clamp(base * p.rate, 0.5, 2.0),
    pitchHz: clamp(Math.round(p.pitchHz), -50, 50),
    volumePct: clamp(Math.round(p.volumePct), -50, 50),
  };
}

// P2-17: in-flight dedup by cache key. Concurrent syntheses of identical
// text share one network call and one cache-slot write — two racing temps
// can no longer collide, and a corrupt temp can no longer poison the slot
// that's replayed on every future hit.
const inFlightSynth = new Map<string, Promise<string>>();

/**
 * Synthesize text with the given config. Returns a local file URI.
 * Results are cached by (provider, voice, model, rate, emotion params,
 * text hash) — playing the same bubble twice doesn't hit the network
 * twice. The emotion params are part of the key: the same sentence said
 * happy and said sad are different audio and must not share a cache slot.
 */
export async function synthesizeSpeech(
  text: string,
  cfg: TtsConfig,
  opts?: SynthesizeOptions,
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) throw new TtsError("empty text");
  // Strip markdown-ish formatting so the voice doesn't read asterisks.
  const clean = trimmed
    .replace(/```[\s\S]*?```/g, "（代码略）")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
  if (!clean) throw new TtsError("empty text");

  const fs = await loadFs();
  const dir = await cacheDir();
  const ep = resolveEmotionParams(cfg, opts?.emotion ?? null);
  const cacheKey = hashText(
    `${cfg.provider}|${cfg.voice}|${cfg.customModel ?? ""}|${cfg.providerModel ?? ""}|${cfg.providerUrl ?? ""}|${ep.rate.toFixed(3)}|${ep.pitchHz}|${ep.volumePct}|${clean}`,
  );
  // Cache slot lookup: the stored extension follows the actual audio format
  // (sniffed from Content-Type), so scan for any `${cacheKey}.*` — the .mp3
  // fast path covers edge-tts and OpenAI-compatible defaults.
  const findCached = async (): Promise<string | null> => {
    try {
      const info = await fs.getInfoAsync(`${dir}${cacheKey}.mp3`);
      if (info.exists) return `${dir}${cacheKey}.mp3`;
      const names = await fs.readDirectoryAsync(dir);
      const hit = names.find((n) => n.startsWith(`${cacheKey}.`));
      return hit ? `${dir}${hit}` : null;
    } catch {
      return null;
    }
  };
  const hit = await findCached();
  if (hit) return hit;

  // P2-17: share the in-flight synthesis for this cache key.
  const ongoing = inFlightSynth.get(cacheKey);
  if (ongoing) return ongoing;
  const job = (async (): Promise<string> => {
    const emotionCfg: TtsConfig = { ...cfg, rate: ep.rate };
    const emoProsody =
      opts?.emotion != null ? { pitchHz: ep.pitchHz, volumePct: ep.volumePct } : null;
    const uri =
      cfg.provider === "edge-tts"
        ? await synthesizeEdgeTts(clean, cfg.voice, ep.rate, emoProsody ?? undefined)
        : cfg.provider === "custom"
          ? await synthesizeCustom(clean, emotionCfg)
          : await synthesizeNetworkProvider(clean, emotionCfg, emoProsody);
    // Move into the cache slot for next time (best-effort), keeping the real extension.
    const ext = uri.split(".").pop() ?? "mp3";
    const cachedUri = `${dir}${cacheKey}.${ext}`;
    try {
      await fs.moveAsync({ from: uri, to: cachedUri });
      return cachedUri;
    } catch {
      return uri;
    }
  })();
  inFlightSynth.set(cacheKey, job);
  try {
    return await job;
  } finally {
    if (inFlightSynth.get(cacheKey) === job) inFlightSynth.delete(cacheKey);
  }
}
