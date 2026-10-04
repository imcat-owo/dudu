/**
 * Couple counters ("我们第 N 次") — regression tests. The honesty rules:
 *  1. Counters come from real records only; empty history → 0.
 *  2. A failing source degrades to 0, never throws.
 *  3. Negative/garbage values are clamped to 0.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getCoupleCounters } from "../src/our-space/couple-counters.js";

describe("getCoupleCounters", () => {
  it("derives counts from real records", async () => {
    const c = await getCoupleCounters({
      countTogetherListens: async () => 50,
      countLoveLetters: async () => 3,
      countDiaryEntries: async () => 12,
    });
    assert.deepEqual(c, { togetherListens: 50, loveLetters: 3, diaryEntries: 12 });
  });

  it("empty history yields zeros, never invented numbers", async () => {
    const c = await getCoupleCounters({
      countTogetherListens: async () => 0,
      countLoveLetters: async () => 0,
      countDiaryEntries: async () => 0,
    });
    assert.deepEqual(c, { togetherListens: 0, loveLetters: 0, diaryEntries: 0 });
  });

  it("a failing source degrades to 0 instead of throwing", async () => {
    const c = await getCoupleCounters({
      countTogetherListens: async () => {
        throw new Error("db gone");
      },
      countLoveLetters: async () => 2,
      countDiaryEntries: async () => 1,
    });
    assert.deepEqual(c, { togetherListens: 0, loveLetters: 2, diaryEntries: 1 });
  });

  it("clamps garbage to 0", async () => {
    const c = await getCoupleCounters({
      countTogetherListens: async () => -5,
      countLoveLetters: async () => Number.NaN,
      countDiaryEntries: async () => 4,
    });
    assert.deepEqual(c, { togetherListens: 0, loveLetters: 0, diaryEntries: 4 });
  });
});
