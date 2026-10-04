/**
 * Her rhythm (作息感知) — regression tests. The guarantees:
 *  1. Her sleep window is 06:00–16:00 Shanghai — never treat it as available.
 *  2. describeHerMoment runs on HER clock, not the wall clock.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildHerRhythmSection,
  describeHerMoment,
  isHerSleepTime,
} from "../src/our-space/her-rhythm.js";

/** A fixed instant whose Shanghai local time is `hour:30`. */
function shanghaiAt(hour: number): number {
  // 2026-10-05 00:30 UTC = 08:30 Shanghai (UTC+8, no DST).
  return Date.UTC(2026, 9, 4, hour - 8, 30, 0);
}

describe("isHerSleepTime", () => {
  it("treats 06:00–16:00 Shanghai as her sleep window", () => {
    assert.equal(isHerSleepTime(shanghaiAt(8)), true);
    assert.equal(isHerSleepTime(shanghaiAt(15)), true);
    assert.equal(isHerSleepTime(shanghaiAt(20)), false);
    assert.equal(isHerSleepTime(shanghaiAt(2)), false);
  });
  it("is inclusive at 06:00, exclusive at 16:00", () => {
    assert.equal(isHerSleepTime(shanghaiAt(6)), true);
    assert.equal(isHerSleepTime(shanghaiAt(16)), false);
  });
});

describe("describeHerMoment", () => {
  it("maps Shanghai hours onto her day", () => {
    assert.equal(describeHerMoment(shanghaiAt(8)), "deep-sleep");
    assert.equal(describeHerMoment(shanghaiAt(16)), "waking");
    assert.equal(describeHerMoment(shanghaiAt(21)), "evening");
    assert.equal(describeHerMoment(shanghaiAt(1)), "late-night");
    assert.equal(describeHerMoment(shanghaiAt(4)), "pre-dawn");
  });
});

describe("buildHerRhythmSection", () => {
  it("always names the sleep window and the quiet rule", () => {
    const s = buildHerRhythmSection(shanghaiAt(22));
    assert.match(s, /06:00–16:00/);
    assert.match(s, /night owl/);
    assert.match(s, /anniversary/);
  });
  it("describes the current moment truthfully", () => {
    assert.match(buildHerRhythmSection(shanghaiAt(9)), /asleep/);
    assert.match(buildHerRhythmSection(shanghaiAt(22)), /active hours/);
  });
});
