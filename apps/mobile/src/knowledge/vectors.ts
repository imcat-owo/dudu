/**
 * Knowledge base — vector math. PURE module: no React Native / expo imports.
 *
 * Phase 1 uses plain JS cosine similarity (research: 6k vectors <10ms on
 * device, zero native deps). sqlite-vec is the Phase 2 upgrade path; the
 * interface here stays the same so the swap is painless.
 */

/** Cosine similarity in [-1, 1]. Returns 0 for empty/zero vectors. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface ScoredItem<T> {
  item: T;
  score: number;
}

/**
 * Brute-force top-k by cosine similarity. Fine for Phase 1 scale
 * (a few thousand chunks). Phase 2 moves this into sqlite-vec KNN.
 */
export function topKByCosine<T>(
  query: readonly number[],
  candidates: Array<{ item: T; vector: readonly number[] }>,
  k: number,
  minScore = 0,
): ScoredItem<T>[] {
  const scored: ScoredItem<T>[] = [];
  for (const c of candidates) {
    const s = cosineSimilarity(query, c.vector);
    if (s >= minScore) scored.push({ item: c.item, score: s });
  }
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, Math.max(0, k));
}
