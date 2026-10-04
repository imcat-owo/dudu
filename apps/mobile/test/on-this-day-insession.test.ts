/**
 * Round-3 xiaomeng review fix (2026-10-05): the in-session half of the
 * on_this_day trigger was dead — runTurn() never passed onThisDay into
 * evaluateOutreachTriggers. These tests prove the wiring chain:
 *   our-space store -> buildOnThisDayInput -> evaluateOutreachTriggers
 *   -> buildOutreachSection (the in-session prompt line).
 * runTurn() itself calls buildOnThisDayInput (verified by code review +
 * tsc; runTurn can't execute under tsx — react-native import graph, a
 * documented pre-existing limitation).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOnThisDayInput } from "../src/outreach/on-this-day-input.js";
import { buildOutreachSection } from "../src/outreach/prompt.js";
import {
  evaluateOutreachTriggers,
  type OutreachEvalInput,
} from "../src/outreach/engine.js";
import type { DiaryEntry } from "../src/our-space/store.js";

/** YYYY-MM-DD for this month-day last year (valid date, no Feb-29 trap). */
function sameMonthDayLastYear(): string {
  const now = new Date();
  let m = now.getMonth();
  let d = now.getDate();
  if (m === 1 && d === 29) d = 28;
  return `${now.getFullYear() - 1}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function diaryEntry(title: string, date: string): DiaryEntry {
  return { id: "d1", date, title, content: "content", createdAt: Date.now() };
}

const mockStore = (
  diary: DiaryEntry[],
  opts: { throwOnDiary?: boolean } = {},
) => ({
  listDiary: async () => {
    if (opts.throwOnDiary) throw new Error("disk gone");
    return diary;
  },
  listTimeline: async () => [],
  listAnniversaries: async () => [],
});

const baseInput: OutreachEvalInput = {
  frequency: "moderate",
  now: Date.now(),
  anniversaries: [],
  pendingTellLater: [],
  unreadLoveLetters: 0,
  lastOpenedAt: null,
  lastOutreachAt: {},
};

describe("on_this_day in-session wiring", () => {
  it("buildOnThisDayInput returns the top memory from this month-day last year", async () => {
    const got = await buildOnThisDayInput(
      mockStore([diaryEntry("第一次去海边", sameMonthDayLastYear())]),
    );
    assert.deepEqual(got, { title: "第一次去海边", yearsAgo: 1 });
  });

  it("buildOnThisDayInput returns null when no memory matches", async () => {
    const got = await buildOnThisDayInput(mockStore([]));
    assert.equal(got, null);
  });

  it("buildOnThisDayInput never throws when the store fails", async () => {
    const got = await buildOnThisDayInput(
      mockStore([diaryEntry("第一次去海边", sameMonthDayLastYear())], { throwOnDiary: true }),
    );
    assert.equal(got, null);
  });

  it("the input reaches the engine and renders the in-session prompt line", async () => {
    const input = await buildOnThisDayInput(
      mockStore([diaryEntry("第一次去海边", sameMonthDayLastYear())]),
    );
    assert.ok(input, "expected an input from the store");
    const triggers = evaluateOutreachTriggers({ ...baseInput, onThisDay: input });
    assert.equal(triggers[0].kind, "on_this_day");
    assert.equal(triggers[0].detail, "第一次去海边");
    assert.equal(triggers[0].yearsAgo, 1);
    const section = buildOutreachSection(triggers);
    assert.ok(section.includes("第一次去海边"), "prompt line must carry the memory title");
    assert.ok(section.includes("last year"), "prompt line must say when");
    assert.ok(
      section.includes("never a trivia dump"),
      "prompt line must keep the restraint",
    );
  });

  it("null input keeps the trigger off (no phantom on_this_day)", () => {
    const triggers = evaluateOutreachTriggers({ ...baseInput, onThisDay: null });
    assert.ok(
      triggers.every((t) => t.kind !== "on_this_day"),
      "no on_this_day trigger without data",
    );
  });
});
