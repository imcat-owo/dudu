/**
 * Microsoft edge-tts client — free neural TTS, no API key needed.
 *
 * Implements the (unofficial but stable) Edge ReadAloud WebSocket protocol,
 * as used by the open-source edge-tts ecosystem:
 *
 *   1. WS connect to speech.platform.bing.com with a trusted client token.
 *   2. Send `speech.config` (output format: 24kHz mp3 mono).
 *   3. Send SSML (`Path:ssml`) with the chosen neural voice.
 *   4. Collect binary `Path:audio` chunks until `Path:turn.end`.
 *   5. Concatenate the MP3 chunks → file → played by expo-audio.
 *
 * React Native's WebSocket supports binary frames via `binaryType =
 * "arraybuffer"`. Long text is chunked at sentence boundaries (the
 * service truncates over-long single requests).
 */

export class EdgeTtsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EdgeTtsError";
  }
}

const WS_URL =
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491F74";

const VOICE_LIST_URL =
  "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=6A5AA1D4EAFF4E9FB37E23D68491F74";

function uuid(): string {
  return "xxxxxxxxxxxx4xxxyxxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function timestamp(): string {
  // "2026-10-03T05:00:00.000Z" without separators, as the service expects.
  return new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Split long text at sentence boundaries — the service truncates long requests. */
export function chunkText(text: string, maxLen = 600): string[] {
  const chunks: string[] = [];
  // Split on CJK + western sentence terminators, keeping the delimiter.
  const sentences = text.match(/[^。！？!?\n]+[。！？!?\n]?/g) ?? [text];
  let current = "";
  for (const s of sentences) {
    if ((current + s).length > maxLen && current) {
      chunks.push(current);
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks.length ? chunks : [text];
}

function speechConfigMessage(): string {
  return (
    "Content-Type:application/json; charset=utf-8\r\n" +
    "Path:speech.config\r\n" +
    "\r\n" +
    JSON.stringify({
      context: {
        synthesis: {
          audio: {
            metadataoptions: {
              sentenceBoundaryEnabled: "false",
              wordBoundaryEnabled: "true",
            },
            outputFormat: "audio-24khz-48kbitrate-mono-mp3",
          },
        },
      },
    })
  );
}

function ssmlMessage(text: string, voice: string, requestId: string): string {
  const ssml =
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>` +
    `<voice name='${voice}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>` +
    `${escapeXml(text)}</prosody></voice></speak>`;
  return (
    `X-RequestId:${requestId}\r\n` +
    "Content-Type:application/ssml+xml\r\n" +
    `X-Timestamp:${timestamp()}\r\n` +
    "Path:ssml\r\n" +
    "\r\n" +
    ssml
  );
}

interface WsLike {
  binaryType: string;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

declare const WebSocket: new (
  url: string,
  protocols?: string | string[],
  options?: { headers?: Record<string, string> },
) => WsLike;

/**
 * Synthesize one chunk of text. Resolves with the raw MP3 bytes
 * (concatenated across the turn). Rejects with EdgeTtsError.
 */
function synthesizeChunk(text: string, voice: string, timeoutMs = 30000): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let ws: WsLike | null = null;
    let settled = false;
    const audioParts: Uint8Array[] = [];
    const timer = setTimeout(() => {
      finish(new EdgeTtsError("edge-tts timed out"));
    }, timeoutMs);

    function finish(err?: Error, bytes?: Uint8Array) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        // already gone
      }
      ws = null;
      if (err) reject(err);
      else resolve(bytes ?? new Uint8Array(0));
    }

    try {
      ws = new WebSocket(WS_URL, [], {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 Edg/120.0",
          Origin: "https://www.bing.com",
        },
      });
    } catch (e) {
      finish(e instanceof Error ? e : new EdgeTtsError("WebSocket unavailable"));
      return;
    }
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      try {
        ws?.send(speechConfigMessage());
        ws?.send(ssmlMessage(text, voice, uuid().replace(/-/g, "")));
      } catch (e) {
        finish(e instanceof Error ? e : new EdgeTtsError("send failed"));
      }
    };

    ws.onerror = () => {
      finish(new EdgeTtsError("edge-tts connection failed"));
    };

    ws.onclose = () => {
      // If the turn ended cleanly we already resolved; a close without
      // turn.end and without audio means something went wrong.
      if (audioParts.length === 0) finish(new EdgeTtsError("edge-tts closed without audio"));
    };

    ws.onmessage = (ev: { data: unknown }) => {
      const data = ev.data;
      if (typeof data === "string") {
        if (data.includes("Path:turn.end")) {
          const total = audioParts.reduce((n, p) => n + p.length, 0);
          const out = new Uint8Array(total);
          let off = 0;
          for (const p of audioParts) {
            out.set(p, off);
            off += p.length;
          }
          finish(undefined, out);
        } else if (data.includes("Path:turn.start")) {
          // turn begun — nothing to do
        }
        // word-boundary metadata is ignored (we don't do karaoke highlighting)
        return;
      }
      // Binary frame: 2-byte big-endian header length, header text, audio payload.
      try {
        const buf = data as ArrayBuffer;
        const view = new DataView(buf);
        if (view.byteLength < 2) return;
        const headerLen = view.getUint16(0, false);
        if (view.byteLength < 2 + headerLen) return;
        const headerBytes = new Uint8Array(buf, 2, headerLen);
        const header = String.fromCharCode(...headerBytes);
        if (!header.includes("Path:audio")) return;
        const audio = new Uint8Array(buf, 2 + headerLen);
        if (audio.length > 0) audioParts.push(audio);
      } catch {
        // malformed frame — ignore
      }
    };
  });
}

/**
 * Synthesize full text to MP3 bytes. Chunks long text and concatenates.
 * Pure protocol — no file I/O here (callers decide where to save).
 */
export async function edgeTtsSynthesize(text: string, voice: string): Promise<Uint8Array> {
  const trimmed = text.trim();
  if (!trimmed) throw new EdgeTtsError("empty text");
  const chunks = chunkText(trimmed);
  const parts: Uint8Array[] = [];
  for (const chunk of chunks) {
    const bytes = await synthesizeChunk(chunk, voice);
    if (bytes.length === 0) throw new EdgeTtsError("edge-tts returned no audio");
    parts.push(bytes);
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export interface EdgeVoice {
  Name: string;
  DisplayName: string;
  LocalName: string;
  ShortName: string;
  Gender: string;
  Locale: string;
}

/** Fetch the service's voice list (for a future voice picker). Best-effort. */
export async function fetchEdgeVoices(): Promise<EdgeVoice[]> {
  const res = await fetch(VOICE_LIST_URL);
  if (!res.ok) throw new EdgeTtsError(`voice list HTTP ${res.status}`);
  const list = (await res.json()) as EdgeVoice[];
  return Array.isArray(list) ? list : [];
}
