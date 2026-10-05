/**
 * Proactive initiative （主动约定） — rules engine tests (PURE).
 *
 * Hard guarantees under test:
 *  1. nextFireAt is exact on the Shanghai wall clock (her day, her timezone).
 *  2. A one_time rule in the past never fires again.
 *  3. Slots are unique per (rule, fire time).
 *  4. Invalid rule input is rejected with field-level errors.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeSchedule,
  type InitiativeRule,
  MIN_INTERVAL_MS,
  newRuleId,
  nextFireAt,
  shanghaiDayStart,
  slotId,
  validateRuleInput,
} from "../src/initiative/rules.js";

// 2026-10-05 12:00:00 Shanghai (CST = UTC+8, no DST).
const MON_NOON = Date.UTC(2026, 9, 5, 4, 0, 0);

function baseRule(over: Partial<InitiativeRule> = {}): InitiativeRule {
  return {
    id: "ir_test",
    personaId: "personaA",
    title: "早安",
    topic: "跟她说早安，问问她昨晚睡得好不好",
    type: "daily",
    schedule: { kind: "daily", hour: 8, minute: 0 },
    target: { mode: "latest" },
    status: "active",
    createdAt: MON_NOON - 86_400_000,
    ...over,
  };
}

describe("nextFireAt", () => {
  it("one_time in the future fires at atMs; in the past returns null", () => {
    const future = baseRule({
      type: "one_time",
      schedule: { kind: "one_time", atMs: MON_NOON + 3_600_000 },
    });
    assert.equal(nextFireAt(future, MON_NOON), MON_NOON + 3_600_000);

    const past = baseRule({
      type: "one_time",
      schedule: { kind: "one_time", atMs: MON_NOON - 3_600_000 },
    });
    assert.equal(nextFireAt(past, MON_NOON), null);
  });

  it("daily: later today stays today, earlier today rolls to tomorrow (Shanghai)", () => {
    // Shanghai 12:00 now; 13:00 today, 11:00 tomorrow.
    const later = baseRule({ schedule: { kind: "daily", hour: 13, minute: 0 } });
    assert.equal(nextFireAt(later, MON_NOON), Date.UTC(2026, 9, 5, 5, 0, 0));

    const earlier = baseRule({ schedule: { kind: "daily", hour: 11, minute: 0 } });
    assert.equal(nextFireAt(earlier, MON_NOON), Date.UTC(2026, 9, 6, 3, 0, 0));
  });

  it("daily: exact-now rolls to tomorrow (strictly future)", () => {
    const noon = baseRule({ schedule: { kind: "daily", hour: 12, minute: 0 } });
    assert.equal(nextFireAt(noon, MON_NOON), Date.UTC(2026, 9, 6, 4, 0, 0));
  });

  it("interval: walks the cadence forward from the anchor", () => {
    const r = baseRule({
      type: "interval",
      schedule: { kind: "interval", everyMs: 3_600_000, anchorMs: MON_NOON - 90 * 60_000 },
    });
    assert.equal(nextFireAt(r, MON_NOON), MON_NOON + 30 * 60_000);
  });

  it("interval: future anchor fires at the anchor", () => {
    const r = baseRule({
      type: "interval",
      schedule: { kind: "interval", everyMs: 3_600_000, anchorMs: MON_NOON + 10 * 60_000 },
    });
    assert.equal(nextFireAt(r, MON_NOON), MON_NOON + 10 * 60_000);
  });
});

describe("shanghaiDayStart", () => {
  it("same Shanghai day -> same start; different day -> different start", () => {
    const a = shanghaiDayStart(MON_NOON);
    const b = shanghaiDayStart(MON_NOON + 3_600_000);
    const c = shanghaiDayStart(MON_NOON + 13 * 3_600_000); // next day 01:00 Shanghai
    assert.equal(a, b);
    assert.notEqual(a, c);
    // Day start is midnight Shanghai = 16:00 UTC previous day.
    assert.equal(a, Date.UTC(2026, 9, 4, 16, 0, 0));
  });
});

describe("slotId", () => {
  it("is unique per (rule, fire time)", () => {
    assert.equal(slotId("r1", 100), "r1:100");
    assert.notEqual(slotId("r1", 100), slotId("r1", 101));
    assert.notEqual(slotId("r1", 100), slotId("r2", 100));
  });
});

describe("newRuleId", () => {
  it("generates unique ids", () => {
    assert.notEqual(newRuleId(), newRuleId());
  });
});

describe("validateRuleInput", () => {
  it("accepts a valid daily rule", () => {
    const errs = validateRuleInput({
      personaId: "p1",
      title: "早安",
      topic: "说早安",
      type: "daily",
      schedule: { kind: "daily", hour: 8, minute: 30 },
      target: { mode: "latest" },
    });
    assert.deepEqual(errs, []);
  });

  it("rejects missing persona/title/topic with field errors", () => {
    const errs = validateRuleInput({
      personaId: "",
      title: "  ",
      topic: "",
      type: "daily",
      schedule: { kind: "daily", hour: 8, minute: 0 },
    });
    const fields = errs.map((e) => e.field);
    assert.ok(fields.includes("personaId"));
    assert.ok(fields.includes("title"));
    assert.ok(fields.includes("topic"));
  });

  it("rejects out-of-range daily time and short intervals", () => {
    const badHour = validateRuleInput({
      personaId: "p",
      title: "t",
      topic: "x",
      type: "daily",
      schedule: { kind: "daily", hour: 25, minute: 0 },
    });
    assert.ok(badHour.some((e) => e.field === "schedule.hour"));

    const short = validateRuleInput({
      personaId: "p",
      title: "t",
      topic: "x",
      type: "interval",
      schedule: { kind: "interval", everyMs: MIN_INTERVAL_MS - 1 },
    });
    assert.ok(short.some((e) => e.field === "schedule.everyMs"));
  });

  it("rejects one_time without atMs and bad pinned targets", () => {
    const noAt = validateRuleInput({
      personaId: "p",
      title: "t",
      topic: "x",
      type: "one_time",
      schedule: { kind: "one_time" },
    });
    assert.ok(noAt.some((e) => e.field === "schedule.atMs"));

    const badTarget = validateRuleInput({
      personaId: "p",
      title: "t",
      topic: "x",
      type: "daily",
      schedule: { kind: "daily", hour: 8, minute: 0 },
      target: { mode: "pinned", threadId: "" },
    });
    assert.ok(badTarget.some((e) => e.field === "target.threadId"));
  });
});

describe("describeSchedule", () => {
  it("summarizes each schedule kind", () => {
    assert.ok(describeSchedule(baseRule()).includes("每天 08:00"));
    assert.ok(
      describeSchedule(
        baseRule({ type: "one_time", schedule: { kind: "one_time", atMs: MON_NOON } }),
      ).includes("一次"),
    );
    assert.ok(
      describeSchedule(
        baseRule({ type: "interval", schedule: { kind: "interval", everyMs: 7_200_000 } }),
      ).includes("2 小时"),
    );
  });
});
