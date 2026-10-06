/**
 * Daily mood check-in （每日心情 check-in） — Shanghai wall-clock tests.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  shanghaiDateLabel,
  shanghaiDayKey,
  shanghaiHourToday,
  shanghaiParts,
  shanghaiWallToMs,
} from "../src/moodcheck/time.js";

describe("moodcheck time helpers", () => {
  // Tue 2026-10-06 20:00 Shanghai == 12:00 UTC.
  const NIGHT = Date.UTC(2026, 9, 6, 12, 0, 0);

  it("shanghaiParts reports her wall clock, not UTC", () => {
    const p = shanghaiParts(NIGHT);
    assert.equal(p.y, 2026);
    assert.equal(p.mo, 10);
    assert.equal(p.d, 6);
    assert.equal(p.h, 20);
    assert.equal(p.mi, 0);
  });

  it("shanghaiDayKey is the YYYY-MM-DD of her day", () => {
    assert.equal(shanghaiDayKey(NIGHT), "2026-10-06");
    // 23:30 Shanghai on the 6th is still the 6th (15:30 UTC).
    assert.equal(shanghaiDayKey(Date.UTC(2026, 9, 6, 15, 30, 0)), "2026-10-06");
    // 00:30 Shanghai on the 7th is the 7th (16:30 UTC on the 6th).
    assert.equal(shanghaiDayKey(Date.UTC(2026, 9, 6, 16, 30, 0)), "2026-10-07");
  });

  it("shanghaiWallToMs round-trips through shanghaiParts", () => {
    const p = shanghaiParts(NIGHT);
    assert.equal(shanghaiWallToMs(p), NIGHT);
  });

  it("shanghaiHourToday is HH:00 on her current day", () => {
    // 20:00 Shanghai on 2026-10-06 == 12:00 UTC.
    assert.equal(shanghaiHourToday(NIGHT, 20), NIGHT);
    // 18:00 Shanghai on 2026-10-06 == 10:00 UTC.
    assert.equal(shanghaiHourToday(NIGHT, 18), Date.UTC(2026, 9, 6, 10, 0, 0));
  });

  it("shanghaiDateLabel is M月d日", () => {
    assert.equal(shanghaiDateLabel(NIGHT), "10月6日");
  });
});
