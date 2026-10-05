/**
 * Task card accent tests — per-card accent color (curated palette keys).
 * PURE modules, no React Native needed.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  isTaskCardAccent,
  TASK_CARD_ACCENTS,
  TaskProgressStore,
  type TaskStorage,
} from "../src/our-space/task-progress.js";
import { createTaskProgressTools } from "../src/our-space/tools.js";

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

const ctx = { authorize: async () => true };

function toolsFor(store: TaskProgressStore) {
  const tools = createTaskProgressTools(store);
  const byName = (name: string) => {
    const t = tools.find((x) => x.name === name);
    assert.ok(t, `tool ${name} must exist`);
    return t;
  };
  return {
    setStyle: byName("task_card_set_style"),
    update: byName("task_progress_update"),
  };
}

test("accent round-trips through saveIndex/load", async () => {
  const storage = memStorage();
  const s1 = new TaskProgressStore(storage);
  await s1.upsert({ ...base("a"), accent: "pink" });
  await s1.saveIndex();
  const s2 = new TaskProgressStore(storage);
  await s2.load();
  assert.equal(s2.get("a")?.accent, "pink");
});

test("old persisted tasks without accent normalize to null on load", async () => {
  const storage = memStorage();
  // Simulate a task persisted before the accent field existed (no accent key).
  const legacy = { ...base("a"), createdAt: 1, updatedAt: 2 };
  assert.ok(!("accent" in legacy));
  await storage.setItem("dudu.tasks.v1.__index", JSON.stringify(["a"]));
  await storage.setItem("dudu.tasks.v1.a", JSON.stringify(legacy));
  const s = new TaskProgressStore(storage);
  await s.load();
  assert.equal(s.get("a")?.accent, null);
});

test("garbage accent values normalize to null, never persisted as garbage", async () => {
  const s = new TaskProgressStore(memStorage());
  const t = await s.upsert({ ...base("a"), accent: "hotpink" as never });
  assert.equal(t.accent, null);
  assert.equal(s.get("a")?.accent, null);
});

test("new tasks default to null accent", async () => {
  const s = new TaskProgressStore(memStorage());
  const t = await s.upsert(base("a"));
  assert.equal(t.accent, null);
});

test("setAccent sets and clears", async () => {
  const s = new TaskProgressStore(memStorage());
  await s.upsert(base("a"));
  await s.setAccent("a", "mint");
  assert.equal(s.get("a")?.accent, "mint");
  await s.setAccent("a", null);
  assert.equal(s.get("a")?.accent, null);
});

test("setAccent on unknown id is a silent no-op (mirrors setBackground)", async () => {
  const s = new TaskProgressStore(memStorage());
  await s.setAccent("nope", "pink"); // must not throw
});

test("isTaskCardAccent accepts the 5 curated keys only", () => {
  assert.deepEqual([...TASK_CARD_ACCENTS], ["pink", "blue", "mint", "yellow", "lavender"]);
  for (const k of TASK_CARD_ACCENTS) assert.ok(isTaskCardAccent(k));
  assert.ok(!isTaskCardAccent("hotpink"));
  assert.ok(!isTaskCardAccent("blue ")); // no whitespace tricks
  assert.ok(!isTaskCardAccent(null));
  assert.ok(!isTaskCardAccent(undefined));
  assert.ok(!isTaskCardAccent(42));
});

test("task_card_set_style sets the accent", async () => {
  const s = new TaskProgressStore(memStorage());
  await s.upsert(base("a"));
  const { setStyle } = toolsFor(s);
  const msg = await setStyle.run({ id: "a", accent: "lavender" }, ctx);
  assert.match(msg, /lavender/);
  assert.equal(s.get("a")?.accent, "lavender");
});

test("task_card_set_style clear resets to theme default", async () => {
  const s = new TaskProgressStore(memStorage());
  await s.upsert({ ...base("a"), accent: "pink" });
  const { setStyle } = toolsFor(s);
  const msg = await setStyle.run({ id: "a", clear: true }, ctx);
  assert.match(msg, /theme default/);
  assert.equal(s.get("a")?.accent, null);
});

test("task_card_set_style rejects unknown accent keys honestly", async () => {
  const s = new TaskProgressStore(memStorage());
  await s.upsert(base("a"));
  const { setStyle } = toolsFor(s);
  await assert.rejects(() => setStyle.run({ id: "a", accent: "hotpink" }, ctx), /Unknown accent/);
  assert.equal(s.get("a")?.accent, null); // unchanged
});

test("task_card_set_style rejects missing id and ambiguous args", async () => {
  const s = new TaskProgressStore(memStorage());
  await s.upsert(base("a"));
  const { setStyle } = toolsFor(s);
  await assert.rejects(() => setStyle.run({ id: "ghost", accent: "pink" }, ctx), /No task card/);
  await assert.rejects(() => setStyle.run({ id: "a" }, ctx), /exactly one of/);
  await assert.rejects(
    () => setStyle.run({ id: "a", accent: "pink", clear: true }, ctx),
    /exactly one of/,
  );
});

test("task_card_set_style has the same guardrails as the background tool", async () => {
  const s = new TaskProgressStore(memStorage());
  const { setStyle } = toolsFor(s);
  assert.match(setStyle.description, /ONLY when she explicitly asks/);
  assert.match(setStyle.description, /Never call unprompted/);
  assert.match(setStyle.description, /never overwrite a color she set herself/);
  assert.equal(setStyle.manualId, "our-space");
});

test("task_progress_update preserves an existing accent", async () => {
  const s = new TaskProgressStore(memStorage());
  await s.upsert({ ...base("a"), accent: "mint" });
  const { update } = toolsFor(s);
  await update.run({ id: "a", name: "Task a", progress: 0.8 }, ctx);
  assert.equal(s.get("a")?.accent, "mint");
  assert.equal(s.get("a")?.progress, 0.8);
});
