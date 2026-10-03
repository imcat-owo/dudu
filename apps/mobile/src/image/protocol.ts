/**
 * Image message protocol — PURE module, no React Native imports.
 *
 * Split out of image-generation.tsx so AI tools (src/image/tools.ts) and
 * node tests can use the protocol without pulling in react-native.
 * image-generation.tsx re-exports everything for backward compatibility.
 */

export type ImageMessage = {
  uri: string;
  prompt: string;
};

/**
 * Detect an image message encoded in message content.
 * Convention: {"type":"image_message","uri":"...","prompt":"..."}
 */
export function parseImageMessage(content: string): ImageMessage | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as Record<string, unknown>).type === "image_message" &&
      typeof (parsed as Record<string, unknown>).uri === "string" &&
      typeof (parsed as Record<string, unknown>).prompt === "string"
    ) {
      const p = parsed as { uri: string; prompt: string };
      if (p.uri) return { uri: p.uri, prompt: p.prompt };
    }
  } catch {
    // not JSON — not an image message
  }
  return null;
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
