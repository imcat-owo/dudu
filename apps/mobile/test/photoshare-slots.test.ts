/**
 * AI photo share （主动发照片） — slots tests (PURE).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shanghaiDayStart } from "../src/initiative/rules.js";
import {
  clampSlotCount,
  dueSlot,
  isSlotExpired,
  PHOTOSHARE_SLOT_CANDIDATES,
  PHOTOSHARE_SLOT_COUNT_DEFAULT,
  photoshareSlotId,
  photoshareSlotsToday,
} from "../src/photoshare/slots.js";

// Tue 2026-10-06 12:00 UTC = 20:00 Shanghai.
const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);

describe("photoshare slots", () => {
  it("defaults to 2 quiet moments per day", () => {
    assert.equal(PHOTOSHARE_SLOT_COUNT_DEFAULT, 2);
    assert.equal(clampSlotCount(undefined), 2);
  });

  it("computes today's slots on the Shanghai wall clock", () => {
    const slots = photoshareSlotsToday(2, NOW);
    assert.equal(slots.length, 2);
    // First candidate is 20:00 Shanghai = 12:00 UTC.
    assert.equal(slots[0].atMs, NOW);
    assert.equal(slots[0].label, "evening");
    // Second candidate is 00:30 Shanghai the SAME calendar day
    // (Oct 6 00:30 Shanghai = Oct 5 16:30 UTC) — same as the self-post
    // trigger's late-night slots: it fires when the tick runs at 00:30.
    assert.equal(slots[1].atMs, Date.UTC(2026, 9, 5, 16, 30, 0));
    assert.equal(slots[1].label, "late-night");
  });

  it("never places a slot inside her 06:00–16:00 sleep window", () => {
    for (const c of PHOTOSHARE_SLOT_CANDIDATES) {
      assert.ok(c.h < 6 || c.h >= 16, `candidate ${c.h}:${c.mi} is inside her sleep window`);
    }
  });

  it("finds the most recent due unfired slot", () => {
    const slots = photoshareSlotsToday(4, NOW);
    const dayStart = shanghaiDayStart(NOW);
    // At 20:00 Shanghai: slots 0 (20:00), 1 (00:30), 2 (17:00) are due;
    // slot 3 (22:30) is in the future. Most recent = 0.
    const due = dueSlot(slots, new Set(), dayStart, NOW);
    assert.ok(due);
    assert.equal(due.index, 0);
    // After firing slot 0, slot 2 (17:00) is the next most recent due.
    const fired = new Set([photoshareSlotId(dayStart, 0)]);
    const due2 = dueSlot(slots, fired, dayStart, NOW);
    assert.ok(due2);
    assert.equal(due2.index, 2);
    // After firing all past slots, nothing is due.
    fired.add(photoshareSlotId(dayStart, 2));
    fired.add(photoshareSlotId(dayStart, 1));
    assert.equal(dueSlot(slots, fired, dayStart, NOW), null);
  });

  it("slot ids are stable per Shanghai day + index", () => {
    const dayStart = shanghaiDayStart(NOW);
    assert.equal(photoshareSlotId(dayStart, 1), `photoshare:${dayStart}:1`);
  });

  it("expiry uses the 15-minute grace window", () => {
    assert.equal(isSlotExpired(NOW - 16 * 60_000, NOW), true);
    assert.equal(isSlotExpired(NOW - 14 * 60_000, NOW), false);
  });

  it("clamps slot count to 1..4", () => {
    assert.equal(clampSlotCount(0), 1);
    assert.equal(clampSlotCount(99), 4);
    assert.equal(clampSlotCount(3), 3);
  });
});
