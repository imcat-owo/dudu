import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectNewMilestones,
  intimacyPhase,
  loadCelebratedMilestones,
  saveCelebratedMilestones,
  type KeyValueStorage,
} from "../src/romance/intimacy.js";
import {
  QUESTIONS,
  dateKey,
  questionForDate,
} from "../src/romance/questions.js";

function memStorage(seed: Record<string, string> = {}): KeyValueStorage {
  const m = new Map(Object.entries(seed));
  return {
    getItem: async (k) => (m.has(k) ? m.get(k)! : null),
    setItem: async (k, v) => {
      m.set(k, v);
    },
  };
}

describe("intimacyPhase", () => {
  it("is null without a start date (never invents a line)", () => {
    assert.equal(intimacyPhase(null), null);
    assert.equal(intimacyPhase(-5), null);
    assert.equal(intimacyPhase(NaN), null);
  });
  it("walks the quiet arc by days", () => {
    assert.equal(intimacyPhase(0), "budding");
    assert.equal(intimacyPhase(29), "budding");
    assert.equal(intimacyPhase(30), "warming");
    assert.equal(intimacyPhase(99), "warming");
    assert.equal(intimacyPhase(100), "steady");
    assert.equal(intimacyPhase(364), "steady");
    assert.equal(intimacyPhase(365), "deep");
    assert.equal(intimacyPhase(1000), "deep");
  });
});

describe("detectNewMilestones", () => {
  it("fires at 100/365 days and the 50th letter", () => {
    assert.deepEqual(
      detectNewMilestones({ days: 100, loveLetters: 3 }, []),
      ["days-100"],
    );
    assert.deepEqual(
      detectNewMilestones({ days: 400, loveLetters: 60 }, []),
      ["days-100", "days-365", "letters-50"],
    );
  });
  it("never refires celebrated milestones", () => {
    assert.deepEqual(
      detectNewMilestones({ days: 400, loveLetters: 60 }, [
        "days-100",
        "days-365",
        "letters-50",
      ]),
      [],
    );
    assert.deepEqual(
      detectNewMilestones({ days: 400, loveLetters: 60 }, ["days-100"]),
      ["days-365", "letters-50"],
    );
  });
  it("stays quiet below thresholds and without a start date", () => {
    assert.deepEqual(detectNewMilestones({ days: 99, loveLetters: 49 }, []), []);
    assert.deepEqual(
      detectNewMilestones({ days: null, loveLetters: 60 }, []),
      ["letters-50"],
    );
  });
});

describe("milestone persistence", () => {
  it("round-trips through storage and degrades on corrupt data", async () => {
    const s = memStorage();
    assert.deepEqual(await loadCelebratedMilestones(s), []);
    await saveCelebratedMilestones(s, ["days-100"]);
    assert.deepEqual(await loadCelebratedMilestones(s), ["days-100"]);
    const bad = memStorage({ "dudu.romance.milestones.v1": "not-json[" });
    assert.deepEqual(await loadCelebratedMilestones(bad), []);
  });
});

describe("question bank", () => {
  it("has 28 questions, unique ids, all four categories", () => {
    assert.equal(QUESTIONS.length, 28);
    assert.equal(new Set(QUESTIONS.map((q) => q.id)).size, 28);
    const cats = new Set(QUESTIONS.map((q) => q.category));
    assert.deepEqual([...cats].sort(), ["future", "icebreaker", "intimate", "memory"]);
    for (const q of QUESTIONS) {
      assert.ok(q.zh.trim().length > 0, `${q.id} zh`);
      assert.ok(q.en.trim().length > 0, `${q.id} en`);
    }
  });
  it("picks deterministically per date and rotates", () => {
    const a = questionForDate(new Date(2026, 9, 5));
    const b = questionForDate(new Date(2026, 9, 5, 23, 59));
    assert.equal(a.id, b.id, "same calendar day → same question");
    const ids = new Set<string>();
    for (let d = 0; d < 28; d++) ids.add(questionForDate(new Date(2026, 0, 1 + d)).id);
    assert.equal(ids.size, 28, "28 consecutive days cover the whole bank");
  });
  it("dateKey is device-local", () => {
    assert.equal(dateKey(new Date(2026, 9, 5)), "2026-10-05");
  });
});
