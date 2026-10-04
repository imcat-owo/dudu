/**
 * Podcast / long-audio generation: text → single playable audio file.
 *
 * Splits long text into sentence-boundary segments, synthesizes each via
 * the configured TTS (edge-tts default, free), concatenates the MP3 bytes,
 * and writes one file. Follows the apps/mobile/src/voice/tts.ts pattern:
 * expo modules are loaded lazily so this stays importable in plain node
 * tests.
 */

import { synthesizeSpeech } from "./tts";
import type { TtsConfig } from "./types";

async function loadFs() {
  const mod = await import("expo-file-system/legacy");
  return mod as typeof import("expo-file-system/legacy");
}

const B64CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64REV: Record<string, number> = {};
for (let i = 0; i < B64CHARS.length; i++) B64REV[B64CHARS[i]] = i;

function base64Decode(b64: string): Uint8Array {
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
  // Strip padding bytes.
  let pad = 0;
  if (clean.endsWith("==")) pad = 2;
  else if (clean.endsWith("=")) pad = 1;
  return new Uint8Array(out.slice(0, out.length - pad));
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
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

/**
 * Split text into segments at sentence boundaries (no lookbehind — Hermes).
 * One segment per sentence; over-long single sentences are hard-split to
 * at most maxChars. Shorter segments are NOT merged — each TTS call stays
 * small so edge-tts never truncates, and per-segment progress is granular.
 */
export function splitPodcastText(text: string, maxChars = 500): string[] {
  const cleaned = text.trim();
  if (!cleaned) return [];
  const boundaries = new Set(["。", "！", "？", "；", "\n", ".", "!", "?", ";"]);
  const pieces: string[] = [];
  let cur = "";
  for (const ch of cleaned) {
    cur += ch;
    if (boundaries.has(ch)) {
      const t = cur.trim();
      if (t) pieces.push(t);
      cur = "";
    }
  }
  const tail = cur.trim();
  if (tail) pieces.push(tail);

  const segments: string[] = [];
  for (const p of pieces) {
    // Hard-split a single over-long piece.
    let rest = p;
    while (rest.length > maxChars) {
      segments.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    }
    const t = rest.trim();
    if (t) segments.push(t);
  }
  return segments;
}

// ---- MP3 duration via frame counting ----

const MPEG2_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const MPEG1_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG1_RATES = [44100, 48000, 32000];
const MPEG2_RATES = [22050, 24000, 16000];
const MPEG25_RATES = [11025, 12000, 8000];

/** Estimate MP3 duration in seconds by counting frames. 0 when unparseable. */
export function estimateMp3Duration(bytes: Uint8Array): number {
  let pos = 0;
  // Skip ID3v2 tag.
  if (bytes.length > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size =
      ((bytes[6] & 0x7f) << 21) |
      ((bytes[7] & 0x7f) << 14) |
      ((bytes[8] & 0x7f) << 7) |
      (bytes[9] & 0x7f);
    pos = 10 + size;
  }
  let frames = 0;
  let sampleRate = 24000;
  let samplesPerFrame = 576;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff || (bytes[pos + 1] & 0xe0) !== 0xe0) {
      pos++;
      continue;
    }
    const verBits = (bytes[pos + 1] >> 3) & 0x03;
    const layerBits = (bytes[pos + 1] >> 1) & 0x03;
    if (layerBits !== 0x01) {
      pos++;
      continue; // not Layer III
    }
    const bitrateIdx = (bytes[pos + 2] >> 4) & 0x0f;
    const rateIdx = (bytes[pos + 2] >> 2) & 0x03;
    const padding = (bytes[pos + 2] >> 1) & 0x01;
    if (bitrateIdx === 0 || bitrateIdx === 15 || rateIdx === 3) {
      pos++;
      continue;
    }
    let bitrate: number;
    if (verBits === 0x03) {
      bitrate = MPEG1_BITRATES[bitrateIdx];
      sampleRate = MPEG1_RATES[rateIdx];
      samplesPerFrame = 1152;
    } else if (verBits === 0x02) {
      bitrate = MPEG2_BITRATES[bitrateIdx];
      sampleRate = MPEG2_RATES[rateIdx];
      samplesPerFrame = 576;
    } else if (verBits === 0x00) {
      bitrate = MPEG2_BITRATES[bitrateIdx];
      sampleRate = MPEG25_RATES[rateIdx];
      samplesPerFrame = 576;
    } else {
      pos++;
      continue;
    }
    const frameLen = Math.floor((144 * bitrate * 1000) / sampleRate) + padding;
    if (frameLen < 4) {
      pos++;
      continue;
    }
    frames++;
    pos += frameLen;
  }
  if (frames === 0) return 0;
  return (frames * samplesPerFrame) / sampleRate;
}

