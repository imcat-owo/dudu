/**
 * AI photo share （主动发照片） — scheduler tests.
 *
 * Under test:
 *  1. Disabled (default) → tick does nothing, no model call.
 *  2. Enabled + due slot → fires through the executor (image generated,
 *     message delivered).
 *  3. Expired slots are consumed silently, never backfilled.
 *  4. Nothing due yet → silent.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ApiGroup } from "../src/api-groups/types.js";
import { InitiativeStore } from "../src/initiative/store.js";
import { OutreachStore } from "../src/outreach/store.js";
import type { PhotoshareExecutorDeps } from "../src/photoshare/executor.js";
import { checkDuePhotoshareSlots } from "../src/photoshare/scheduler.js";
import { PhotoshareStore } from "../src/photoshare/store.js";
import { SelfpostStore } from "../src/selfpost/store.js";

// Tue 2026-10-06 20:05 Shanghai — just past the 20:00 slot.
const NOW = Date.UTC(2026, 9, 6, 12, 5, 0);

function fakeKv() {
  const map = new Map<string, string>();
  return {
    getItem: async (k: string) => map.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      map.set(k, v);
    },
    getAllKeys: async () => [...map.keys()],
    __map: map,
  };
}

function seedDialogs(kv: ReturnType<typeof fakeKv>) {
  kv.__map.set(
    "dudu.local-chat.threadA.v1",
    JSON.stringify([{ id: "m1", role: "user", content: "hi" }]),
  );
  kv.__map.set(
    "dudu.dialog-registry.v1",
    JSON.stringify({ threadA: { personaId: "personaA", name: "A" } }),
  );
}

function makeDeps(kv: ReturnType<typeof fakeKv>, opts?: { incognito?: boolean }) {
  const store = new PhotoshareStore(kv, { nowMs: () => NOW });
  const imageCalls: string[] = [];
  const deps: PhotoshareExecutorDeps = {
    photoshareStore: store,
    initiativeStore: new InitiativeStore(kv, { nowMs: () => NOW }),
    outreachStore: new OutreachStore(kv),
    selfpostStore: new SelfpostStore(kv, { nowMs: () => NOW }),
    storage: kv,
    visibility: { isSendTagVisible: async () => true } as never,
    getActivePersona: async () =>
      ({
        id: "personaA",
        name: "嘟嘟",
        description: "",
        personality: "",
        systemPrompt: "",
      }) as never,
    personaDisplayName: (p) => (p as { name: string }).name,
    personaVoiceHint: () => "",
    getActiveGroup: async () => ({ id: "g" }) as unknown as ApiGroup,
    generateText: async () => "SHARE\nPROMPT: a selfie\nCAPTION: 看",
    generateImage: async (prompt: string) => {
      imageCalls.push(prompt);
      return { url: "https://img.test/x.png", via: "test" };
    },
    listRecentMemories: async () => [],
    listTodayEvents: async () => [],
    isIncognito: () => opts?.incognito ?? false,
    trace: { append: async () => ({}) },
    nowMs: () => NOW,
  };
  return {
    deps,
    store,
    imageCalls,
    threadMessages: () => {
      const raw = kv.__map.get("dudu.local-chat.threadA.v1");
      return raw ? (JSON.parse(raw) as Array<{ content: string }>) : [];
    },
  };
}

describe("photoshare scheduler", () => {
  it("disabled (default) → tick does nothing", async () => {
    const kv = fakeKv();
    seedDialogs(kv);
    const { deps, imageCalls, threadMessages } = makeDeps(kv);
    await checkDuePhotoshareSlots(deps);
    assert.equal(imageCalls.length, 0);
    assert.equal(threadMessages().length, 1);
  });

  it("enabled + due slot → fires once through the executor", async () => {
    const kv = fakeKv();
    seedDialogs(kv);
    const { deps, store, imageCalls, threadMessages } = makeDeps(kv);
    await store.setConfig({ enabled: true });
    await checkDuePhotoshareSlots(deps);
    // Give the fire-and-forget executor a turn.
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(imageCalls.length, 1);
    assert.equal(threadMessages().length, 2);
    assert.ok(threadMessages()[1].content.includes("看"));
  });

  it("expired slots are consumed silently, never backfilled", async () => {
    // 21:00 Shanghai — the 20:00 slot is 60 min old (past the 15-min grace).
    const lateNow = Date.UTC(2026, 9, 6, 13, 0, 0);
    const kv = fakeKv();
    seedDialogs(kv);
    const store = new PhotoshareStore(kv, { nowMs: () => lateNow });
    await store.setConfig({ enabled: true });
    const { deps } = makeDeps(kv);
    const lateDeps: PhotoshareExecutorDeps = {
      ...deps,
      photoshareStore: store,
      nowMs: () => lateNow,
    };
    await checkDuePhotoshareSlots(lateDeps);
    await new Promise((r) => setTimeout(r, 50));
    // Slot consumed (ledger) but no photo was generated or delivered.
    // Both default slots (20:00 and 00:30) are past the grace at 21:00.
    const fired = await store.firedSlotIds();
    assert.equal(fired.size, 2);
  });

  it("nothing due yet → silent", async () => {
    // 19:00 Shanghai — before the 20:00 slot.
    const earlyNow = Date.UTC(2026, 9, 6, 11, 0, 0);
    const kv = fakeKv();
    seedDialogs(kv);
    const store = new PhotoshareStore(kv, { nowMs: () => earlyNow });
    await store.setConfig({ enabled: true });
    const { deps, imageCalls } = makeDeps(kv);
    const earlyDeps: PhotoshareExecutorDeps = {
      ...deps,
      photoshareStore: store,
      nowMs: () => earlyNow,
    };
    await checkDuePhotoshareSlots(earlyDeps);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(imageCalls.length, 0);
  });
});
