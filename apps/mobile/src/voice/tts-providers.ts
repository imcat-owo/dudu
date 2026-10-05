/**
 * Network TTS providers: MiniMax, Fish Audio, StepFun, Qwen (DashScope).
 *
 * API shapes learned from Kelivo's actual implementation
 * (lib/core/services/tts/network_tts.dart) — not invented:
 * - MiniMax: POST {baseUrl}/t2a_v2, SSE stream, hex-encoded audio chunks.
 * - Fish Audio: POST {baseUrl}/v1/tts, Bearer + `model` header, raw bytes.
 * - StepFun: POST {baseUrl}/audio/speech, OpenAI-compatible, raw bytes.
 * - Qwen: POST {baseUrl}/services/aigc/multimodal-generation/generation,
 *   SSE stream, base64 PCM chunks → wrapped as WAV.
 *
 * PURE module: no React Native / expo imports (fetch is global in RN).
 * All functions take explicit params so tests can inject a mock fetch.
 */

import { TTS_PROVIDER_DEFAULTS, type TtsConfig, type TtsProvider } from "./types.js";

export class TtsProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TtsProviderError";
  }
}

export type NetworkTtsProvider = Exclude<TtsProvider, "edge-tts" | "custom">;

const PROVIDER_TIMEOUT_MS = 60000;

export interface ProviderCredentials {
  apiKey: string;
  baseUrl: string;
  model: string;
  voice: string;
  rate: number;
}

/** Resolve effective credentials: user override or provider default. */
export function resolveProviderCredentials(cfg: TtsConfig): ProviderCredentials {
  const provider = cfg.provider as NetworkTtsProvider;
  const defaults = TTS_PROVIDER_DEFAULTS[provider];
  return {
    apiKey: (cfg.providerKey ?? "").trim(),
    baseUrl: (cfg.providerUrl ?? "").trim() || defaults.baseUrl,
    model: (cfg.providerModel ?? "").trim() || defaults.model,
    voice: (cfg.voice ?? "").trim(),
    rate: cfg.rate ?? 1.0,
  };
}

async function postWithTimeout(
  url: string,
  headers: Record<string, string>,
  body: string,
  label: string,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await fetchFn(url, { method: "POST", headers, body, signal: controller.signal });
  } catch (e) {
    if ((e as { name?: string } | null)?.name === "AbortError") {
      throw new TtsProviderError(
        `${label}: request timed out after ${PROVIDER_TIMEOUT_MS / 1000}s`,
      );
    }
    throw new TtsProviderError(
      `${label}: request failed (${e instanceof Error ? e.message : String(e)})`,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function throwForHttpError(res: Response, label: string): Promise<never> {
  const body = (await res.text()).slice(0, 300);
  throw new TtsProviderError(`${label}: HTTP ${res.status}: ${body}`);
}

/** Parse a text/event-stream body into data payloads. Pure: testable without fetch. */
export function parseSseData(text: string): string[] {
  const out: string[] = [];
  // SSE frames are separated by blank lines; each frame may carry data:.
  for (const frame of text.split(/\r?\n\r?\n/)) {
    const lines = frame.split(/\r?\n/);
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      // ignore event:, id:, retry:, comments
    }
    if (dataLines.length) out.push(dataLines.join("\n"));
  }
  return out;
}

/** Hex string → bytes. Throws TtsProviderError on malformed input. */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new TtsProviderError("MiniMax TTS returned invalid hex audio");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

const B64CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64REV: Record<string, number> = {};
for (let i = 0; i < B64CHARS.length; i++) B64REV[B64CHARS[i]] = i;

/** Base64 → bytes (Hermes has no atob for binary). */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, "");
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64REV[clean[i]] ?? 0;
    const b = B64REV[clean[i + 1]] ?? 0;
    const c = clean[i + 2] === "=" ? 0 : (B64REV[clean[i + 2]] ?? 0);
    const d = clean[i + 3] === "=" ? 0 : (B64REV[clean[i + 3]] ?? 0);
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    out.push((n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
  }
  let pad = 0;
  if (clean.endsWith("==")) pad = 2;
  else if (clean.endsWith("=")) pad = 1;
  return new Uint8Array(out.slice(0, out.length - pad));
}