/** Fallback duration estimate from text length (~5 CJK chars/sec). */
export function estimateDurationFromText(text: string): number {
  const chars = text.replace(/\s/g, "").length;
  return Math.max(1, Math.round(chars / 5));
}

export interface PodcastResult {
  uri: string;
  durationSec: number;
  segments: number;
}

async function podcastDir(ephemeral = false): Promise<string> {
  const fs = await loadFs();
  // Incognito: write to the cache directory (temp, OS-purgeable) instead of
  // documents — the file plays fine in-session but is not durable/backup'd.
  const base = ephemeral
    ? (fs.cacheDirectory ?? fs.documentDirectory)
    : (fs.documentDirectory ?? fs.cacheDirectory);
  const dir = `${base}dudu-podcasts/`;
  const info = await fs.getInfoAsync(dir);
  if (!info.exists) await fs.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
}

/**
 * Generate one audio file from long text. Synthesizes each segment,
 * concatenates MP3 bytes (chained frames play fine in expo-audio —
 * edge-tts.ts already relies on this), writes the final file.
 *
 * onProgress(done, total) fires after each segment.
 */
export async function generatePodcastAudio(
  text: string,
  cfg: TtsConfig,
  onProgress?: (done: number, total: number) => Promise<void> | void,
  opts?: { ephemeral?: boolean; timeoutMs?: number },
): Promise<PodcastResult> {
  const segments = splitPodcastText(text);
  if (segments.length === 0) throw new Error("empty text");
  const fs = await loadFs();

  // P2-18: overall deadline. Combined with per-fetch timeouts this bounds
  // the whole generation — one wedged segment can't hang the tool call
  // forever. The caller marks the card stuck loudly on this throw.
  const timeoutMs = opts?.timeoutMs ?? 15 * 60 * 1000;
  const deadline = Date.now() + timeoutMs;

  const chunks: Uint8Array[] = [];
  let totalLen = 0;
  for (let i = 0; i < segments.length; i++) {
    if (Date.now() > deadline) {
      throw new Error(
        `播客生成超时（超过 ${Math.round(timeoutMs / 60000)} 分钟）：第 ${i + 1}/${segments.length} 段还没做完。`,
      );
    }
    const uri = await synthesizeSpeech(segments[i], cfg);
    // P1-1: only MP3 segments can be frame-concatenated. Other formats
    // (wav/ogg/...) would silently produce a broken file — fail loudly.
    const ext = uri.split(".").pop()?.toLowerCase() ?? "";
    if (ext !== "mp3") {
      throw new Error(
        `podcast needs MP3 segments but TTS returned .${ext} — ` +
          `use an MP3 TTS voice or provider for podcasts.`,
      );
    }
    const b64 = await fs.readAsStringAsync(uri, { encoding: "base64" });
    const bytes = base64Decode(b64);
    chunks.push(bytes);
    totalLen += bytes.length;
    if (onProgress) await onProgress(i + 1, segments.length);
  }

  const merged = new Uint8Array(totalLen);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.length;
  }

  const dir = await podcastDir(opts?.ephemeral === true);
  // P3-17: random suffix — same-millisecond generations must not collide.
  const uri = `${dir}podcast_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}.mp3`;
  await fs.writeAsStringAsync(uri, base64Encode(merged), {
    encoding: "base64",
  });

  let durationSec = estimateMp3Duration(merged);
  if (durationSec <= 0) durationSec = estimateDurationFromText(text);
  return { uri, durationSec: Math.round(durationSec), segments: segments.length };
}
