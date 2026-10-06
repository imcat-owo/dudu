/**
 * Memory-driven next-day follow-up （次日跟进） — engine tests.
 *
 * Under test:
 *  1. A due item fires once through the injected delivery path and is
 *     marked done (one-shot — a second sweep does not refire).
 *  2. Auto-cancel: when the event already came up in chat AFTER the item
 *     was created, the item cancels, the backing rule is retired, the
 *     delivery path is NOT called, and a trace entry is written.
 *  3. The original "我明天有个面试" message (inside the baseline) does
 *     NOT count as "already discussed".
 *  4. Master toggle off → silent. Not-due → skipped.
 *  5. A failed fire (e.g. capped) still marks done — no retry, ever.
 *  6. Deleted persona → cancelled, retired, never fired.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFollowupTopic,
  checkDueFollowups,
  type FollowupEngineDeps,
  wasDiscussed,
} from "../src/followup/engine.js";
import { FollowupStore } from "../src/followup/store.js";
import type { FireOutcome } from "../src/initiative/executor.js";
import { InitiativeStore } from "../src/initiative/store.js";

// Tue 2026-10-06 20:00 Shanghai.
const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);
const FOLLOW_UP_AT = NOW - 3600_000; // due an hour ago

function fakeKv() {
  const map = new Map<string, string>();
  return {
    getItem: async (k: string) => map.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      map.set(k, v);
    },
    getAllKeys: async () => [...map.keys()],
  };
}

interface Msg {
  id: string;
  role: string;
  content: string;
}

function seedDialog(
  kv: ReturnType<typeof fakeKv>,
  threadId: string,
  personaId: string,
  msgs: Msg[],
) {
  kv.setItem(`dudu.local-chat.${threadId}.v1`, JSON.stringify(msgs));
  return kv.getItem("dudu.dialog-registry.v1").then((raw) => {
    const reg = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    reg[threadId] = { personaId };
    return kv.setItem("dudu.dialog-registry.v1", JSON.stringify(reg));
  });
}

function msg(id: string, role: string, content: string): Msg {
  return { id, role, content };
}

interface Harness {
  deps: FollowupEngineDeps;
  followupStore: FollowupStore;
  initiativeStore: InitiativeStore;
  fired: Array<{ ruleId: string; slotTime: number }>;
  retired: string[];
  traces: Array<{ action: string }>;
  fireImpl: (ruleId: string, slotTime: number) => Promise<FireOutcome>;
  persona: { id: string; name: string } | null;
}

function makeHarness(): Harness {
  const kv = fakeKv();
  const followupStore = new FollowupStore(kv, { nowMs: () => NOW });
  const initiativeStore = new InitiativeStore(kv, { nowMs: () => NOW });
  const h: Harness = {
    deps: null as unknown as FollowupEngineDeps,
    followupStore,
    initiativeStore,
    fired: [],
    retired: [],
    traces: [],
    fireImpl: async (ruleId, slotTime) => {
      h.fired.push({ ruleId, slotTime });
      return { fired: true, threadId: "t1", text: "面试怎么样？" };
    },
    persona: { id: "pA", name: "A" },
  };
  h.deps = {
    followupStore,
    storage: kv,
    trace: {
      append: async (e: { action: string }) => {
        h.traces.push({ action: e.action });
      },
    } as never,
    getPersona: async () => h.persona as never,
    fireRule: (ruleId, slotTime) => h.fireImpl(ruleId, slotTime),
    retireRule: async (ruleId) => {
      h.retired.push(ruleId);
      await initiativeStore.setStatus(ruleId, "archived");
    },
    nowMs: () => NOW,
  };
  return h;
}

async function addItem(
  h: Harness,
  opts?: { followUpAtMs?: number; baseline?: Record<string, number>; keywords?: string[] },
) {
  const rule = await h.initiativeStore.create({
    personaId: "pA",
    title: "问问面试怎么样",
    topic: buildFollowupTopic("面试", "明天"),
    type: "one_time",
    schedule: { kind: "one_time", atMs: opts?.followUpAtMs ?? FOLLOW_UP_AT },
    target: { mode: "latest" },
  });
  const item = await h.followupStore.create({
    ruleId: rule.id,
    personaId: "pA",
    what: "面试",
    eventLabel: "明天",
    eventDateMs: NOW,
    followUpAtMs: opts?.followUpAtMs ?? FOLLOW_UP_AT,
    keywords: opts?.keywords ?? ["面试"],
    baselineCounts: opts?.baseline ?? {},
  });
  return { rule, item };
}

describe("checkDueFollowups", () => {
  it("fires a due item once and marks it done (one-shot)", async () => {
    const h = makeHarness();
    const { rule, item } = await addItem(h);
    await checkDueFollowups(h.deps, NOW);
    assert.equal(h.fired.length, 1);
    assert.equal(h.fired[0].ruleId, rule.id);
    assert.equal(h.fired[0].slotTime, FOLLOW_UP_AT);
    assert.equal((await h.followupStore.get(item.id))?.status, "done");
    // Second sweep: no refire.
    await checkDueFollowups(h.deps, NOW);
    assert.equal(h.fired.length, 1);
  });

  it("auto-cancels when the event already came up in chat", async () => {
    const h = makeHarness();
    const kv = h.deps.storage as ReturnType<typeof fakeKv>;
    await seedDialog(kv, "t1", "pA", [
      msg("m1", "user", "我明天有个面试"),
      msg("m2", "assistant", "加油！"),
    ]);
    // Baseline covers the first two messages; the third is NEW.
    const { rule, item } = await addItem(h, { baseline: { t1: 2 } });
    await kv.setItem(
      `dudu.local-chat.t1.v1`,
      JSON.stringify([
        msg("m1", "user", "我明天有个面试"),
        msg("m2", "assistant", "加油！"),
        msg("m3", "user", "面试结束了，感觉还不错"),
      ]),
    );
    await checkDueFollowups(h.deps, NOW);
    assert.equal(h.fired.length, 0);
    assert.equal((await h.followupStore.get(item.id))?.status, "cancelled");
    assert.ok(h.retired.includes(rule.id));
    assert.ok(h.traces.some((t) => t.action === "followup_cancelled"));
  });

  it("does NOT treat the original message as already-discussed", async () => {
    const h = makeHarness();
    const kv = h.deps.storage as ReturnType<typeof fakeKv>;
    await seedDialog(kv, "t1", "pA", [
      msg("m1", "user", "我明天有个面试"),
      msg("m2", "assistant", "加油！"),
    ]);
    await addItem(h, { baseline: { t1: 2 } });
    await checkDueFollowups(h.deps, NOW);
    assert.equal(h.fired.length, 1);
  });

  it("stays silent when the master toggle is off", async () => {
    const h = makeHarness();
    await h.followupStore.setEnabled(false);
    await addItem(h);
    await checkDueFollowups(h.deps, NOW);
    assert.equal(h.fired.length, 0);
  });

  it("skips items that are not due yet", async () => {
    const h = makeHarness();
    await addItem(h, { followUpAtMs: NOW + 86_400_000 });
    await checkDueFollowups(h.deps, NOW);
    assert.equal(h.fired.length, 0);
  });

  it("a failed fire (e.g. capped) still marks done — no retry", async () => {
    const h = makeHarness();
    h.fireImpl = async (ruleId, slotTime) => {
      h.fired.push({ ruleId, slotTime });
      return { fired: false, reason: "capped" };
    };
    const { item } = await addItem(h);
    await checkDueFollowups(h.deps, NOW);
    assert.equal(h.fired.length, 1);
    assert.equal((await h.followupStore.get(item.id))?.status, "done");
    await checkDueFollowups(h.deps, NOW);
    assert.equal(h.fired.length, 1);
  });

  it("cancels (never fires) when the persona is gone", async () => {
    const h = makeHarness();
    h.persona = null;
    const { rule, item } = await addItem(h);
    await checkDueFollowups(h.deps, NOW);
    assert.equal(h.fired.length, 0);
    assert.equal((await h.followupStore.get(item.id))?.status, "cancelled");
    assert.ok(h.retired.includes(rule.id));
  });
});

describe("wasDiscussed", () => {
  it("matches keywords in new messages only", async () => {
    const h = makeHarness();
    const kv = h.deps.storage as ReturnType<typeof fakeKv>;
    await seedDialog(kv, "t1", "pA", [
      msg("m1", "user", "我明天有个面试"),
      msg("m2", "assistant", "加油！"),
      msg("m3", "user", "今天天气真好"),
    ]);
    const { item } = await addItem(h, { baseline: { t1: 2 } });
    // Only m3 is new and it has no keyword.
    assert.equal(await wasDiscussed({ storage: kv }, item), false);
  });

  it("returns false with no keywords", async () => {
    const h = makeHarness();
    const { item } = await addItem(h, { keywords: [] });
    assert.equal(await wasDiscussed({ storage: h.deps.storage }, item), false);
  });
});
