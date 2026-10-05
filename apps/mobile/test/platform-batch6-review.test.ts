/**
 * Batch 6 review-fix tests (P1/P2).
 *
 * - P1 Face ID: authenticateAsync must receive RESOLVED strings, not i18n keys.
 * - P1 scheduled-tasks store: setEnabled/markFired must swap the array reference
 *   so useSyncExternalStore subscribers re-render.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, it } from "node:test";

const require = createRequire(import.meta.url);
const Module = require("module");
const originalLoad = Module._load;

// ---- Mock expo-local-authentication before importing app-lock ----
const captured: Array<{ promptMessage: string; cancelLabel?: string; fallbackLabel?: string }> = [];
const mockAuth = {
  hasHardwareAsync: async () => true,
  isEnrolledAsync: async () => true,
  supportedAuthenticationTypesAsync: async () => [1],
  authenticateAsync: async (opts: {
    promptMessage: string;
    cancelLabel?: string;
    fallbackLabel?: string;
  }) => {
    captured.push({ ...opts });
    return { success: true };
  },
};
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "expo-local-authentication") return mockAuth;
  return originalLoad.call(this, request, parent, isMain);
};

// Lazily imported after the mock is installed.
let appLockStore: typeof import("../src/platform/app-lock.js").appLockStore;

before(async () => {
  ({ appLockStore } = await import("../src/platform/app-lock.js"));
});

after(() => {
  Module._load = originalLoad;
});

describe("app lock (P1: Face ID prompt shows real text)", () => {
  before(() => {
    captured.length = 0;
  });

  it("passes resolved strings (not i18n keys) to authenticateAsync", async () => {
    const ok = await appLockStore.authenticate("platform.applock.prompt.unlock");
    assert.equal(ok, true);
    assert.equal(captured.length, 1);
    const args = captured[0];
    // Must NOT be the raw keys.
    assert.ok(!args.promptMessage.includes("platform.applock"), `got key: ${args.promptMessage}`);
    assert.ok(args.cancelLabel !== undefined && !args.cancelLabel.includes("common."));
    // Must be real human text (non-empty, locale-resolved).
    assert.ok(args.promptMessage.length > 0);
    assert.ok((args.cancelLabel ?? "").length > 0);
  });
});

describe("scheduled task store (P1: no in-place mutation)", () => {
  it("setEnabled swaps the array reference", async () => {
    const { scheduledTaskStore } = await import("../src/platform/scheduled-tasks.js");
    scheduledTaskStore.__resetForTests();
    const refBefore = scheduledTaskStore.getTasks();
    // add a task, then toggle it
    const task = await scheduledTaskStore.add({
      title: "ref-swap test",
      message: "test",
      timeOfDay: "09:00",
      recurrence: "once",
    });
    const refAfterAdd = scheduledTaskStore.getTasks();
    assert.notEqual(refAfterAdd, refBefore);
    const t1 = scheduledTaskStore.getTasks().find((x) => x.id === task.id)!;
    const refBeforeToggle = scheduledTaskStore.getTasks();
    await scheduledTaskStore.setEnabled(task.id, !t1.enabled);
    const refAfterToggle = scheduledTaskStore.getTasks();
    assert.notEqual(refAfterToggle, refBeforeToggle);
    const t2 = scheduledTaskStore.getTasks().find((x) => x.id === task.id)!;
    assert.equal(t2.enabled, !t1.enabled);
    await scheduledTaskStore.remove(task.id);
    scheduledTaskStore.__resetForTests();
  });
});
