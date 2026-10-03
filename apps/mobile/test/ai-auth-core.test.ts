import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AI_AUTH_PREFERENCES,
  type AiAuthBackend,
  createAiAuthStore,
  decideFromPreference,
  isAiAuthPreference,
} from "../src/ai-auth-core.js";

function memoryBackend(initial: Record<string, string> = {}): AiAuthBackend & {
  store: Map<string, string>;
} {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    getItem: async (key) => store.get(key) ?? null,
    setItem: async (key, value) => {
      store.set(key, value);
    },
  };
}

describe("decideFromPreference", () => {
  it("always -> allow, never -> deny, ask -> prompt", () => {
    assert.equal(decideFromPreference("always"), "allow");
    assert.equal(decideFromPreference("never"), "deny");
    assert.equal(decideFromPreference("ask"), "prompt");
  });
});

describe("isAiAuthPreference", () => {
  it("accepts the 3 preferences, rejects the rest", () => {
    for (const p of AI_AUTH_PREFERENCES) assert.ok(isAiAuthPreference(p));
    assert.ok(!isAiAuthPreference("sometimes"));
    assert.ok(!isAiAuthPreference(""));
    assert.ok(!isAiAuthPreference(null));
    assert.ok(!isAiAuthPreference(undefined));
  });
});

describe("createAiAuthStore", () => {
  it("defaults every capability to ask", () => {
    const store = createAiAuthStore(memoryBackend());
    const snap = store.getSnapshot();
    for (const p of Object.values(snap)) assert.equal(p, "ask");
    assert.equal(Object.keys(snap).length, 6);
  });

  it("setPreference updates memory and persists", async () => {
    const backend = memoryBackend();
    const store = createAiAuthStore(backend);
    await store.setPreference("photos", "always");
    assert.equal(store.getSnapshot().photos, "always");
    assert.equal(backend.store.get("dudu.aiAuth.v1.photos"), "always");
    // Other capabilities untouched.
    assert.equal(store.getSnapshot().location, "ask");
  });

  it("loads saved preferences on init", async () => {
    const backend = memoryBackend({ "dudu.aiAuth.v1.location": "never" });
    const store = createAiAuthStore(backend);
    // Let the async init load run.
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(store.getSnapshot().location, "never");
    assert.equal(store.getSnapshot().photos, "ask");
  });

  it("ignores corrupt stored values", async () => {
    const backend = memoryBackend({ "dudu.aiAuth.v1.photos": "sometimes" });
    const store = createAiAuthStore(backend);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(store.getSnapshot().photos, "ask");
  });

  it("a setPreference racing the init load is never clobbered", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const backend: AiAuthBackend = {
      getItem: async (key) => {
        await gate;
        return key.endsWith(".photos") ? "never" : null;
      },
      setItem: async () => {},
    };
    const store = createAiAuthStore(backend);
    await store.setPreference("photos", "always");
    release();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(store.getSnapshot().photos, "always");
  });

  it("survives a failing backend", async () => {
    const backend: AiAuthBackend = {
      getItem: async () => {
        throw new Error("disk gone");
      },
      setItem: async () => {
        throw new Error("disk gone");
      },
    };
    const store = createAiAuthStore(backend);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(store.getSnapshot().photos, "ask");
    await store.setPreference("photos", "never"); // must not throw
    assert.equal(store.getSnapshot().photos, "never");
  });
});
