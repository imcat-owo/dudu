/**
 * B1: app-lock gate contract tests.
 *
 * AppLockGate (src/platform/app-lock-gate.tsx) renders the lock screen iff
 * `appLockStore.getState()` is `{ enabled: true, locked: true }`. These tests
 * pin the store transitions the gate depends on — most importantly the
 * cold-start path: persisted enabled=1 → load() → locked=true. That path is
 * what was silently broken in local mode (nothing there ever called load()
 * or mounted the gate, so the settings toggle was decoration).
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, it } from "node:test";

const require = createRequire(import.meta.url);
const Module = require("node:module");
const originalLoad = Module._load;

// ---- Mocks installed before importing app-lock ----
const mockAuth = {
  hasHardwareAsync: async () => true,
  isEnrolledAsync: async () => true,
  supportedAuthenticationTypesAsync: async () => [1],
  authenticateAsync: async () => ({ success: true }),
  AuthenticationType: { FACIAL_RECOGNITION: 1, FINGERPRINT: 2, IRIS: 3 },
};
const memStore = new Map<string, string>();
const mockAsyncStorage = {
  getItem: async (k: string) => memStore.get(k) ?? null,
  setItem: async (k: string, v: string) => {
    memStore.set(k, v);
  },
  removeItem: async (k: string) => {
    memStore.delete(k);
  },
};
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "expo-local-authentication") return mockAuth;
  if (request === "@react-native-async-storage/async-storage")
    return { default: mockAsyncStorage, ...mockAsyncStorage };
  return originalLoad.call(this, request, parent, isMain);
};

// Lazily imported after the mocks are installed.
let appLockStore: typeof import("../src/platform/app-lock.js").appLockStore;

before(async () => {
  ({ appLockStore } = await import("../src/platform/app-lock.js"));
});

after(() => {
  Module._load = originalLoad;
});

describe("app lock gate contract (B1)", () => {
  beforeEach(() => {
    memStore.clear();
    appLockStore.__resetForTests();
  });

  it("cold start with lock enabled → locked=true (gate shows the lock screen)", async () => {
    memStore.set("dudu.app-lock.enabled.v1", "1");
    await appLockStore.load();
    const s = appLockStore.getState();
    assert.equal(s.enabled, true);
    // AppLockGate renders the lock screen iff enabled && locked.
    assert.equal(s.locked, true);
  });

  it("cold start with lock disabled → stays unlocked", async () => {
    await appLockStore.load();
    const s = appLockStore.getState();
    assert.equal(s.enabled, false);
    assert.equal(s.locked, false);
  });

  it("successful authenticate() unlocks", async () => {
    memStore.set("dudu.app-lock.enabled.v1", "1");
    await appLockStore.load();
    assert.equal(appLockStore.getState().locked, true);
    const ok = await appLockStore.authenticate();
    assert.equal(ok, true);
    assert.equal(appLockStore.getState().locked, false);
  });

  it("lock-on-exit: background locks, foreground stays locked until auth", async () => {
    memStore.set("dudu.app-lock.enabled.v1", "1");
    memStore.set("dudu.app-lock.idle-seconds.v1", "-1");
    await appLockStore.load();
    const unlocked = await appLockStore.authenticate();
    assert.equal(unlocked, true);
    assert.equal(appLockStore.getState().locked, false);
    appLockStore.onBackground();
    assert.equal(appLockStore.getState().locked, true);
    assert.equal(appLockStore.onForeground(), true);
    assert.equal(appLockStore.getState().locked, true);
  });
});
