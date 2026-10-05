/**
 * Proactive initiative （主动约定） — store tests.
 *
 * Under test: CRUD, archive/restore, delete (drops fired slots),
 * slot-ledger idempotency, daily cap get/set/clamp, per-persona
 * per-day send counting.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_DAILY_CAP } from "../src/initiative/rules.js";
import { InitiativeStore } from "../src/initiative/store.js";

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: async (k: string) => map.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

// 2026-10-05 12:00 Shanghai.
const MON_NOON = Date.UTC(2026, 9, 5, 4, 0, 0);

describe("InitiativeStore CRUD", () => {
  it("creates, lists, and gets rules", async () => {
    const store = new InitiativeStore(fakeStorage(), { nowMs: () => MON_NOON });
    const rule = await store.create({
      personaId: "pA",
      title: "早安",
      topic: "说早安",
      type: "daily",
      schedule: { kind: "daily", hour: 8, minute: 0 },
    });
    assert.ok(rule.id);
    assert.equal(rule.status, "active");
    assert.deepEqual(rule.target, { mode: "latest" });

    const listed = await store.list();
    assert.equal(listed.length, 1);
    assert.equal((await store.get(rule.id))?.title, "早安");
    assert.equal(await store.get("nope"), null);
  });

  it("archives and restores; list(false) hides archived", async () => {
    const store = new InitiativeStore(fakeStorage(), { nowMs: () => MON_NOON });
    const rule = await store.create({
      personaId: "pA",
      title: "午安",
      topic: "说午安",
      type: "daily",
      schedule: { kind: "daily", hour: 12, minute: 0 },
    });
    assert.equal(await store.setStatus(rule.id, "archived"), true);
    assert.equal((await store.get(rule.id))?.status, "archived");
    assert.equal((await store.list(false)).length, 0);
    assert.equal((await store.list(true)).length, 1);
    assert.equal(await store.setStatus(rule.id, "active"), true);
    assert.equal((await store.list(false)).length, 1);
    assert.equal(await store.setStatus("nope", "archived"), false);
  });

  it("delete removes the rule and its fired slots", async () => {
    const store = new InitiativeStore(fakeStorage(), { nowMs: () => MON_NOON });
    const rule = await store.create({
      personaId: "pA",
      title: "晚安",
      topic: "说晚安",
      type: "daily",
      schedule: { kind: "daily", hour: 22, minute: 0 },
    });
    await store.markSlotFired(`${rule.id}:123`);
    assert.equal(await store.wasSlotFired(`${rule.id}:123`), true);
    assert.equal(await store.remove(rule.id), true);
    assert.equal(await store.get(rule.id), null);
    assert.equal(await store.wasSlotFired(`${rule.id}:123`), false);
    assert.equal(await store.remove(rule.id), false);
  });
});

describe("slot ledger", () => {
  it("markSlotFired is idempotent; wasSlotFired answers", async () => {
    const store = new InitiativeStore(fakeStorage(), { nowMs: () => MON_NOON });
    assert.equal(await store.wasSlotFired("r:1"), false);
    await store.markSlotFired("r:1");
    await store.markSlotFired("r:1");
    assert.equal(await store.wasSlotFired("r:1"), true);
  });
});

describe("daily cap", () => {
  it("defaults to 3, sets and clamps", async () => {
    const store = new InitiativeStore(fakeStorage(), { nowMs: () => MON_NOON });
    assert.equal(await store.getDailyCap(), DEFAULT_DAILY_CAP);
    assert.equal(DEFAULT_DAILY_CAP, 3);
    await store.setDailyCap(5);
    assert.equal(await store.getDailyCap(), 5);
    await store.setDailyCap(0);
    assert.equal(await store.getDailyCap(), 1);
    await store.setDailyCap(999);
    assert.equal(await store.getDailyCap(), 50);
  });

  it("counts sends per persona per Shanghai day", async () => {
    const store = new InitiativeStore(fakeStorage(), { nowMs: () => MON_NOON });
    await store.recordSend("pA", MON_NOON);
    await store.recordSend("pA", MON_NOON + 3_600_000);
    await store.recordSend("pB", MON_NOON);
    // Next Shanghai day: 2026-10-06 01:00 Shanghai.
    const nextDay = MON_NOON + 13 * 3_600_000;
    await store.recordSend("pA", nextDay);
    assert.equal(await store.countSendsToday("pA", MON_NOON), 2);
    assert.equal(await store.countSendsToday("pB", MON_NOON), 1);
    assert.equal(await store.countSendsToday("pA", nextDay), 1);
    // Still Oct 5 in Shanghai (23:00): same-day sends counted.
    assert.equal(await store.countSendsToday("pA", MON_NOON + 11 * 3_600_000), 2);
  });
});
