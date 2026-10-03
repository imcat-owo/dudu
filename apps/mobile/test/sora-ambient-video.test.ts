/**
 * Ambient video store tests — PURE module, no React Native needed.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { type AmbientVideoStorage, AmbientVideoStore } from "../src/sora-ambient-video.js";

function memStorage(): AmbientVideoStorage {
  const m = new Map<string, string>();
  return {
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => {
      m.set(k, v);
    },
  };
}

test("defaults are all null (bundled Sora clips)", async () => {
  const s = new AmbientVideoStore(memStorage());
  assert.equal(s.get("ourspace"), null);
  assert.equal(s.get("music-dj"), null);
  assert.equal(s.get("knowledge"), null);
});

test("set stores a custom video URI per slot", async () => {
  const s = new AmbientVideoStore(memStorage());
  await s.set("music-dj", "file:///custom/dj.mp4");
  assert.equal(s.get("music-dj"), "file:///custom/dj.mp4");
  // other slots untouched
  assert.equal(s.get("ourspace"), null);
});

test("blank URI resets to default", async () => {
  const s = new AmbientVideoStore(memStorage());
  await s.set("knowledge", "file:///custom/kb.mp4");
  await s.set("knowledge", "   ");
  assert.equal(s.get("knowledge"), null);
});

test("clear resets a single slot", async () => {
  const s = new AmbientVideoStore(memStorage());
  await s.set("ourspace", "file:///custom/empty.mp4");
  await s.clear("ourspace");
  assert.equal(s.get("ourspace"), null);
});

test("persists and hydrates across instances", async () => {
  const storage = memStorage();
  const s1 = new AmbientVideoStore(storage);
  await s1.set("ourspace", "file:///a.mp4");
  await s1.set("music-dj", "file:///b.mp4");
  const s2 = new AmbientVideoStore(storage);
  await s2.load();
  assert.equal(s2.get("ourspace"), "file:///a.mp4");
  assert.equal(s2.get("music-dj"), "file:///b.mp4");
  assert.equal(s2.get("knowledge"), null);
});

test("corrupt storage keeps defaults", async () => {
  const m = new Map<string, string>();
  m.set("dudu.ambientvideo.v1.overrides", "not-json{{{");
  const s = new AmbientVideoStore({
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => {
      m.set(k, v);
    },
  });
  await s.load();
  assert.equal(s.get("ourspace"), null);
});

test("subscribers are notified on change", async () => {
  const s = new AmbientVideoStore(memStorage());
  let calls = 0;
  s.subscribe(() => {
    calls += 1;
  });
  await s.set("music-dj", "file:///x.mp4");
  assert.equal(calls, 1);
});
