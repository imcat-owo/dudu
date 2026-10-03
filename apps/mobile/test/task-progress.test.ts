/**
 * Task progress store tests — PURE module, no React Native needed.
 */

import assert from "node:assert/strict";
import test from "node:test";
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

function base(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Task ${id}`,
    progress: 0.5,
    stage: "working",
    status: "running" as const,
    backgroundUri: null,
    ...overrides,
  };
}

test("upserts and lists tasks", async () => {
  const s = new TaskProgressStore(memStorage());
  await s.upsert(base("a"));
  await s.upsert(base("b"));
  assert.equal(s.list().length, 2);
});

test("clamps progress to 0..1", async () => {
  const s = new TaskProgressStore(memStorage());
  const t = await s.upsert(base("a", { progress: 2.5 }));
  assert.equal(t.progress, 1);
  const t2 = await s.upsert(base("b", { progress: -1 }));
  assert.equal(t2.progress, 0);
});

test("auto-completes at progress 1", async () => {
  const s = new TaskProgressStore(memStorage());
  const t = await s.upsert(base("a", { progress: 1, status: "running" }));
  assert.equal(t.status, "done");
});

test("does not override explicit stuck at progress 1", async () => {
  const s = new TaskProgressStore(memStorage());
  const t = await s.upsert(base("a", { progress: 1, status: "stuck" }));
  assert.equal(t.status, "stuck");
});

test("done tasks sink below active ones", async () => {
  const s = new TaskProgressStore(memStorage());
  await s.upsert(base("done1", { progress: 1 }));
  await s.upsert(base("active1", { progress: 0.2 }));
  const list = s.list();
  assert.equal(list[0].id, "active1");
  assert.equal(list[1].id, "done1");
});

test("removes tasks", async () => {
  const s = new TaskProgressStore(memStorage());
  await s.upsert(base("a"));
  await s.remove("a");
  assert.equal(s.list().length, 0);
  assert.equal(s.get("a"), null);
});

test("sets background uri", async () => {
  const s = new TaskProgressStore(memStorage());
  await s.upsert(base("a"));
  await s.setBackground("a", "file://bg.png");
  assert.equal(s.get("a")?.backgroundUri, "file://bg.png");
  await s.setBackground("a", null);
  assert.equal(s.get("a")?.backgroundUri, null);
});

test("setBackground on missing task is a no-op", async () => {
  const s = new TaskProgressStore(memStorage());
  await s.setBackground("nope", "x"); // must not throw
});

test("notifies subscribers on upsert and remove", async () => {
  const s = new TaskProgressStore(memStorage());
  let n = 0;
  const unsub = s.subscribe(() => n++);
  await s.upsert(base("a"));
  await s.remove("a");
  assert.equal(n, 2);
  unsub();
  await s.upsert(base("b"));
  assert.equal(n, 2);
});

test("persists and hydrates via saveIndex/load", async () => {
  const storage = memStorage();
  const s1 = new TaskProgressStore(storage);
  await s1.upsert(base("a", { progress: 0.7 }));
  await s1.saveIndex();
  const s2 = new TaskProgressStore(storage);
  await s2.load();
  const t = s2.get("a");
  assert.equal(t?.progress, 0.7);
  assert.equal(t?.name, "Task a");
});

test("skips corrupt entries on load", async () => {
  const storage = memStorage();
  await storage.setItem("dudu.tasks.v1.__index", JSON.stringify(["a", "b"]));
  await storage.setItem("dudu.tasks.v1.a", "{not json");
  await storage.setItem(
    "dudu.tasks.v1.b",
    JSON.stringify({ ...base("b"), progress: 0.3, createdAt: 1, updatedAt: 2 }),
  );
  const s = new TaskProgressStore(storage);
  await s.load(); // must not throw
  assert.equal(s.get("b")?.progress, 0.3);
  assert.equal(s.get("a"), null);
});
