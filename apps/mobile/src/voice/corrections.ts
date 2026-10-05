/**
 * Voice correction learning: learn from her edits, fix future transcripts.
 *
 * When she corrects a transcribed text (edits it before sending), the
 * pair (transcribed → corrected) teaches a confusion map: e.g. the STT
 * keeps hearing "石碑" when she says "识别". Next time the same
 * confusion appears in a transcript, it's fixed automatically.
 *
 * This is a deliberately small version of OpenMinis' CorrectionStrategy:
 * no LLM round-trip, just a persistent confusion map with counts. A
 * confusion only auto-applies after she's corrected it twice (avoids
 * learning from one-off typos).
 *
 * PURE module: storage backend is injectable so tests run in plain node.
 */

export interface CorrectionPair {
  /** What the STT produced. */
  from: string;
  /** What she changed it to. */
  to: string;
  /** How many times she's made this correction. */
  count: number;
  /** Last correction timestamp (for pruning). */
  updatedAt: number;
}

export interface CorrectionBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const CORRECTIONS_KEY = "dudu.voice-corrections.v1";
/** A confusion must be corrected this many times before auto-apply. */
export const CORRECTION_CONFIRM_THRESHOLD = 2;
/** Max stored pairs — the map can't grow unbounded. */
const MAX_PAIRS = 200;

/**
 * Extract the changed segments between transcribed and corrected text.
 * Returns [from, to] pairs for the minimal differing spans. Pure.
 */
export function diffSegments(transcribed: string, corrected: string): Array<[string, string]> {
  const a = transcribed;
  const b = corrected;
  if (a === b) return [];
  // Common prefix.
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  // Common suffix (not overlapping the prefix).
  let sufA = a.length;
  let sufB = b.length;
  while (sufA > pre && sufB > pre && a[sufA - 1] === b[sufB - 1]) {
    sufA--;
    sufB--;
  }
  const from = a.slice(pre, sufA);
  const to = b.slice(pre, sufB);
  if (!from || !to) return [];
  // Keep it sane: single confusion, not a full rewrite.
  if (from.length > 12 || to.length > 12) return [];
  return [[from, to]];
}

function parsePairs(raw: string | null): CorrectionPair[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is CorrectionPair =>
        typeof p === "object" &&
        p !== null &&
        typeof (p as CorrectionPair).from === "string" &&
        typeof (p as CorrectionPair).to === "string" &&
        typeof (p as CorrectionPair).count === "number",
    );
  } catch {
    return [];
  }
}

export function createCorrectionStore(backend: CorrectionBackend) {
  let pairs: CorrectionPair[] | null = null;

  async function load(): Promise<CorrectionPair[]> {
    if (pairs) return pairs;
    pairs = parsePairs(await backend.getItem(CORRECTIONS_KEY));
    return pairs;
  }

  async function save(next: CorrectionPair[]): Promise<void> {
    pairs = next;
    try {
      await backend.setItem(CORRECTIONS_KEY, JSON.stringify(next));
    } catch {
      // Non-fatal: memory mirror keeps this session working.
    }
  }

  return {
    /**
     * Learn from a correction. Call when she sends a message whose text
     * differs from what transcription produced.
     *
     * INTEGRATION (chat.tsx): in handleRecorded, keep the transcribed
     * text; when the message is sent, if the sent text differs, call
     * learnCorrection(transcribedText, sentText).
     */
    async learnCorrection(transcribed: string, corrected: string): Promise<void> {
      const segs = diffSegments(transcribed.trim(), corrected.trim());
      if (!segs.length) return;
      const current = await load();
      const now = Date.now();
      for (const [from, to] of segs) {
        const existing = current.find((p) => p.from === from && p.to === to);
        if (existing) {
          existing.count++;
          existing.updatedAt = now;
        } else {
          current.push({ from, to, count: 1, updatedAt: now });
        }
      }
      // Prune oldest beyond the cap.
      current.sort((x, y) => y.updatedAt - x.updatedAt);
      await save(current.slice(0, MAX_PAIRS));
    },

    /**
     * Apply learned corrections to a fresh transcript. Only confusions
     * confirmed CORRECTION_CONFIRM_THRESHOLD times are applied.
     * Pure string replacement — no network, no LLM.
     */
    async applyCorrections(text: string): Promise<{ text: string; applied: number }> {
      const current = await load();
      const confirmed = current.filter((p) => p.count >= CORRECTION_CONFIRM_THRESHOLD);
      // Longest first so overlapping confusions resolve deterministically.
      confirmed.sort((a, b) => b.from.length - a.from.length);
      let out = text;
      let applied = 0;
      for (const p of confirmed) {
        if (out.includes(p.from)) {
          out = out.split(p.from).join(p.to);
          applied++;
        }
      }
      return { text: out, applied };
    },

    async list(): Promise<CorrectionPair[]> {
      return [...(await load())];
    },

    async clear(): Promise<void> {
      try {
        await backend.removeItem(CORRECTIONS_KEY);
      } catch {
        // ignore
      }
      pairs = [];
    },

    /** Test hook. */
    __setPairs(next: CorrectionPair[]): void {
      pairs = next;
    },
  };
}

export type CorrectionStore = ReturnType<typeof createCorrectionStore>;
