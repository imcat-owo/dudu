/**
 * Per-dialog model override store tests — memory backend, no RN needed.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  createDialogModelOverrideStore,
  type DialogOverrideBackend,
} from "../src/api-groups/dialog-model-override.js";
import type { ApiGroup } from "../src/api-groups/types.js";

function memBackend(): DialogOverrideBackend & { raw(): string | null } {
  const m = new Map<string, string>();
  return {
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      m.set(k, v);
    },
    raw: () => m.get("dudu.dialog-model-override.v1") ?? null,
  };
}

function group(id: string): ApiGroup {
  return {
    id,
    name: `Group ${id}`,
    baseUrl: "https://x.example.com",
    apiKey: "k",
    model: "model",
  } as ApiGroup;
}

test("no override -> null (falls back to global active)", async () => {
  const store = createDialogModelOverrideStore(memBackend());
  await store.__resetForTests();
  assert.equal(store.getOverrideGroupId("t1"), null);
  assert.equal(store.resolveGroup("t1", [group("a"), group("b")]), null);
});

test("set -> resolve -> clear round trip", async () => {
  const b = memBackend();
  const store = createDialogModelOverrideStore(b);
  await store.__resetForTests();
  await store.setOverride("t1", "g2");
  assert.equal(store.getOverrideGroupId("t1"), "g2");
  // other threads unaffected
  assert.equal(store.getOverrideGroupId("t2"), null);
  const resolved = store.resolveGroup("t1", [group("g1"), group("g2")]);
  assert.equal(resolved?.id, "g2");
  await store.clearOverride("t1");
  assert.equal(store.getOverrideGroupId("t1"), null);
  assert.equal(store.resolveGroup("t1", [group("g1"), group("g2")]), null);
});

test("override pointing at a deleted group resolves to null", async () => {
  const store = createDialogModelOverrideStore(memBackend());
  await store.__resetForTests();
  await store.setOverride("t1", "gone");
  assert.equal(store.resolveGroup("t1", [group("a")]), null);
  // ...but the stored id is kept (group may come back)
  assert.equal(store.getOverrideGroupId("t1"), "gone");
});

test("overrides persist as JSON in the backend", async () => {
  const b = memBackend();
  const store = createDialogModelOverrideStore(b);
  await store.__resetForTests();
  await store.setOverride("t1", "g1");
  await store.setOverride("t2", "g2");
  const parsed = JSON.parse(b.raw() ?? "{}") as Record<string, string>;
  assert.deepEqual(parsed, { t1: "g1", t2: "g2" });
  // a fresh store over the same backend reloads them
  const store2 = createDialogModelOverrideStore(b);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(store2.getOverrideGroupId("t2"), "g2");
});

test("corrupt storage starts clean, never throws", async () => {
  const b = memBackend();
  await b.setItem("dudu.dialog-model-override.v1", "not-json{{{");
  const store = createDialogModelOverrideStore(b);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(store.getOverrideGroupId("t1"), null);
});

test("P3-4: map is capped — oldest overrides evicted first", async () => {
  const store = createDialogModelOverrideStore(memBackend());
  await store.__resetForTests();
  for (let i = 0; i < 120; i++) await store.setOverride(`t${i}`, "g1");
  const snap = store.getSnapshot();
  assert.equal(Object.keys(snap.overrides).length, 100);
  // Oldest evicted, newest kept.
  assert.equal(store.getOverrideGroupId("t0"), null);
  assert.equal(store.getOverrideGroupId("t19"), null);
  assert.equal(store.getOverrideGroupId("t20"), "g1");
  assert.equal(store.getOverrideGroupId("t119"), "g1");
});

test("P3-4: re-setting refreshes recency (not evicted as stale)", async () => {
  const store = createDialogModelOverrideStore(memBackend());
  await store.__resetForTests();
  for (let i = 0; i < 100; i++) await store.setOverride(`t${i}`, "g1");
  await store.setOverride("t0", "g2"); // touch t0 -> moves to the end
  await store.setOverride("t100", "g1"); // pushes past the cap
  assert.equal(store.getOverrideGroupId("t0"), "g2");
  assert.equal(store.getOverrideGroupId("t1"), null); // t1 was oldest untouched
});

test("P3-4: pruneOverrides drops dead thread ids", async () => {
  const store = createDialogModelOverrideStore(memBackend());
  await store.__resetForTests();
  await store.setOverride("alive1", "g1");
  await store.setOverride("dead1", "g1");
  await store.setOverride("alive2", "g2");
  const dropped = await store.pruneOverrides(["alive1", "alive2"]);
  assert.equal(dropped, 1);
  assert.equal(store.getOverrideGroupId("dead1"), null);
  assert.equal(store.getOverrideGroupId("alive1"), "g1");
  // No-op when nothing is stale.
  assert.equal(await store.pruneOverrides(["alive1", "alive2"]), 0);
});
