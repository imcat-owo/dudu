/**
 * Message envelope extraction — PURE module, no React Native imports.
 *
 * AI tool results (voice bubbles, generated images) travel inside the AI's
 * reply as a JSON envelope like {"type":"voice_message","uri":"..."}.
 * The old renderer only recognized the envelope when the AI output it
 * VERBATIM as its entire reply — one stray intro line or a ```json fence
 * and the raw JSON leaked into the chat as ugly text (P2-27).
 *
 * extractEnvelope() finds the envelope wherever the AI put it:
 *   1. the whole message is the JSON (fast path, old behavior),
 *   2. the JSON sits inside a single ```json fenced block,
 *   3. the JSON is embedded in surrounding prose — located by scanning
 *      for a balanced {...} region whose parsed object has the right
 *      "type" field.
 *
 * It returns the envelope's character span so callers can strip it and
 * render any surrounding prose as a normal text bubble alongside.
 */

export interface EnvelopeHit {
  /** The parsed envelope object. */
  data: Record<string, unknown>;
  /** Start index of the envelope's raw text in the original content. */
  start: number;
  /** End index (exclusive) of the envelope's raw text. */
  end: number;
  /** The message with the envelope removed (surrounding prose, trimmed). */
  rest: string;
}

function tryParseObject(raw: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return null;
}

/**
 * Find the first balanced {...} region starting at or after `from`,
 * skipping over string literals (with escapes). Returns [start, end)
 * indices, or null when no balanced region exists.
 */
function balancedBraces(text: string, from: number): [number, number] | null {
  const open = text.indexOf("{", from);
  if (open < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return [open, i + 1];
    }
  }
  return null;
}

const FENCE_RE = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/;

export function extractEnvelope(content: string, type: string): EnvelopeHit | null {
  if (!content || typeof content !== "string") return null;

  // 1. Fast path: the whole message is the envelope.
  const whole = tryParseObject(content.trim());
  if (whole && whole.type === type) {
    return { data: whole, start: 0, end: content.length, rest: "" };
  }

  // 2. Fenced code block: ```json { ... } ```
  const fence = FENCE_RE.exec(content);
  if (fence) {
    const inner = tryParseObject(fence[1].trim());
    if (inner && inner.type === type) {
      const start = fence.index;
      const end = fence.index + fence[0].length;
      const rest = (content.slice(0, start) + content.slice(end)).trim();
      return { data: inner, start, end, rest };
    }
  }

  // 3. Embedded in prose: scan balanced {...} regions for the right type.
  //    Cap the scan so a pathological message can't hang the renderer.
  let from = 0;
  let scanned = 0;
  while (scanned < 20) {
    const span = balancedBraces(content, from);
    if (!span) return null;
    scanned++;
    const [start, end] = span;
    const obj = tryParseObject(content.slice(start, end));
    if (obj && obj.type === type) {
      const rest = (content.slice(0, start) + content.slice(end)).trim();
      return { data: obj, start, end, rest };
    }
    from = end;
  }
  return null;
}

/**
 * Voice-message envelope helpers — pure (no React Native imports) so node
 * tests and AI tools can use them without pulling in expo-audio.
 * voice-message.tsx re-exports these for the UI layer.
 */

export interface VoiceMessage {
  uri: string;
  /** seconds */
  duration: number;
}

export interface VoiceMessageHit {
  voice: VoiceMessage;
  /** Surrounding prose with the envelope stripped ("" when JSON only). */
  rest: string;
}

/**
 * Detect a voice message encoded in message content.
 * Convention: {"type":"voice_message","uri":"...","duration":12}
 *
 * Tolerant (P2-27): the envelope is found even when the AI wraps it in a
 * ```json fence or adds its own words around it — the app no longer depends
 * on the AI echoing the JSON verbatim.
 */
export function extractVoiceMessage(content: string): VoiceMessageHit | null {
  const hit = extractEnvelope(content, "voice_message");
  if (!hit) return null;
  const uri = hit.data.uri;
  const duration = hit.data.duration;
  if (typeof uri !== "string" || !uri || typeof duration !== "number" || duration < 0) {
    return null;
  }
  return { voice: { uri, duration }, rest: hit.rest };
}

/** Legacy: just the voice payload, or null. */
export function parseVoiceMessage(content: string): VoiceMessage | null {
  return extractVoiceMessage(content)?.voice ?? null;
}

/** Encode a voice message envelope (the AI echoes this back into chat). */
export function encodeVoiceMessage(uri: string, duration: number): string {
  return JSON.stringify({ type: "voice_message", uri, duration });
}
