/**
 * Image message protocol — PURE module, no React Native imports.
 *
 * Split out of image-generation.tsx so AI tools (src/image/tools.ts) and
 * node tests can use the protocol without pulling in react-native.
 * image-generation.tsx re-exports everything for backward compatibility.
 */

import { extractEnvelope } from "../message-envelope.js";

export type ImageMessage = {
  uri: string;
  prompt: string;
};

export interface ImageMessageHit {
  image: ImageMessage;
  /** Surrounding prose with the envelope stripped ("" when the AI output JSON only). */
  rest: string;
}

/**
 * Detect an image message encoded in message content.
 * Convention: {"type":"image_message","uri":"...","prompt":"..."}
 *
 * Tolerant (P2-27): found even inside a ```json fence or surrounded by the
 * AI's own words — rendering no longer depends on verbatim JSON output.
 */
export function extractImageMessage(content: string): ImageMessageHit | null {
  const hit = extractEnvelope(content, "image_message");
  if (!hit) return null;
  const uri = hit.data.uri;
  const prompt = hit.data.prompt;
  if (typeof uri !== "string" || !uri || typeof prompt !== "string") return null;
  return { image: { uri, prompt }, rest: hit.rest };
}

/** Legacy: just the image payload, or null. */
export function parseImageMessage(content: string): ImageMessage | null {
  return extractImageMessage(content)?.image ?? null;
}

export function encodeImageMessage(uri: string, prompt: string): string {
  return JSON.stringify({ type: "image_message", uri, prompt });
}

/**
 * Build a Pollinations.ai image URL. Free, no API key needed.
 * https://image.pollinations.ai/prompt/{prompt}?width=&height=&model=&seed=
 */
export function buildImageUrl(
  prompt: string,
  opts?: { width?: number; height?: number; model?: string; seed?: number },
): string {
  const width = opts?.width ?? 1024;
  const height = opts?.height ?? 1024;
  const model = opts?.model ?? "flux";
  const seed = opts?.seed ?? Math.floor(Math.random() * 1000000);
  const encoded = encodeURIComponent(prompt.trim());
  return (
    `https://image.pollinations.ai/prompt/${encoded}` +
    `?width=${width}&height=${height}&model=${model}&seed=${seed}` +
    `&nologo=true&private=true&enhance=true`
  );
}

/** Detect the /img command. Returns the prompt, or null if not an image request. */
export function parseImageCommand(text: string): string | null {
  const trimmed = text.trim();
  const match = /^\/img\s+(.+)$/is.exec(trimmed);
  return match ? match[1].trim() : null;
}
