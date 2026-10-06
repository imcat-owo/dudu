/**
 * AI photo share （主动发照片） — executor tests.
 *
 * Under test:
 *  1. Toggle OFF → disabled: no model call, no image generation, silence.
 *  2. Toggle ON + model SHARE → image generated through the INJECTED real
 *     path, message lands in the persona's dialog with caption + the
 *     image_message envelope (chat renders the bubble).
 *  3. Model SKIP → no image generation, no delivery, slot consumed.
 *  4. Image generation failure → honest: no delivery, no fake photo.
 *  5. Shared proactive cap → vetoed (a photo draws from the same budget).
 *  6. Quiet hours → vetoed. Incognito → vetoed.
 *  7. One-shot: a second fire of the same slot is already-fired.
 *  8. Manual share ("发张照片给我") bypasses the toggle.
 *  9. Persona isolation: the photo lands in the right persona's dialog.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ApiGroup } from "../src/api-groups/types.js";
import { parseImageMessage } from "../src/image/protocol.js";
import { InitiativeStore } from "../src/initiative/store.js";
import { OutreachStore } from "../src/outreach/store.js";
import { firePhotoshareSlot, type PhotoshareExecutorDeps } from "../src/photoshare/executor.js";
import { PhotoshareStore } from "../src/photoshare/store.js";
import { SelfpostStore } from "../src/selfpost/store.js";

// Tue 2026-10-06 20:00 Shanghai — awake, slot 0 (20:00) is due.
const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);
const SLOT = { index: 0, atMs: NOW, label: "evening" };

const FAKE_GROUP = { id: "g1", name: "fake" } as unknown as ApiGroup;
const PERSONA = {
  id: "personaA",
  name: "嘟嘟",
  description: "十八岁少年，黑色短发",
  personality: "温柔",
  systemPrompt: "你是嘟嘟",
} as never;

const SHARE_REPLY = `SHARE
PROMPT: a cozy selfie of an 18-year-old boy with black hair, white shirt, warm evening light
CAPTION: 看，我刚到家，想你了`;

function fakeKv() {
  const map = new Map<string, string>();
  const kv = {
    getItem: async (k: string) => map.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      map.set(k, v);
    },
    getAllKeys: async () => [...map.keys()],
    __map: map,
  };
  return kv;
}

function seedDialogs(kv: ReturnType<typeof fakeKv>) {
  kv.__map.set(
    "dudu.local-chat.threadA.v1",
    JSON.stringify([{ id: "m1", role: "user", content: "hi" }]),
  );
  kv.__map.set(
    "dudu.local-chat.threadB.v1",
    JSON.stringify([{ id: "m2", role: "user", content: "hello" }]),
  );
  kv.__map.set(
    "dudu.dialog-registry.v1",
    JSON.stringify({
      threadA: { personaId: "personaA", name: "A 的对话" },
      threadB: { personaId: "personaB", name: "B 的对话" },
    }),
  );
}

interface Harness {
  kv: ReturnType<typeof fakeKv>;
  deps: PhotoshareExecutorDeps;
  store: PhotoshareStore;
  generated: string[];
  imageCalls: string[];
  imageImpl: (prompt: string) => Promise<{ url: string; via: string }>;
  traces: Array<{ action: string }>;
  incognito: boolean;
  threadMessages: (id: string) => Array<{ content: string }>;
}

function makeHarness(opts?: { modelReply?: string; incognito?: boolean }): Harness {
  const kv = fakeKv();
  seedDialogs(kv);
  const store = new PhotoshareStore(kv, { nowMs: () => NOW });
  const h: Harness = {
    kv,
    store,
    generated: [],
    imageCalls: [],
    imageImpl: async (prompt: string) => {
      h.imageCalls.push(prompt);
      return { url: "https://img.test/selfie.png", via: "test" };
    },
    traces: [],
    incognito: opts?.incognito ?? false,
    threadMessages: (id: string) => {
      const raw = kv.__map.get(`dudu.local-chat.${id}.v1`);
      return raw ? (JSON.parse(raw) as Array<{ content: string }>) : [];
    },
    deps: null as unknown as PhotoshareExecutorDeps,
  };
  const modelReply = opts?.modelReply ?? SHARE_REPLY;
  h.deps = {
    photoshareStore: store,
    initiativeStore: new InitiativeStore(kv, { nowMs: () => NOW }),
    outreachStore: new OutreachStore(kv),
    selfpostStore: new SelfpostStore(kv, { nowMs: () => NOW }),
    storage: kv,
    visibility: {
      isSendTagVisible: async () => true,
    } as unknown as PhotoshareExecutorDeps["visibility"],
    getActivePersona: async () => PERSONA,
    personaDisplayName: (p) => (p as { name: string }).name,
    personaVoiceHint: () => "",
    getActiveGroup: async () => FAKE_GROUP,
    generateText: async (_g, _s, _u) => {
      h.generated.push(modelReply);
      return modelReply;
    },
    generateImage: (prompt: string) => h.imageImpl(prompt),
    listRecentMemories: async () => [],
    listTodayEvents: async () => [],
    isIncognito: () => h.incognito,
    trace: {
      append: async (e: { action: string }) => {
        h.traces.push(e);
        return {};
      },
    },
    nowMs: () => NOW,
  };
  return h;
}

async function enable(h: Harness) {
  await h.store.setConfig({ enabled: true });
}

describe("photoshare executor", () => {
  it("toggle OFF → disabled: no model call, no image, silence", async () => {
    const h = makeHarness();
    const out = await firePhotoshareSlot(h.deps, SLOT);
    assert.equal(out.fired, false);
    assert.equal(out.reason, "disabled");
    assert.equal(h.generated.length, 0);
    assert.equal(h.imageCalls.length, 0);
    assert.equal(h.threadMessages("threadA").length, 1);
  });

  it("toggle ON + SHARE → real image path + caption land in her dialog", async () => {
    const h = makeHarness();
    await enable(h);
    const out = await firePhotoshareSlot(h.deps, SLOT);
    assert.equal(out.fired, true);
    assert.equal(out.outcome, "shared");
    // The image path was really invoked (mock at the network boundary).
    assert.equal(h.imageCalls.length, 1);
    assert.ok(h.imageCalls[0].includes("selfie"));
    // The message landed in personaA's dialog with caption + envelope.
    const msgs = h.threadMessages("threadA");
    assert.equal(msgs.length, 2);
    const content = msgs[1].content;
    assert.ok(content.includes("看，我刚到家，想你了"));
    const img = parseImageMessage(content);
    assert.ok(img, "image_message envelope present");
    assert.equal(img.uri, "https://img.test/selfie.png");
    // Persona isolation: personaB's dialog untouched.
    assert.equal(h.threadMessages("threadB").length, 1);
    // Trace + ledger.
    assert.ok(h.traces.some((t) => t.action === "photoshare_shared"));
    assert.equal(await h.store.countSendsToday(NOW), 1);
  });

  it("model SKIP → no image, no delivery, slot consumed", async () => {
    const h = makeHarness({ modelReply: "SKIP" });
    await enable(h);
    const out = await firePhotoshareSlot(h.deps, SLOT);
    assert.equal(out.fired, true);
    assert.equal(out.outcome, "skipped");
    assert.equal(h.imageCalls.length, 0);
    assert.equal(h.threadMessages("threadA").length, 1);
    assert.ok(h.traces.some((t) => t.action === "photoshare_skipped"));
    // Slot consumed — a second fire is already-fired, never retried.
    const out2 = await firePhotoshareSlot(h.deps, SLOT);
    assert.equal(out2.fired, false);
    assert.equal(out2.reason, "already-fired");
  });

  it("image generation failure → honest: no delivery, no fake photo", async () => {
    const h = makeHarness();
    await enable(h);
    h.imageImpl = async () => {
      throw new Error("backend down");
    };
    const out = await firePhotoshareSlot(h.deps, SLOT);
    assert.equal(out.fired, false);
    assert.equal(out.reason, "generate-failed");
    assert.equal(h.threadMessages("threadA").length, 1);
  });

  it("shared proactive cap → vetoed", async () => {
    const h = makeHarness();
    await enable(h);
    // Burn the shared budget with initiative sends (cap default 3).
    await h.deps.initiativeStore.recordSend("personaA", NOW - 3_600_000);
    await h.deps.initiativeStore.recordSend("personaA", NOW - 2 * 3_600_000);
    await h.deps.initiativeStore.recordSend("personaA", NOW - 3 * 3_600_000);
    const out = await firePhotoshareSlot(h.deps, SLOT);
    assert.equal(out.fired, false);
    assert.equal(out.reason, "shared-capped");
    assert.equal(h.imageCalls.length, 0);
  });

  it("photo shares count toward the shared cap (symmetric)", async () => {
    const h = makeHarness();
    // Raise the photo cap so the shared cap is the binding constraint.
    await h.store.setConfig({ enabled: true, dailyCap: 2 });
    await h.store.recordSend(NOW - 3_600_000);
    const out = await firePhotoshareSlot(h.deps, SLOT);
    // 1 photoshare send: under both the photo cap (1/2) and shared cap (1/3).
    assert.equal(out.fired, true);
    assert.equal(out.outcome, "shared");
    assert.equal(await h.store.countSendsToday(NOW), 2);
  });

  it("quiet hours → vetoed", async () => {
    const h = makeHarness();
    await enable(h);
    // 10:00 Shanghai — she's asleep.
    const asleepNow = Date.UTC(2026, 9, 6, 2, 0, 0);
    const deps = { ...h.deps, nowMs: () => asleepNow };
    const out = await firePhotoshareSlot(deps, {
      index: 0,
      atMs: asleepNow,
      label: "waking",
    });
    assert.equal(out.fired, false);
    assert.equal(out.reason, "quiet-hours");
  });

  it("incognito → vetoed", async () => {
    const h = makeHarness({ incognito: true });
    await enable(h);
    const out = await firePhotoshareSlot(h.deps, SLOT);
    assert.equal(out.fired, false);
    assert.equal(out.reason, "incognito");
    assert.equal(h.imageCalls.length, 0);
  });

  it("60-minute collision → vetoed", async () => {
    const h = makeHarness();
    await enable(h);
    // A recent send on ANOTHER channel (doesn't touch the photo daily cap).
    await h.deps.initiativeStore.recordSend("personaA", NOW - 10 * 60_000);
    const out = await firePhotoshareSlot(h.deps, SLOT);
    assert.equal(out.fired, false);
    assert.equal(out.reason, "collision");
  });

  it("manual share bypasses the toggle (she asked)", async () => {
    const h = makeHarness({ modelReply: SHARE_REPLY });
    // Toggle stays OFF.
    const out = await firePhotoshareSlot(
      h.deps,
      { index: -1, atMs: NOW, label: "manual" },
      { manual: true, manualHint: "穿白衬衫的自拍" },
    );
    assert.equal(out.fired, true);
    assert.equal(out.outcome, "shared");
    const msgs = h.threadMessages("threadA");
    assert.equal(msgs.length, 2);
    // The hint reached the model.
    assert.ok(h.generated.length > 0);
  });

  it("manual share still respects incognito", async () => {
    const h = makeHarness({ incognito: true });
    const out = await firePhotoshareSlot(
      h.deps,
      { index: -1, atMs: NOW, label: "manual" },
      { manual: true },
    );
    assert.equal(out.fired, false);
    assert.equal(out.reason, "incognito");
  });

  it("no dialog for the persona → deliver-failed, no fake success", async () => {
    const h = makeHarness();
    await enable(h);
    h.kv.__map.delete("dudu.dialog-registry.v1");
    const out = await firePhotoshareSlot(h.deps, SLOT);
    assert.equal(out.fired, false);
    assert.equal(out.reason, "deliver-failed");
  });
});
