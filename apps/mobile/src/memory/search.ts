/**
 * AI memory system — search. PURE module: no React Native / expo imports.
 *
 * Stage-1 retrieval WITHOUT embeddings or SQLite FTS: tokenize the query and
 * each memory, score with a BM25-ish formula, then boost by recency and
 * confidence. For a few hundred memory cards this is fast (<5ms) and honest.
 * Stage 2 can add sqlite-vec + on-device MiniLM behind the same interface.
 *
 * Ranking signals (in order):
 *  1. keyword overlap (BM25-ish over content tokens)
 *  2. recency (newer memories rank higher, gentle decay)
 *  3. confidence (confident > unsure > question — never present unsure as confident)
 * Superseded records (validTo !== null) are excluded unless asked for.
 */

import type { MemoryConfidence, MemoryRecord } from "./types";

/** CJK-aware tokenizer: latin words + individual CJK chars as tokens. */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  // Latin words / numbers.
  for (const m of text.toLowerCase().matchAll(/[a-z0-9]+(?:['-][a-z0-9]+)*/g)) {
    tokens.push(m[0]);
  }
  // CJK chars as individual tokens (bigrams would be better; singles are
  // honest and cheap at this scale).
  for (const m of text.matchAll(/[\u4e00-\u9fff\u3400-\u4dbf]/g)) {
    tokens.push(m[0]);
  }
  return tokens;
}

const CONFIDENCE_BOOST: Record<MemoryConfidence, number> = {
  confident: 1.25,
  unsure: 1.0,
  question: 0.8,
};

export interface SearchOptions {
  /** Include superseded (wilted) records. Default false. */
  includeSuperseded?: boolean;
  /** Max results. Default 10. */
  limit?: number;
}

export interface ScoredMemory {
  record: MemoryRecord;
  score: number;
}

/**
 * Search memories. Never throws — bad input yields an empty list.
 * The score is exposed so callers can apply their own cutoff.
 */
export function searchMemories(
  memories: MemoryRecord[],
  query: string,
  opts: SearchOptions = {},
): ScoredMemory[] {
  const qTokens = [...new Set(tokenize(query))];
  if (qTokens.length === 0) return [];
  const limit = Math.max(1, Math.min(50, opts.limit ?? 10));
  const includeSuperseded = opts.includeSuperseded === true;
  const now = Date.now();

  // Document frequencies for IDF.
  const pool = includeSuperseded ? memories : memories.filter((m) => m.validTo === null);
  const df = new Map<string, number>();
  const docTokens = new Map<string, string[]>();
  for (const m of pool) {
    const toks = tokenize(m.content);
    docTokens.set(m.id, toks);
    for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const N = Math.max(1, pool.length);
  const avgDocLen = pool.reduce((sum, m) => sum + (docTokens.get(m.id)?.length ?? 0), 0) / N;

  const scored: ScoredMemory[] = [];
  for (const m of pool) {
    const toks = docTokens.get(m.id) ?? [];
    if (toks.length === 0) continue;
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    const docLen = toks.length;

    // BM25-ish (k1=1.2, b=0.75).
    let bm25 = 0;
    for (const q of qTokens) {
      const f = tf.get(q) ?? 0;
      if (f === 0) continue;
      const n = df.get(q) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      bm25 += idf * ((f * 2.2) / (f + 1.2 * (1 - 0.75 + 0.75 * (docLen / Math.max(1, avgDocLen)))));
    }
    if (bm25 <= 0) continue;

    // Recency: gentle decay over ~180 days.
    const ageDays = Math.max(0, (now - m.updatedAt) / 86_400_000);
    const recency = 1 / (1 + ageDays / 60);

    // Reinforcement (design doc §8): memories she confirmed or engaged
    // with re-rank higher — a gentle multiplier, not a veto. Caps at 1.6
    // so an old joke that landed 30 times cannot drown everything.
    const reinforcement = 1 + Math.min(m.reinforcedCount, 12) * 0.05;

    const score = bm25 * (0.7 + 0.3 * recency) * CONFIDENCE_BOOST[m.confidence] * reinforcement;
    scored.push({ record: m, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
