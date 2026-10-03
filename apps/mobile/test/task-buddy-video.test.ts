/**
 * Task buddy video store tests — PURE module, no React Native needed.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  TaskBuddyVideoStore,
  type BuddyVideoStorage,
} from "../src/our-space/task-buddy-video.js";

function memStorage(): BuddyVideoStorage {
  const m = new Map<string, string>();
  return {
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => {
      m.set(k, v);
    },
  };
}

test("defaults are all null (bundled Sora clips)", async () => {
  const s = new TaskBuddyVideoStore(memStorage());
  assert.equal(s.get("running"), null);
  assert.equal(s.get("stuck"), null);
  assert.equal(s.get("done"), null);
});

test("set stores a custom video URI per state", async () => {
  const s = new TaskBuddyVideoStore(memStorage());
  await s.set("running", "file:///custom/working.mp4");
  assert.equal(s.get("running"), "file:///custom/working.mp4");
  // other states untouched
  assert.equal(s.get("stuck"), null);
});

test("blank URI resets to default", async () => {
  const s = new TaskBuddyVideoStore(memStorage());
  await s.set("done", "file:///custom/done.mp4");
  await s.set("done", "   ");
  assert.equal(s.get("done"), null);
});

test("clear resets a single state", async () => {
  const s = new TaskBuddyVideoStore(memStorage());
  await s.set("stuck", "file:///custom/idle.mp4");
  await s.clear("stuck");
  assert.equal(s.get("stuck"), null);
});

test("persists and hydrates across instances", async () => {
  const storage = memStorage();
  const s1 = new TaskBuddyVideoStore(storage);
  await s1.set("running", "file:///a.mp4");
  await s1.set("done", "file:///b.mp4");
  const s2 = new TaskBuddyVideoStore(storage);
  await s2.load();
  assert.equal(s2.get("running"), "file:///a.mp4");
  assert.equal(s2.get("done"), "file:///b.mp4");
  assert.equal(s2.get("stuck"), null);
});

test("corrupt storage keeps defaults", async () => {
  const m = new Map<string, string>();
  m.set("dudu.taskbuddy.v1.overrides", "not-json{{{");
  const s = new TaskBuddyVideoStore({
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => {
      m.set(k, v);
    },
  });
  await s.load();
  assert.equal(s.get("running"), null);
});

test("subscribers are notified on change", async () => {
  const s = new TaskBuddyVideoStore(memStorage());
  let calls = 0;
  s.subscribe(() => {
    calls += 1;
  });
  await s.set("running", "file:///x.mp4");
  assert.equal(calls, 1);
});
