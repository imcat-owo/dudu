/**
 * Personal greeting composer — regression tests. The rules:
 *  1. Anchors beat rhythm: anniversary today > anniversary soon > unread
 *     letter > her moment.
 *  2. Rhythm titles run on HER clock, never the wall clock.
 *  3. No anchor = soft body line, never an invented reason.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { composeGreeting } from "../src/chat/greeting.js";

const EMPTY = { anniversaries: [], unseenLoveLetters: 0, pendingTellLater: 0 };

describe("composeGreeting", () => {
  it("an anniversary today wins over everything", () => {
    const g = composeGreeting("evening", {
      ...EMPTY,
      anniversaries: [{ title: "相识纪念日", daysUntil: 0 }],
      unseenLoveLetters: 2,
    });
    assert.equal(g.titleKey, "chat.greet.anniversaryToday");
    assert.deepEqual(g.titleParams, { title: "相识纪念日" });
  });

  it("an anniversary within 3 days carries the countdown", () => {
    const g = composeGreeting("late-night", {
      ...EMPTY,
      anniversaries: [{ title: "相识纪念日", daysUntil: 2 }],
    });
    assert.equal(g.titleKey, "chat.greet.anniversarySoon");
    assert.deepEqual(g.titleParams, { title: "相识纪念日", days: 2 });
  });

  it("an unread letter beats a bare rhythm greeting", () => {
    const g = composeGreeting("evening", { ...EMPTY, unseenLoveLetters: 1 });
    assert.equal(g.titleKey, "chat.greet.letterWaiting");
  });

  it("falls back to her moment — never a generic morning greeting", () => {
    assert.equal(composeGreeting("waking", EMPTY).titleKey, "chat.greet.rhythm.waking");
    assert.equal(composeGreeting("evening", EMPTY).titleKey, "chat.greet.rhythm.evening");
    assert.equal(composeGreeting("late-night", EMPTY).titleKey, "chat.greet.rhythm.lateNight");
    assert.equal(composeGreeting("pre-dawn", EMPTY).titleKey, "chat.greet.rhythm.preDawn");
    for (const m of ["waking", "evening", "late-night", "pre-dawn", "deep-sleep"] as const) {
      const key = composeGreeting(m, EMPTY).titleKey;
      assert.ok(!key.includes("morning") && !key.includes("welcomeTitle"), key);
    }
  });

  it("the body carries the tell-later count when there is one", () => {
    const g = composeGreeting("evening", { ...EMPTY, pendingTellLater: 3 });
    assert.equal(g.bodyKey, "chat.greet.body.tellLater");
    assert.deepEqual(g.bodyParams, { n: 3 });
  });

  it("the body is a soft line when there is nothing pending", () => {
    const g = composeGreeting("evening", EMPTY);
    assert.equal(g.bodyKey, "chat.greet.body.soft");
    assert.equal(g.bodyParams, undefined);
  });
});
