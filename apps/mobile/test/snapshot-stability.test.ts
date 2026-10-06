/**
 * P0-1 regression: getSnapshot() MUST return a stable object reference.
 * useSyncExternalStore force-rerenders whenever Object.is(getSnapshot(), prev)
 * is false — a fresh object literal on every call spins an infinite render
 * loop in the React Native renderer.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCapabilityStore } from "../src/api-groups/capability-store.js";
import { createDialogModelOverrideStore } from "../src/api-groups/dialog-model-override.js";
import { createPlanGateStore } from "../src/api-groups/plan-gate.js";
import { createGroupStore } from "../src/api-groups/store.js";
import { createVoiceStore } from "../src/voice/store.js";

function memBackend() {
  const m = new Map<string, string>();
  return {
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      m.set(k, v);
    },
    deleteItem: async (k: string) => {
      m.delete(k);
    },
  };
}

describe("getSnapshot returns a stable reference (P0-1)", () => {
  it("group store: same reference before/after load, new reference after mutation", async () => {
    const store = createGroupStore(memBackend());
    const before = store.getSnapshot();
    assert.equal(before, store.getSnapshot(), "fresh literal before load");
    await store.upsert({
      id: "g1",
      name: "test",
      vendor: "openai",
      baseUrl: "https://x.test/v1",
      apiKey: "k",
      model: "m",
      headers: {},
      createdAt: 1,
    });
    const after = store.getSnapshot();
    assert.equal(after, store.getSnapshot(), "fresh literal after mutation");
    assert.notEqual(before, after, "mutation must produce a new snapshot");
    assert.equal(after.groups.length, 1);
  });

  it("capability store: stable reference across calls", async () => {
    const store = createCapabilityStore(memBackend());
    await store.__resetForTests();
    const s1 = store.getSnapshot();
    assert.equal(s1, store.getSnapshot(), "fresh literal");
    await store.setRoutingEnabled(false);
    const s2 = store.getSnapshot();
    assert.equal(s2, store.getSnapshot(), "fresh literal after mutation");
    assert.notEqual(s1, s2, "mutation must produce a new snapshot");
    assert.equal(s2.routingEnabled, false);
  });

  it("dialog model override store: stable reference across calls", async () => {
    const store = createDialogModelOverrideStore(memBackend());
    const s1 = store.getSnapshot();
    assert.equal(s1, store.getSnapshot(), "fresh literal");
    await store.setOverride("t1", "g1");
    const s2 = store.getSnapshot();
    assert.equal(s2, store.getSnapshot(), "fresh literal after mutation");
    assert.notEqual(s1, s2, "mutation must produce a new snapshot");
  });

  it("plan gate store: stable reference across calls", () => {
    const store = createPlanGateStore();
    const s1 = store.getSnapshot();
    assert.equal(s1, store.getSnapshot(), "fresh literal");
  });

  it("voice store: stable reference across calls", async () => {
    const store = createVoiceStore(memBackend());
    const s1 = store.getSnapshot();
    assert.equal(s1, store.getSnapshot(), "fresh literal");
    await store.setSettings({
      micMode: "voice-message",
      autoRead: false,
      emotionalTts: true,
      emotionPin: null,
    });
    const s2 = store.getSnapshot();
    assert.equal(s2, store.getSnapshot(), "fresh literal after mutation");
    assert.notEqual(s1, s2, "mutation must produce a new snapshot");
  });
});
