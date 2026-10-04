/**
 * "我们第 N 次" — couple counters (xiaomeng P2-2, design doc §2).
 *
 * PURE module. Counters are DERIVED from records that only exist because
 * the thing really happened — a together-listen entry is written when a
 * track actually played with together mode on, a love letter only when he
 * wrote one, a diary entry only when one was written. Nothing is
 * fabricated; a counter is 0 when the history is empty, and the UI hides
 * zero counters instead of inventing a "first time".
 *
 * Sources are injected so tests don't need the real stores.
 */

export interface CoupleCounterSources {
  /** Together-listen records (music store). */
  countTogetherListens(): Promise<number>;
  /** Love letters he wrote (our-space store). */
  countLoveLetters(): Promise<number>;
  /** Diary entries (our-space store). */
  countDiaryEntries(): Promise<number>;
}

export interface CoupleCounters {
  togetherListens: number;
  loveLetters: number;
  diaryEntries: number;
}

function safeCount(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** Read all counters. A failing source degrades to 0, never throws. */
export async function getCoupleCounters(sources: CoupleCounterSources): Promise<CoupleCounters> {
  const [togetherListens, loveLetters, diaryEntries] = await Promise.all([
    sources.countTogetherListens().then(safeCount, () => 0),
    sources.countLoveLetters().then(safeCount, () => 0),
    sources.countDiaryEntries().then(safeCount, () => 0),
  ]);
  return { togetherListens, loveLetters, diaryEntries };
}