/**
 * Wrap raw 16-bit PCM samples as a WAV file. Qwen returns PCM chunks;
 * expo-audio needs a container it can sniff.
 */
export function pcmToWav(pcm: Uint8Array, sampleRate: number, channels = 1): Uint8Array {
  const dataLen = pcm.length;
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  v.setUint32(4, 36 + dataLen, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * 2, true); // byte rate
  v.setUint16(32, channels * 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  v.setUint32(40, dataLen, true);
  const out = new Uint8Array(44 + dataLen);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

export interface SynthesizedAudio {
  bytes: Uint8Array;
  /** File extension for the cached file (player sniffs content anyway). */
  ext: string;
}

function joinUrl(base: string, path: string): string {
  const b = base.trim().replace(/\/+$/, "");
  return `${b}${path.startsWith("/") ? path : `/${path}`}`;
}

/** MiniMax t2a_v2: SSE with hex-encoded audio. */
export async function synthesizeMiniMax(
  text: string,
  cred: ProviderCredentials,
  fetchFn: typeof fetch = fetch,
): Promise<SynthesizedAudio> {
  const url = joinUrl(cred.baseUrl, "/t2a_v2");
  const body = JSON.stringify({
    model: cred.model,
    text,
    stream: true,
    voice_setting: {
      voice_id: cred.voice,
      speed: cred.rate,
      vol: 1.0,
      pitch: 0,
    },
    audio_setting: {
      sample_rate: 32000,
      bitrate: 128000,
      format: "mp3",
      channel: 1,
    },
    subtitle_enable: false,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cred.apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body,
      signal: controller.signal,
    });
  } catch (e) {
    if ((e as { name?: string } | null)?.name === "AbortError") {
      throw new TtsProviderError("MiniMax TTS: request timed out");
    }
    throw new TtsProviderError(
      `MiniMax TTS: request failed (${e instanceof Error ? e.message : String(e)})`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) await throwForHttpError(res, "MiniMax TTS");
  const sseText = await res.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (const data of parseSseData(sseText)) {
    if (data === "[DONE]") continue;
    let obj: {
      data?: { audio?: unknown };
      base_resp?: { status_code?: number; status_msg?: string };
    };
    try {
      obj = JSON.parse(data) as typeof obj;
    } catch {
      throw new TtsProviderError("MiniMax TTS returned malformed SSE data");
    }
    const statusCode = obj.base_resp?.status_code;
    if (typeof statusCode === "number" && statusCode !== 0) {
      throw new TtsProviderError(
        `MiniMax TTS: ${obj.base_resp?.status_msg ?? `error ${statusCode}`}`,
      );
    }
    const audioHex = String(obj.data?.audio ?? "");
    if (!audioHex) continue;
    const bytes = hexToBytes(audioHex);
    chunks.push(bytes);
    total += bytes.length;
  }
  if (total === 0) throw new TtsProviderError("MiniMax TTS returned no audio data");
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return { bytes: out, ext: "mp3" };
}

/** Fish Audio v1/tts: raw audio bytes, model in header. */
export async function synthesizeFishAudio(
  text: string,
  cred: ProviderCredentials,
  fetchFn: typeof fetch = fetch,
): Promise<SynthesizedAudio> {
  const url = joinUrl(cred.baseUrl, "/v1/tts");
  const body = JSON.stringify({
    text,
    format: "mp3",
    temperature: 0.7,
    top_p: 0.7,
    prosody: { speed: cred.rate },
    sample_rate: 44100,
    latency: "normal",
    reference_id: cred.voice,
  });
  const res = await postWithTimeout(
    url,
    {
      Authorization: `Bearer ${cred.apiKey}`,
      "Content-Type": "application/json",
      model: cred.model,
    },
    body,
    "Fish Audio TTS",
    fetchFn,
  );
  if (!res.ok) await throwForHttpError(res, "Fish Audio TTS");
  const buf = await res.arrayBuffer();
  if (buf.byteLength === 0) throw new TtsProviderError("Fish Audio TTS returned empty audio");
  return { bytes: new Uint8Array(buf), ext: "mp3" };
}

/** StepFun: OpenAI-compatible /audio/speech. */
export async function synthesizeStepFun(
  text: string,
  cred: ProviderCredentials,
  fetchFn: typeof fetch = fetch,
): Promise<SynthesizedAudio> {
  const url = joinUrl(cred.baseUrl, "/audio/speech");
  const body = JSON.stringify({
    model: cred.model,
    input: text,
    voice: cred.voice,
    response_format: "mp3",
    speed: cred.rate,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cred.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/octet-stream",
      },
      body,
      signal: controller.signal,
    });
  } catch (e) {
    if ((e as { name?: string } | null)?.name === "AbortError") {
      throw new TtsProviderError("StepFun TTS: request timed out");
    }
    throw new TtsProviderError(
      `StepFun TTS: request failed (${e instanceof Error ? e.message : String(e)})`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) await throwForHttpError(res, "StepFun TTS");
  const buf = await res.arrayBuffer();
  if (buf.byteLength === 0) throw new TtsProviderError("StepFun TTS returned empty audio");
  return { bytes: new Uint8Array(buf), ext: "mp3" };
}

/** Qwen (DashScope): SSE with base64 PCM chunks → WAV. */
export async function synthesizeQwen(
  text: string,
  cred: ProviderCredentials,
  fetchFn: typeof fetch = fetch,
): Promise<SynthesizedAudio> {
  const url = joinUrl(cred.baseUrl, "/services/aigc/multimodal-generation/generation");
  const body = JSON.stringify({
    model: cred.model,
    input: {
      text,
      voice: cred.voice,
      language_type: "Chinese",
    },
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cred.apiKey}`,
        "Content-Type": "application/json",
        "X-DashScope-SSE": "enable",
      },
      body,
      signal: controller.signal,
    });
  } catch (e) {
    if ((e as { name?: string } | null)?.name === "AbortError") {
      throw new TtsProviderError("Qwen TTS: request timed out");
    }
    throw new TtsProviderError(
      `Qwen TTS: request failed (${e instanceof Error ? e.message : String(e)})`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) await throwForHttpError(res, "Qwen TTS");
  const sseText = await res.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (const data of parseSseData(sseText)) {
    if (data === "[DONE]") continue;
    let obj: { output?: { audio?: { data?: unknown } }; code?: string; message?: string };
    try {
      obj = JSON.parse(data) as typeof obj;
    } catch {
      throw new TtsProviderError("Qwen TTS returned malformed SSE data");
    }
    if (obj.code) {
      throw new TtsProviderError(`Qwen TTS: ${obj.message ?? obj.code}`);
    }
    const b64 = String(obj.output?.audio?.data ?? "");
    if (!b64) continue;
    const bytes = base64ToBytes(b64);
    chunks.push(bytes);
    total += bytes.length;
  }
  if (total === 0) throw new TtsProviderError("Qwen TTS returned no audio data");
  const pcm = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    pcm.set(c, off);
    off += c.length;
  }
  // DashScope streams 24kHz 16-bit mono PCM.
  return { bytes: pcmToWav(pcm, 24000), ext: "wav" };
}

/** Dispatch to the configured network provider. */
export async function synthesizeWithProvider(
  provider: NetworkTtsProvider,
  text: string,
  cfg: TtsConfig,
  fetchFn?: typeof fetch,
): Promise<SynthesizedAudio> {
  const cred = resolveProviderCredentials(cfg);
  if (!cred.apiKey) {
    throw new TtsProviderError("TTS API key is required — fill it in 语音设置");
  }
  switch (provider) {
    case "minimax":
      return synthesizeMiniMax(text, cred, fetchFn);
    case "fish-audio":
      return synthesizeFishAudio(text, cred, fetchFn);
    case "stepfun":
      return synthesizeStepFun(text, cred, fetchFn);
    case "qwen":
      return synthesizeQwen(text, cred, fetchFn);
  }
}
