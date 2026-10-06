/**
 * 真人式分段发送 (segmented sending) — PURE module, no React Native /
 * expo imports. All time is caller-driven (delays computed, not slept).
 *
 * Like Reverie: a long reply sometimes arrives as 2–3 short bubbles in a
 * row instead of one wall of text — the way a real person texts.
 *
 * Conservative by design (her bar):
 * - Only splits when the reply is long enough (>= MIN_SPLIT_LEN chars).
 * - Splits ONLY at natural sentence boundaries (Chinese-aware:
 *   。！？!?… and newlines). Never mid-sentence, never inside code
 *   fences, never inside image/voice message envelopes.
 * - Max MAX_BUBBLES (3) bubbles. A tiny trailing fragment (< 25 chars)
 *   merges into the previous bubble instead of dangling alone.
 * - Short replies, tool-call messages, and envelope messages are never
 *   touched — they come back as a single bubble.
 */

/** Below this length a reply is never split. */
export const MIN_SPLIT_LEN = 140;
/** Hard cap on bubbles per reply. */
export const MAX_BUBBLES = 3;
/** A trailing bubble shorter than this merges into the previous one. */
const MIN_TRAIL_LEN = 25;

/** Strong sentence boundaries (Chinese + English), kept with the sentence. */
const BOUNDARY_RE = /[^。！？!?\n…]+[。！？!?…\n]+|[^。！？!?\n…]+$/g;

/** Markers that mean "this message is structured, don't touch it". */
const STRUCTURED_RE = /```|"(type)"\s*:\s*"(voice_message|image_message|voice-message)"/;

/**
 * Split one text into sentence units at strong boundaries, punctuation
 * kept. Returns [] when there is nothing to split on.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  BOUNDARY_RE.lastIndex = 0;
  for (;;) {
    const m = BOUNDARY_RE.exec(text);
    if (m === null) break;
    const s = m[0].trim();
    if (s) out.push(s);
  }
  return out;
}

/**
 * Split a reply into 1..MAX_BUBBLES bubbles. Pure. Order-preserving:
 * sentences are divided into contiguous groups with balanced lengths
 * (minimal max-group-length via a tiny DP over split points).
 */
export function splitIntoBubbles(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [text];
  if (trimmed.length < MIN_SPLIT_LEN) return [trimmed];
  if (STRUCTURED_RE.test(trimmed)) return [trimmed];

  const sentences = splitSentences(trimmed);
  if (sentences.length < 2) return [trimmed];

  // Bubble count: 2 for a long reply, 3 only when it's really long.
  const k = Math.min(MAX_BUBBLES, sentences.length, trimmed.length >= MIN_SPLIT_LEN * 2.2 ? 3 : 2);
  if (k < 2) return [trimmed];

  const groups = balancedSplit(sentences, k);
  const bubbles = groups.map((g) => g.join("").trim()).filter(Boolean);
  // Merge a dangling tiny tail into the previous bubble.
  while (bubbles.length > 1 && bubbles[bubbles.length - 1].length < MIN_TRAIL_LEN) {
    const tail = bubbles.pop() as string;
    bubbles[bubbles.length - 1] = `${bubbles[bubbles.length - 1]}${tail}`;
  }
  return bubbles.length > 0 ? bubbles : [trimmed];
}

/**
 * Divide items into k contiguous groups minimizing the longest group
 * (by char length). Tiny DP: n sentences (<= ~40), k <= 3.
 */
function balancedSplit(items: string[], k: number): string[][] {
  const n = items.length;
  const lens = items.map((s) => s.length);
  const prefix: number[] = [0];
  for (const l of lens) prefix.push(prefix[prefix.length - 1] + l);
  const cost = (i: number, j: number) => prefix[j] - prefix[i]; // [i, j)

  // dp[g][j] = minimal possible max-group-length for first j items in g groups.
  const dp: number[][] = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(Infinity));
  const cut: number[][] = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(-1));
  dp[0][0] = 0;
  for (let g = 1; g <= k; g++) {
    for (let j = g; j <= n; j++) {
      for (let i = g - 1; i < j; i++) {
        if (dp[g - 1][i] === Infinity) continue;
        const worst = Math.max(dp[g - 1][i], cost(i, j));
        if (worst < dp[g][j]) {
          dp[g][j] = worst;
          cut[g][j] = i;
        }
      }
    }
  }
  // Backtrack.
  const groups: string[][] = [];
  let j = n;
  for (let g = k; g >= 1; g--) {
    const i = cut[g][j];
    if (i < 0) return [items]; // shouldn't happen; fail safe
    groups.unshift(items.slice(i, j));
    j = i;
  }
  return groups;
}

/**
 * Human-like delay before bubble `index` (>0) appears, based on the
 * previous bubble's length (reading time). 700ms base, ~6ms/char,
 * capped at 2.2s. Deterministic — the caller does the actual waiting.
 */
export function bubbleDelayMs(prevBubbleLen: number): number {
  return Math.min(2200, 700 + Math.max(0, prevBubbleLen) * 6);
}
