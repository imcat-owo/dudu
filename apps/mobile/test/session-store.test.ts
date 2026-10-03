import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTokenStore, type TokenBackend } from "../src/session-store.js";

function memoryBackend(): TokenBackend & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: async (key) => store.get(key) ?? null,
    setItem: async (key, value) => {
      store.set(key, value);
    },
    deleteItem: async (key) => {
      store.delete(key);
    },
  };
}

function failingBackend(): TokenBackend {
  const boom = async (): Promise<never> => {
    throw new Error("SecureStore unavailable");
  };
  return { getItem: boom, setItem: boom, deleteItem: boom };
}

describe("tokenStore", () => {
  it("round-trips a token through the backend", async () => {
    const backend = memoryBackend();
    const store = createTokenStore(backend);
    assert.equal(await store.load(), null);
    await store.save("token-abc");
    assert.equal(backend.store.size, 1);
    assert.equal(await store.load(), "token-abc");
  });

  it("clear removes the persisted token", async () => {
    const backend = memoryBackend();
    const store = createTokenStore(backend);
    await store.save("token-abc");
    await store.clear();
    assert.equal(backend.store.size, 0);
    assert.equal(await store.load(), null);
  });

  it("falls back to memory when the backend throws (web / unavailable)", async () => {
    const store = createTokenStore(failingBackend());
    await store.save("token-abc");
    assert.equal(await store.load(), "token-abc");
    await store.clear();
    assert.equal(await store.load(), null);
  });

  it("prefers the persisted token over a stale memory copy", async () => {
    const backend = memoryBackend();
    const first = createTokenStore(backend);
    await first.save("token-old");
    // A fresh store instance (e.g. after app restart) reads the persisted value.
    const second = createTokenStore(backend);
    assert.equal(await second.load(), "token-old");
    await second.save("token-new");
    assert.equal(await first.load(), "token-new");
  });
});
