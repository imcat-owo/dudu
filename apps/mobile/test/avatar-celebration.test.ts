/**
 * Avatar celebration tests (A3 wiring) — PURE modules, no React Native needed.
 *
 * Covers: the celebration store (trigger / once-per-day anniversary guard /
 * subscriber notification) and the task-progress → celebration hookup
 * (a task freshly reaching done triggers the milestone clip; re-upserting
 * an already-done task does not).
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  getCelebrateUntil,
  resetCelebrationForTests,
  setCelebrationStorage,
  subscribeCelebration,
  triggerAnniversaryCelebration,
  triggerMilestoneCelebration,
} from "../src/avatar-celebration.js";
import { MILESTONE_CELEBRATION_MS, resolveAvatarState } from "../src/avatar-state.js";
import { TaskProgressStore, type TaskStorage } from "../src/our-space/task-progress.js";

function memStorage(): TaskStorage {
  const m = new Map<string, string>();
  return {
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => {
      m.set(k, v);
    },
    removeItem: async (k) => {
      m.delete(k);
    },
  };
}

beforeEach(() => {
  resetCelebrationForTests();
  setCelebrationStorage(null);
});

describe("celebration store", () => {
  it("triggerMilestoneCelebration opens an 8s window", () => {
    triggerMilestoneCelebration(1_000_000);
    assert.equal(getCelebrateUntil(), 1_000_000 + MILESTONE_CELEBRATION_MS);
    assert.equal(MILESTONE_CELEBRATION_MS, 8000);
  });

  it("notifies subscribers on trigger and stops after unsubscribe", () => {
    let calls = 0;
    const unsub = subscribeCelebration(() => {
      calls += 1;
    });
    triggerMilestoneCelebration(1000);
    assert.equal(calls, 1);
    unsub();
    triggerMilestoneCelebration(2000);
    assert.equal(calls, 1);
  });

  it("anniversary celebration fires at most once per day", async () => {
    assert.equal(await triggerAnniversaryCelebration("Mon Oct 05 2026", 1000), true);
    assert.equal(await triggerAnniversaryCelebration("Mon Oct 05 2026", 2000), false);
    assert.equal(await triggerAnniversaryCelebration("Tue Oct 06 2026", 3000), true);
  });

  it("anniversary guard persists across an app restart (kill-and-reopen)", async () => {
    const backing = new Map<string, string>();
    setCelebrationStorage({
      getItem: async (k) => backing.get(k) ?? null,
      setItem: async (k, v) => {
        backing.set(k, v);
      },
    });
    // Anniversary day: first trigger celebrates and persists the day key.
    assert.equal(await triggerAnniversaryCelebration("Mon Oct 05 2026", 1000), true);
    assert.equal(backing.get("dudu.avatar.anniversary-day.v1"), "Mon Oct 05 2026");
    const firstUntil = getCelebrateUntil();
    assert.ok(firstUntil > 0);
    // Simulate kill-and-reopen: module memory wiped, storage intact.
    resetCelebrationForTests();
    assert.equal(getCelebrateUntil(), 0);
    // Same day: no second celebration — the persisted guard holds.
    assert.equal(await triggerAnniversaryCelebration("Mon Oct 05 2026", 2000), false);
    assert.equal(getCelebrateUntil(), 0);
    // Next day: celebrates again.
    assert.equal(await triggerAnniversaryCelebration("Tue Oct 06 2026", 3000), true);
    assert.ok(getCelebrateUntil() > 0);
    assert.equal(backing.get("dudu.avatar.anniversary-day.v1"), "Tue Oct 06 2026");
  });

  it("storage failure degrades to the in-memory guard (no crash)", async () => {
    setCelebrationStorage({
      getItem: async () => {
        throw new Error("disk gone");
      },
      setItem: async () => {
        throw new Error("disk gone");
      },
    });
    assert.equal(await triggerAnniversaryCelebration("Mon Oct 05 2026", 1000), true);
    assert.equal(await triggerAnniversaryCelebration("Mon Oct 05 2026", 2000), false);
  });

  it("resolveAvatarState prioritizes celebration, then making, then working", () => {
    const now = 1_000_000;
    const celebrateUntil = now + 5000;
    // Celebration wins over everything.
    assert.equal(
      resolveAvatarState({ busy: true, running: true, makingSomething: true, celebrateUntil, now }),
      "milestone_level_up",
    );
    // After the window lapses, falls back to the live signals.
    assert.equal(
      resolveAvatarState({
        busy: true,
        running: true,
        makingSomething: true,
        celebrateUntil,
        now: celebrateUntil + 1,
      }),
      "making_something",
    );
    assert.equal(resolveAvatarState({ busy: true, running: false, now }), "working");
    assert.equal(resolveAvatarState({ busy: false, running: false, now }), "idle");
  });
});

describe("task-progress → celebration hookup", () => {
  it("a task freshly reaching done triggers the milestone clip", async () => {
    const store = new TaskProgressStore(memStorage());
    await store.upsert({
      id: "t1",
      name: "Task 1",
      progress: 0.5,
      stage: "working",
      status: "running",
      backgroundUri: null,
    });
    assert.equal(getCelebrateUntil(), 0);
    const before = Date.now();
    await store.upsert({
      id: "t1",
      name: "Task 1",
      progress: 1,
      stage: "finishing",
      status: "running",
      backgroundUri: null,
    });
    const until = getCelebrateUntil();
    assert.ok(until >= before + MILESTONE_CELEBRATION_MS);
    assert.ok(until <= Date.now() + MILESTONE_CELEBRATION_MS);
  });

  it("re-upserting an already-done task does not re-trigger", async () => {
    const store = new TaskProgressStore(memStorage());
    await store.upsert({
      id: "t1",
      name: "Task 1",
      progress: 1,
      stage: "done",
      status: "done",
      backgroundUri: null,
    });
    const first = getCelebrateUntil();
    assert.ok(first > 0);
    await store.upsert({
      id: "t1",
      name: "Task 1",
      progress: 1,
      stage: "done",
      status: "done",
      backgroundUri: null,
    });
    assert.equal(getCelebrateUntil(), first);
  });

  it("a direct done upsert (no previous record) still celebrates once", async () => {
    const store = new TaskProgressStore(memStorage());
    await store.upsert({
      id: "t2",
      name: "Task 2",
      progress: 1,
      stage: "done",
      status: "done",
      backgroundUri: null,
    });
    assert.ok(getCelebrateUntil() > 0);
  });
});
