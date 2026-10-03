/**
 * Speech-to-text: audio file → transcribed text.
 *
 * Order of attempts (local mode):
 *   1. The active API group's OpenAI-compatible `/audio/transcriptions`
 *      endpoint (same base URL + key as chat). Many OpenAI-compatible
 *      gateways serve this.
 *   2. The user's dedicated STT endpoint (same custom URL/key pattern as
 *      TTS) when configured.
 * If neither works, fail LOUDLY — never return an empty string and pretend
 * the AI "heard" something.
 */

import { GroupError } from "../api-groups/direct-transport";
import type { ApiGroup } from "../api-groups/types";
import type { SttConfig } from "./types";

export class SttError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SttError";
  }
}

function extOf(uri: string): string {
  const m = /\.([a-z0-9]+)(?:\?|#|$)/i.exec(uri);
  return (m?.[1] ?? "m4a").toLowerCase();
}

async function postTranscription(
  baseUrl: string,
  apiKey: string | undefined,
  model: string,
  audioUri: string,
  label: string,
): Promise<string> {
  const url = `${baseUrl.trim().replace(/\/+$/, "")}/audio/transcriptions`;
  const ext = extOf(audioUri);
  const form = new FormData();
  form.append("model", model);
  // React Native FormData file descriptor.
  form.append("file", {
    uri: audioUri,
    name: `speech.${ext}`,
    type: `audio/${ext === "m4a" ? "mp4" : ext}`,
  } as unknown as Blob);

  const headers: Record<string, string> = {};
  const key = (apiKey ?? "").trim();
  if (key) headers.Authorization = `Bearer ${key}`;

  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers, body: form });
  } catch (e) {
    throw new SttError(`${label}: request failed (${e instanceof Error ? e.message : String(e)})`);
  }
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 200);
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } | string };
      if (typeof parsed.error === "string") detail = parsed.error;
      else if (parsed.error?.message) detail = parsed.error.message;
    } catch {
      // keep raw slice
    }
    throw new SttError(`${label}: HTTP ${res.status}: ${detail}`);
  }
  try {
    const parsed = JSON.parse(text) as { text?: unknown };
    if (typeof parsed.text === "string" && parsed.text.trim()) return parsed.text.trim();
  } catch {
    // fall through
  }
  throw new SttError(`${label}: empty transcription`);
}

/**
 * Transcribe an audio file. Tries the API group's endpoint first, then the
 * dedicated STT endpoint. Throws SttError (loud) when nothing works.
 */
export async function transcribeAudio(
  audioUri: string,
  group: ApiGroup | null,
  stt: SttConfig,
): Promise<string> {
  const errors: string[] = [];

  // 1. Active API group's audio endpoint.
  if (group) {
    try {
      // Whisper-style model default when the chat model isn't an STT model.
      // The user can point a dedicated STT config at anything instead.
      return await postTranscription(
        group.baseUrl,
        group.apiKey,
        "whisper-1",
        audioUri,
        `分组「${group.name}」`,
      );
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      // A 404 means "this endpoint doesn't do transcription" — try the
      // dedicated STT config instead of giving up. Anything else is also
      // worth one fallback attempt before failing loudly.
    }
  }

  // 2. Dedicated STT endpoint.
  const customUrl = (stt.customUrl ?? "").trim();
  if (stt.provider === "custom" && customUrl) {
    try {
      return await postTranscription(
        customUrl,
        stt.customKey,
        (stt.customModel ?? "").trim() || "whisper-1",
        audioUri,
        "专用语音转写",
      );
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  throw new SttError(
    errors.length
      ? `语音转写失败：${errors.join("；")}`
      : "没有可用的语音转写服务：请在「连接 → 语音」里配置转写服务，或确认当前分组支持 /audio/transcriptions",
  );
}

/** Re-export for callers that catch transport-level group errors. */
export { GroupError };
