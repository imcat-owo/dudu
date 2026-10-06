/**
 * Daily mood check-in （每日心情 check-in） — store tests.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_CHECKIN_HOUR,
  isSleepHour,
  MOODCHECK_BACKUP_KEYS,
  MoodcheckStore,
} from "../src/moodcheck/store.js";

function fakeKv() {
  const map = new Map<string, string>();
  return {
    getItem: async (k: string) => map.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

// Tue 2026-10-06 20:00 Shanghai.
const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);

describe("moodcheck store", () => {
  it("config defaults: enabled, 20:00, no persona chosen", async () => {
    const store = new MoodcheckStore(fakeKv(), { nowMs: () => NOW });
    const c = await store.getConfig();
    assert.equal(c.enabled, true);
    assert.equal(c.hour, DEFAULT_CHECKIN_HOUR);
    assert.equal(c.hour, 20);
    assert.equal(c.personaId, "");
  });

  it("setConfig patches and persists", async () => {
    const store = new MoodcheckStore(fakeKv(), { nowMs: () => NOW });
    const next = await store.setConfig({ enabled: false, hour: 21 });
    assert.equal(next.enabled, false);
    assert.equal(next.hour, 21);
    const reread = await store.getConfig();
    assert.deepEqual(reread, next);
  });

  it("isSleepHour rejects 06:00–16:00, allows the rest", () => {
    for (let h = 6; h < 16; h++) assert.equal(isSleepHour(h), true, `hour ${h}`);
    for (const h of [0, 1, 5, 16, 17, 18, 20, 23]) assert.equal(isSleepHour(h), false, `hour ${h}`);
  });

  it("record creates one entry per persona per day; second record updates", async () => {
    const store = new MoodcheckStore(fakeKv(), { nowMs: () => NOW });
    const first = await store.record({
      personaId: "p1",
      mood: "有点累",
      note: "加班",
      source: "checkin",
    });
    assert.equal(first.dayKey, "2026-10-06");
    assert.equal(first.mood, "有点累");
    const second = await store.record({
      personaId: "p1",
      mood: "还行",
      source: "chat",
    });
    assert.equal(second.id, first.id, "same day + persona updates, never duplicates");
    assert.equal(second.mood, "还行");
    assert.equal(second.source, "chat");
    const all = await store.list();
    assert.equal(all.length, 1);
  });

  it("record keeps personas separate", async () => {
    const store = new MoodcheckStore(fakeKv(), { nowMs: () => NOW });
    await store.record({ personaId: "p1", mood: "好", source: "chat" });
    await store.record({ personaId: "p2", mood: "累", source: "chat" });
    assert.equal((await store.list()).length, 2);
    assert.ok(await store.getDay("2026-10-06", "p2"));
  });

  it("record rejects empty mood / missing persona", async () => {
    const store = new MoodcheckStore(fakeKv(), { nowMs: () => NOW });
    await assert.rejects(() => store.record({ personaId: "p1", mood: "  ", source: "chat" }));
    await assert.rejects(() => store.record({ personaId: "", mood: "好", source: "chat" }));
  });

  it("remove deletes; unknown id returns false", async () => {
    const store = new MoodcheckStore(fakeKv(), { nowMs: () => NOW });
    const e = await store.record({ personaId: "p1", mood: "好", source: "chat" });
    assert.equal(await store.remove(e.id), true);
    assert.equal(await store.remove(e.id), false);
    assert.equal((await store.list()).length, 0);
  });

  it("fire ledger: lastCheckinDay + outcome round-trip", async () => {
    const store = new MoodcheckStore(fakeKv(), { nowMs: () => NOW });
    assert.equal(await store.getLastCheckinDay(), "");
    await store.setLastCheckinDay("2026-10-06");
    assert.equal(await store.getLastCheckinDay(), "2026-10-06");
    await store.setLastOutcome("pending");
    assert.equal(await store.getLastOutcome(), "pending");
    await store.setLastOutcome("answered");
    assert.equal(await store.getLastOutcome(), "answered");
  });

  it("backup keys cover config + history + ledger", () => {
    assert.deepEqual([...MOODCHECK_BACKUP_KEYS], [
      "dudu.moodcheck.v1.config",
      "dudu.moodcheck.v1.history",
      "dudu.moodcheck.v1.lastCheckinDay",
      "dudu.moodcheck.v1.lastOutcome",
    ]);
  });
});
