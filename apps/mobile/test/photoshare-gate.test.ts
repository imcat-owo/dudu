/**
 * AI photo share （主动发照片） — gate tests (PURE).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluatePhotoshareGate, type PhotoshareGateInput } from "../src/photoshare/gate.js";
import type { PhotoshareConfig } from "../src/photoshare/store.js";

// Tue 2026-10-06 20:00 Shanghai (awake).
const NOW_AWAKE = Date.UTC(2026, 9, 6, 12, 0, 0);
// Tue 2026-10-06 10:00 Shanghai (asleep).
const NOW_ASLEEP = Date.UTC(2026, 9, 6, 2, 0, 0);

const BASE_CONFIG: PhotoshareConfig = {
  enabled: true,
  slotCount: 2,
  dailyCap: 1,
  personaId: "personaA",
};

function baseInput(over: Partial<PhotoshareGateInput> = {}): PhotoshareGateInput {
  return {
    config: { ...BASE_CONFIG },
    isIncognito: false,
    slot: { index: 0, atMs: NOW_AWAKE, label: "evening" },
    fired: false,
    photosharesToday: 0,
    sharedSendsToday: 0,
    sharedCap: 3,
    msSinceLastActivity: 2 * 3_600_000,
    hasPersona: true,
    hasApiGroup: true,
    nowMs: NOW_AWAKE,
    ...over,
  };
}

describe("photoshare gate", () => {
  it("passes when everything is fine", () => {
    const r = evaluatePhotoshareGate(baseInput());
    assert.equal(r.allowed, true);
  });

  it("vetoes when the master toggle is off (default)", () => {
    const r = evaluatePhotoshareGate(baseInput({ config: { ...BASE_CONFIG, enabled: false } }));
    assert.equal(r.allowed, false);
    assert.equal(r.reason, "disabled");
  });

  it("vetoes in incognito", () => {
    const r = evaluatePhotoshareGate(baseInput({ isIncognito: true }));
    assert.equal(r.allowed, false);
    assert.equal(r.reason, "incognito");
  });

  it("vetoes during her sleep window (quiet hours)", () => {
    const r = evaluatePhotoshareGate(
      baseInput({ nowMs: NOW_ASLEEP, slot: { index: 0, atMs: NOW_ASLEEP, label: "waking" } }),
    );
    assert.equal(r.allowed, false);
    assert.equal(r.reason, "quiet-hours");
  });

  it("manual shares bypass quiet hours", () => {
    const r = evaluatePhotoshareGate(
      baseInput({
        nowMs: NOW_ASLEEP,
        slot: { index: -1, atMs: NOW_ASLEEP, label: "manual" },
        manual: true,
      }),
    );
    assert.equal(r.allowed, true);
  });

  it("vetoes already-fired slots", () => {
    const r = evaluatePhotoshareGate(baseInput({ fired: true }));
    assert.equal(r.allowed, false);
    assert.equal(r.reason, "already-fired");
  });

  it("vetoes expired slots", () => {
    const r = evaluatePhotoshareGate(
      baseInput({ slot: { index: 0, atMs: NOW_AWAKE - 20 * 60_000, label: "evening" } }),
    );
    assert.equal(r.allowed, false);
    assert.equal(r.reason, "expired");
  });

  it("vetoes at the daily photo cap", () => {
    const r = evaluatePhotoshareGate(baseInput({ photosharesToday: 1 }));
    assert.equal(r.allowed, false);
    assert.equal(r.reason, "photoshare-capped");
  });

  it("vetoes when the shared proactive cap is hit", () => {
    const r = evaluatePhotoshareGate(baseInput({ sharedSendsToday: 3, sharedCap: 3 }));
    assert.equal(r.allowed, false);
    assert.equal(r.reason, "shared-capped");
  });

  it("vetoes on 60-minute collision", () => {
    const r = evaluatePhotoshareGate(baseInput({ msSinceLastActivity: 10 * 60_000 }));
    assert.equal(r.allowed, false);
    assert.equal(r.reason, "collision");
  });

  it("vetoes without a persona or API group", () => {
    assert.equal(
      evaluatePhotoshareGate(baseInput({ hasPersona: false })).reason,
      "persona-missing",
    );
    assert.equal(evaluatePhotoshareGate(baseInput({ hasApiGroup: false })).reason, "no-api-group");
  });
});
