/**
 * task_card_set_background tests — the AI background tool for task cards.
 * PURE modules, no React Native needed.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { TaskProgressStore, type TaskStorage } from "../src/our-space/task-progress.js";
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

async function makeStore() {
  const store = new TaskProgressStore(memStorage());
  await store.upsert({
    id: "kb-index",
    name: "知识库索引",
    progress: 0.3,
    stage: "reading",
    status: "running",
    backgroundUri: null,
  });
  return store;
}

function toolsFor(store: TaskProgressStore) {
  const tools = createTaskProgressTools(store);
  const byName = (name: string) => {
    const t = tools.find((x) => x.name === name);
    assert.ok(t, `tool ${name} must exist`);
    return t;
  };
  return {
    setBackground: byName("task_card_set_background"),
    update: byName("task_progress_update"),
  };
}

const ctx = { authorize: async () => true };

test("uri sets the card background", async () => {
  const store = await makeStore();
  const { setBackground } = toolsFor(store);
  const msg = await setBackground.run({ id: "kb-index", uri: "file:///tmp/her-photo.jpg" }, ctx);
  assert.match(msg, /background/);
  assert.equal(store.get("kb-index")?.backgroundUri, "file:///tmp/her-photo.jpg");
});

test("prompt generates a background via the shared image path", async () => {
  const store = await makeStore();
  const { setBackground } = toolsFor(store);
  await setBackground.run({ id: "kb-index", prompt: "starry night cat" }, ctx);
  const bg = store.get("kb-index")?.backgroundUri;
  assert.ok(bg, "background must be set");
  assert.ok(
    bg.startsWith("https://image.pollinations.ai/prompt/"),
    `must use buildImageUrl, got ${bg}`,
  );
  assert.ok(bg.includes(encodeURIComponent("starry night cat")), "prompt must be in the URL");
  assert.ok(bg.includes("width=800"), "must use card dimensions");
});

test("clear resets the background to null", async () => {
  const store = await makeStore();
  const { setBackground } = toolsFor(store);
  await setBackground.run({ id: "kb-index", uri: "file:///tmp/x.jpg" }, ctx);
  assert.equal(store.get("kb-index")?.backgroundUri, "file:///tmp/x.jpg");
  await setBackground.run({ id: "kb-index", clear: true }, ctx);
  assert.equal(store.get("kb-index")?.backgroundUri, null);
});

test("task_progress_update still preserves an existing background", async () => {
  const store = await makeStore();
  const { setBackground, update } = toolsFor(store);
  await setBackground.run({ id: "kb-index", uri: "file:///tmp/keep-me.jpg" }, ctx);
  await update.run({ id: "kb-index", name: "知识库索引", progress: 0.9, stage: "almost" }, ctx);
  assert.equal(store.get("kb-index")?.backgroundUri, "file:///tmp/keep-me.jpg");
  assert.equal(store.get("kb-index")?.progress, 0.9);
});

test("unknown task id fails honestly", async () => {
  const store = await makeStore();
  const { setBackground } = toolsFor(store);
  await assert.rejects(
    setBackground.run({ id: "nope", uri: "file:///tmp/x.jpg" }, ctx),
    /No task card with id "nope"/,
  );
});

test("missing id fails honestly", async () => {
  const store = await makeStore();
  const { setBackground } = toolsFor(store);
  await assert.rejects(setBackground.run({ uri: "file:///tmp/x.jpg" }, ctx), /id is required/);
});

test("no background source fails honestly", async () => {
  const store = await makeStore();
  const { setBackground } = toolsFor(store);
  await assert.rejects(setBackground.run({ id: "kb-index" }, ctx), /exactly one of/);
});

test("two sources at once fails honestly", async () => {
  const store = await makeStore();
  const { setBackground } = toolsFor(store);
  await assert.rejects(
    setBackground.run({ id: "kb-index", uri: "file:///tmp/x.jpg", clear: true }, ctx),
    /exactly one of/,
  );
  // Nothing was written.
  assert.equal(store.get("kb-index")?.backgroundUri, null);
});
