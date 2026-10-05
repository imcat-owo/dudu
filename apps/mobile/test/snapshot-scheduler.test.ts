/**
 * D26 regression: the auto-snapshot settings switch must actually DO
 * something. runScheduledSnapshot() is the wiring between isDue() and
 * take(reason="schedule") — invoked on app start and every foreground.
 * Before D26, isDue() had zero callers app-wide: the switch was decoration.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, it } from "node:test";

const require = createRequire(import.meta.url);
const Module = require("node:module");
const originalLoad = Module._load;

// ---- Mocks installed before importing the scheduler ----
const memStore = new Map<string, string>();
const mockAsyncStorage = {
  getItem: async (k: string) => memStore.get(k) ?? null,
  setItem: async (k: string, v: string) => void memStore.set(k, v),
  removeItem: async (k: string) => void memStore.delete(k),
};
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "@react-native-async-storage/async-storage")
    return { default: mockAsyncStorage, ...mockAsyncStorage };
  if (request === "expo-sqlite") return {};
  return originalLoad.call(this, request, parent, isMain);
};

function memKV() {
  const m = new Map<string, string>();
  return {
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => void m.set(k, v),
  };
}

function memFiles() {
  const m = new Map<string, string>();
  return {
    writeFile: async (p: string, c: string) => void m.set(p, c),
    readFile: async (p: string) => {
      const v = m.get(p);
      if (v === undefined) throw new Error("not-found");
      return v;
    },
    deleteFile: async (p: string) => void m.delete(p),
    listFiles: async (dir: string) =>
      [...m.keys()].filter((k) => k.startsWith(`${dir}/`)).map((k) => k.slice(dir.length + 1)),
  };
}

let runScheduledSnapshot: typeof import("../src/backup/snapshot-scheduler").runScheduledSnapshot;
let createSnapshotStore: typeof import("../src/backup/snapshot").createSnapshotStore;

before(async () => {
  ({ runScheduledSnapshot } = await import("../src/backup/snapshot-scheduler"));
  ({ createSnapshotStore } = await import("../src/backup/snapshot"));
});

after(() => {
  Module._load = originalLoad;
});

describe("snapshot scheduler (D26)", () => {
  it("takes a scheduled snapshot when enabled and due", async () => {
    const store = createSnapshotStore(memKV(), memFiles());
    await store.updateSettings({ enabled: true, frequency: "daily" });
    let collected = 0;
    await runScheduledSnapshot({
      store,
      collectJson: async () => {
        collected++;
        return '{"kind":"dudu-backup"}';
      },
    });
    assert.equal(collected, 1);
    const list = await store.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].reason, "schedule");
    const settings = await store.getSettings();
    assert.ok(settings.lastTakenAt !== null && settings.lastTakenAt > 0);
  });

  it("does nothing when the switch is off", async () => {
    const store = createSnapshotStore(memKV(), memFiles());
    await store.updateSettings({ enabled: false });
    let collected = 0;
    await runScheduledSnapshot({
      store,
      collectJson: async () => {
        collected++;
        return "{}";
      },
    });
    assert.equal(collected, 0);
    assert.equal((await store.list()).length, 0);
  });

  it("does nothing when not yet due", async () => {
    const store = createSnapshotStore(memKV(), memFiles());
    await store.updateSettings({ enabled: true, frequency: "daily" });
    await store.take("{}", "schedule");
    let collected = 0;
    await runScheduledSnapshot({
      store,
      collectJson: async () => {
        collected++;
        return "{}";
      },
    });
    assert.equal(collected, 0);
    assert.equal((await store.list()).length, 1);
  });

  it("honors keepCount on scheduled takes", async () => {
    const kv = memKV();
    const store = createSnapshotStore(kv, memFiles());
    await store.updateSettings({ enabled: true, frequency: "daily", keepCount: 2 });
    const collect = async () => "{}";
    for (let i = 0; i < 3; i++) {
      // Force due by backdating lastTakenAt.
      await store.updateSettings({ lastTakenAt: Date.now() - 25 * 3600 * 1000 });
      await runScheduledSnapshot({ store, collectJson: collect });
    }
    assert.equal((await store.list()).length, 2);
  });

  it("leaves manual snapshots alone", async () => {
    const store = createSnapshotStore(memKV(), memFiles());
    await store.updateSettings({ enabled: true, frequency: "daily" });
    await store.take("{}", "manual");
    await runScheduledSnapshot({ store, collectJson: async () => "{}" });
    const list = await store.list();
    assert.equal(list.length, 2);
    assert.ok(list.some((s) => s.reason === "manual"));
    assert.ok(list.some((s) => s.reason === "schedule"));
  });

  it("never throws — a failed scheduled backup must not break the app", async () => {
    const store = createSnapshotStore(memKV(), memFiles());
    await store.updateSettings({ enabled: true, frequency: "daily" });
    await runScheduledSnapshot({
      store,
      collectJson: async () => {
        throw new Error("disk on fire");
      },
    });
    assert.equal((await store.list()).length, 0);
  });
});
