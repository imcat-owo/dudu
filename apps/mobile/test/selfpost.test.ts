/**
 * AI self-post trigger （自发帖触发器） — tests.
 *
 * Hard guarantees under test:
 *  1. Slots respect quiet hours + her rhythm (no slot inside 06:00–16:00
 *     Asia/Shanghai; gate vetoes sleep-time fires).
 *  2. The model decision call happens EXACTLY once per slot.
 *  3. SKIP leaves no post (feed untouched, slot consumed, logged).
 *  4. The daily cap blocks over-posting (no model call on veto).
 *  5. An interrupted slot is never retried (throw mid-fire → consumed).
 *  6. Incognito blocks the write tools + the gate.
 *  7. Her toggle-off stops everything (scheduler no-op, gate veto).
 *  8. Honest simulation: 3 slots → post/skip/post → feed shows exactly
 *     the posted ones, the log shows the skip.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LocalTool, ToolContext } from "../src/api-groups/local-tools.js";
import type { ApiGroup } from "../src/api-groups/types.js";
import type { Persona } from "../src/persona/types.js";
import { parseSelfpostDecision } from "../src/selfpost/decide.js";
import { fireSelfpostSlot, type SelfpostExecutorDeps } from "../src/selfpost/executor.js";
import { evaluateSelfpostGate, SELFPOST_COLLISION_MS } from "../src/selfpost/gate.js";
import { checkDueSelfpostSlots } from "../src/selfpost/scheduler.js";
import {
  clampSlotCount,
  dueSlot,
  isSlotExpired,
  SELFPOST_SLOT_CANDIDATES,
  SELFPOST_SLOT_COUNT_MAX,
  SELFPOST_SLOT_COUNT_MIN,
  SELFPOST_TICK_GRACE_MS,
  selfpostSlotId,
  selfpostSlotsToday,
} from "../src/selfpost/slots.js";
import { type SelfpostConfig, SelfpostStore } from "../src/selfpost/store.js";
import { createSelfpostTools } from "../src/selfpost/tools.js";

// 2026-10-06 22:00 Asia/Shanghai (her evening, awake).
const NIGHT = Date.UTC(2026, 9, 6, 14, 0, 0);
// 2026-10-06 10:00 Asia/Shanghai (her sleep).
const SLEEPY = Date.UTC(2026, 9, 6, 2, 0, 0);

const FAKE_GROUP = { id: "g1", name: "test" } as unknown as ApiGroup;
const FAKE_PERSONA = { id: "p1", name: "小梦" } as unknown as Persona;

function shanghaiHour(ms: number): number {
  return (
    Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Shanghai",
        hour: "numeric",
        hour12: false,
      })
        .formatToParts(new Date(ms))
        .find((p) => p.type === "hour")?.value ?? "0",
    ) % 24
  );
}

function fakeKv() {
  const map = new Map<string, string>();
  return {
    getItem: async (k: string) => map.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

const BASE_CONFIG: SelfpostConfig = { enabled: true, slotCount: 3, dailyCap: 2 };

/** Fresh executor deps with a controllable clock and model. */
function makeDeps(opts?: {
  nowMs?: number;
  generate?: (call: number) => Promise<string>;
  incognito?: boolean;
  sharedSends?: number;
  sharedCap?: number;
  lastOutreachAt?: number;
  initiativeLastSendAt?: number;
  store?: SelfpostStore;
}): { deps: SelfpostExecutorDeps; feed: string[]; calls: string[]; store: SelfpostStore } {
  const store = opts?.store ?? new SelfpostStore(fakeKv());
  const feed: string[] = [];
  const calls: string[] = [];
  let callCount = 0;
  const nowRef = { ms: opts?.nowMs ?? NIGHT };
  const deps: SelfpostExecutorDeps = {
    selfpostStore: store,
    initiativeStore: {
      getDailyCap: async () => opts?.sharedCap ?? 3,
      countAllSendsToday: async () => opts?.sharedSends ?? 0,
      lastSendAt: async () => opts?.initiativeLastSendAt ?? 0,
    } as unknown as SelfpostExecutorDeps["initiativeStore"],
    outreachStore: {
      getLastOutreachAt: async () => ({ test: opts?.lastOutreachAt ?? 0 }),
    } as unknown as SelfpostExecutorDeps["outreachStore"],
    addFeedPost: async (text: string) => {
      feed.push(text);
      return { id: `post_${feed.length}` };
    },
    listTodayFeed: async () => feed.map((t) => `ai: ${t}`),
    listRecentMemories: async () => ["she likes late-night chats"],
    listTodayEvents: async () => [],
    getActivePersona: async () => FAKE_PERSONA,
    personaDisplayName: () => "小梦",
    personaVoiceHint: () => "cute but restrained",
    getActiveGroup: async () => FAKE_GROUP,
    generateText: async (_g, sys, user) => {
      callCount += 1;
      calls.push(`${sys.slice(0, 10)}|${user.slice(0, 10)}`);
      if (opts?.generate) return opts.generate(callCount);
      return "今晚的风很温柔，想你了。";
    },
    isIncognito: () => opts?.incognito ?? false,
    trace: { append: async () => {} } as unknown as SelfpostExecutorDeps["trace"],
    nowMs: () => nowRef.ms,
  };
  return { deps, feed, calls, store };
}

async function seedConfig(store: SelfpostStore, patch: Partial<SelfpostConfig> = {}) {
  await store.setConfig({ ...BASE_CONFIG, ...patch });
}

function slotAt(index: number, now: number) {
  return { index, atMs: now - 60_000, label: `s${index}` };
}

describe("selfpost slots (quiet hours + her rhythm)", () => {
  it("all candidates sit outside her 06:00–16:00 sleep window", () => {
    for (const c of SELFPOST_SLOT_CANDIDATES) {
      assert.ok(c.h < 6 || c.h >= 16, `candidate ${c.h}:${c.mi} is inside her sleep window`);
    }
  });

  it("computed slots for today also avoid the sleep window", () => {
    for (const s of selfpostSlotsToday(5, NIGHT)) {
      const h = shanghaiHour(s.atMs);
      assert.ok(h < 6 || h >= 16, `slot at ${h}:00 is inside her sleep window`);
    }
  });

  it("spread-first order: first 3 cover wake-up, evening, late-night", () => {
    const slots = selfpostSlotsToday(3, NIGHT);
    assert.equal(slots.length, 3);
    const hours = slots.map((s) => shanghaiHour(s.atMs));
    // 17:30 waking, 21:00 evening, 01:00 late-night — no two adjacent
    assert.ok(Math.abs(hours[0] - 17) <= 1, `first slot should be ~17:30, got ${hours[0]}`);
    assert.ok(Math.abs(hours[1] - 21) <= 1, `second slot should be ~21:00, got ${hours[1]}`);
    assert.ok(hours[2] <= 2 || hours[2] >= 23, `third slot should be late-night, got ${hours[2]}`);
  });

  it("clampSlotCount keeps 1–5", () => {
    assert.equal(clampSlotCount(0), SELFPOST_SLOT_COUNT_MIN);
    assert.equal(clampSlotCount(9), SELFPOST_SLOT_COUNT_MAX);
    assert.equal(clampSlotCount(3), 3);
  });

  it("dueSlot finds the most recent due unfired slot", () => {
    const now = NIGHT;
    const slots = [
      { index: 0, atMs: now - 30 * 60_000, label: "a" },
      { index: 1, atMs: now - 60_000, label: "b" },
      { index: 2, atMs: now + 60_000, label: "c" },
    ];
    const fired = new Set<string>();
    const due = dueSlot(slots, fired, 0, now);
    assert.ok(due, "a due slot exists");
    assert.equal(due.index, 1);
    fired.add(selfpostSlotId(0, 1));
    const due2 = dueSlot(slots, fired, 0, now);
    assert.ok(due2, "slot 0 is also due");
    assert.equal(due2.index, 0);
  });

  it("isSlotExpired: 16 min is expired, 5 min is not", () => {
    assert.equal(isSlotExpired(NIGHT - 16 * 60_000, NIGHT), true);
    assert.equal(isSlotExpired(NIGHT - 5 * 60_000, NIGHT), false);
    assert.equal(SELFPOST_TICK_GRACE_MS, 15 * 60_000);
  });
});

describe("selfpost decision parsing", () => {
  it("SKIP (any case, padded) → null", () => {
    assert.equal(parseSelfpostDecision("SKIP"), null);
    assert.equal(parseSelfpostDecision("  skip  "), null);
  });
  it("empty or too-long → null (strict)", () => {
    assert.equal(parseSelfpostDecision(""), null);
    assert.equal(parseSelfpostDecision("   "), null);
    assert.equal(parseSelfpostDecision("x".repeat(501)), null);
  });
  it("real text passes through", () => {
    assert.equal(parseSelfpostDecision("今晚的月亮很好。"), "今晚的月亮很好。");
  });
});

describe("selfpost gate (ordered, cheap vetoes first)", () => {
  function baseInput(over: Record<string, unknown> = {}) {
    return {
      config: BASE_CONFIG,
      isIncognito: false,
      slot: slotAt(0, NIGHT),
      fired: false,
      selfpostsToday: 0,
      sharedSendsToday: 0,
      sharedCap: 3,
      msSinceLastActivity: SELFPOST_COLLISION_MS + 1,
      hasPersona: true,
      hasApiGroup: true,
      nowMs: NIGHT,
      ...over,
    };
  }

  it("happy path → allowed", () => {
    const r = evaluateSelfpostGate(baseInput());
    assert.equal(r.allowed, true);
  });

  const vetoes: Array<[string, Record<string, unknown>, string]> = [
    ["disabled", { config: { ...BASE_CONFIG, enabled: false } }, "disabled"],
    ["incognito", { isIncognito: true }, "incognito"],
    ["quiet-hours", { nowMs: SLEEPY }, "quiet-hours"],
    ["already-fired", { fired: true }, "already-fired"],
    ["expired", { slot: { index: 0, atMs: NIGHT - 16 * 60_000, label: "x" } }, "expired"],
    ["selfpost-capped", { selfpostsToday: 2 }, "selfpost-capped"],
    ["shared-capped", { sharedSendsToday: 3 }, "shared-capped"],
    ["collision", { msSinceLastActivity: 30 * 60_000 }, "collision"],
    ["persona-missing", { hasPersona: false }, "persona-missing"],
    ["no-api-group", { hasApiGroup: false }, "no-api-group"],
  ];
  for (const [name, over, reason] of vetoes) {
    it(`vetoes: ${name} → ${reason}`, () => {
      const r = evaluateSelfpostGate(baseInput(over));
      assert.equal(r.allowed, false);
      assert.equal(r.reason, reason);
    });
  }
});

describe("selfpost executor", () => {
  it("happy path: one decision call → posted to the feed, logged, traced", async () => {
    const { deps, feed, calls, store } = makeDeps();
    await seedConfig(store);
    const out = await fireSelfpostSlot(deps, slotAt(0, NIGHT));
    assert.equal(calls.length, 1, "the model is asked EXACTLY once per slot");
    assert.equal(out.fired, true);
    assert.equal(out.outcome, "posted");
    assert.equal(feed.length, 1, "exactly one feed post");
    const log = await store.listLog(10);
    assert.equal(log.length, 1);
    assert.equal(log[0].outcome, "posted");
    assert.equal(await store.countSendsToday(NIGHT), 1);
  });

  it("SKIP: no post, no second call, slot consumed, logged as skipped", async () => {
    const { deps, feed, calls, store } = makeDeps({
      generate: async () => "SKIP",
    });
    await seedConfig(store);
    const out = await fireSelfpostSlot(deps, slotAt(0, NIGHT));
    assert.equal(calls.length, 1);
    assert.equal(out.fired, true);
    assert.equal(out.outcome, "skipped");
    assert.equal(feed.length, 0, "skip leaves no post");
    const log = await store.listLog(10);
    assert.equal(log.length, 1);
    assert.equal(log[0].outcome, "skipped");
    assert.equal(log[0].reason, "model-skip");
    // Slot is consumed: a second fire is vetoed as already-fired.
    const again = await fireSelfpostSlot(deps, slotAt(0, NIGHT));
    assert.equal(again.fired, false);
    assert.equal(again.reason, "already-fired");
  });

  it("daily cap blocks: vetoed BEFORE any model call", async () => {
    const { deps, feed, calls, store } = makeDeps();
    await seedConfig(store, { dailyCap: 1 });
    await store.recordSend(NIGHT - 1000);
    const out = await fireSelfpostSlot(deps, slotAt(0, NIGHT));
    assert.equal(out.fired, false);
    assert.equal(out.reason, "selfpost-capped");
    assert.equal(calls.length, 0, "no model call on cap veto");
    assert.equal(feed.length, 0);
  });

  it("interrupted slot is never retried (model throws mid-fire)", async () => {
    const { deps, feed, calls, store } = makeDeps({
      generate: async () => {
        throw new Error("model exploded");
      },
    });
    await seedConfig(store);
    const out = await fireSelfpostSlot(deps, slotAt(0, NIGHT));
    assert.equal(calls.length, 1);
    assert.equal(out.fired, true);
    assert.equal(out.outcome, "skipped");
    assert.equal(feed.length, 0);
    // The slot stays consumed even though the decision failed.
    const again = await fireSelfpostSlot(deps, slotAt(0, NIGHT));
    assert.equal(again.fired, false);
    assert.equal(again.reason, "already-fired");
    const log = await store.listLog(10);
    assert.ok(
      log.some((e) => e.outcome === "skipped" && e.reason === "model-skip"),
      "the interrupted decision is logged as a skip, not a retry",
    );
  });

  it("gate veto consumes the slot too (disabled mid-day)", async () => {
    const { deps, calls, store } = makeDeps();
    await seedConfig(store, { enabled: false });
    const out = await fireSelfpostSlot(deps, slotAt(0, NIGHT));
    assert.equal(out.fired, false);
    assert.equal(out.reason, "disabled");
    assert.equal(calls.length, 0);
    const fired = await store.firedSlotIds();
    assert.ok(fired.size > 0, "vetoed slot is consumed, never retried");
  });

  it("incognito: gate vetoes, no model call", async () => {
    const { deps, calls } = makeDeps({ incognito: true });
    await seedConfig(deps.selfpostStore);
    const out = await fireSelfpostSlot(deps, slotAt(0, NIGHT));
    assert.equal(out.fired, false);
    assert.equal(out.reason, "incognito");
    assert.equal(calls.length, 0);
  });

  it("kill during the model call: slot already consumed, next tick does NOT re-fire (P1-1)", async () => {
    let release!: (v: string) => void;
    const hanging = new Promise<string>((res) => {
      release = res;
    });
    const { deps, calls, store } = makeDeps({ generate: () => hanging });
    await seedConfig(store);
    // The model call hangs — the slot must already be in the ledger.
    const first = fireSelfpostSlot(deps, slotAt(0, NIGHT));
    const deadline = Date.now() + 2000;
    let consumed = false;
    while (Date.now() < deadline) {
      if ((await store.firedSlotIds()).size > 0) {
        consumed = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.ok(consumed, "slot is marked fired BEFORE the model call resolves");
    // The kill "lands": resolve the hanging call as a skip, then a fresh
    // tick for the same slot must be vetoed, never re-fired.
    release("SKIP");
    const out1 = await first;
    assert.equal(out1.fired, true);
    if (out1.fired) assert.equal(out1.outcome, "skipped");
    assert.equal(calls.length, 1, "the model is asked exactly once per slot");
    const again = await fireSelfpostSlot(deps, slotAt(0, NIGHT));
    assert.equal(again.fired, false);
    assert.equal(again.reason, "already-fired");
    assert.equal(calls.length, 1, "no second model call on the retry tick");
  });

  it("collision: an initiative send 10 min ago vetoes the slot (P2-1)", async () => {
    const { deps, calls } = makeDeps({ initiativeLastSendAt: NIGHT - 10 * 60_000 });
    await seedConfig(deps.selfpostStore);
    const out = await fireSelfpostSlot(deps, slotAt(0, NIGHT));
    assert.equal(out.fired, false);
    assert.equal(out.reason, "collision");
    assert.equal(calls.length, 0, "no model call on collision veto");
  });

  it("collision: an outreach send 10 min ago vetoes the slot (P2-1)", async () => {
    const { deps, calls } = makeDeps({ lastOutreachAt: NIGHT - 10 * 60_000 });
    await seedConfig(deps.selfpostStore);
    const out = await fireSelfpostSlot(deps, slotAt(0, NIGHT));
    assert.equal(out.fired, false);
    assert.equal(out.reason, "collision");
    assert.equal(calls.length, 0, "no model call on collision veto");
  });
});

describe("selfpost scheduler", () => {
  it("toggle-off stops everything (no fire, no model call)", async () => {
    const { deps, calls } = makeDeps();
    await seedConfig(deps.selfpostStore, { enabled: false });
    await checkDueSelfpostSlots(deps);
    assert.equal(calls.length, 0);
  });

  it("never throws on broken storage", async () => {
    const broken = new SelfpostStore({
      getItem: async () => {
        throw new Error("kv down");
      },
      setItem: async () => {
        throw new Error("kv down");
      },
    });
    const { deps } = makeDeps({ store: broken, nowMs: NIGHT });
    await checkDueSelfpostSlots(deps); // must not throw
  });
});

function mustTool(tools: LocalTool[], name: string): LocalTool {
  const t = tools.find((x) => x.name === name);
  assert.ok(t, `tool ${name} must exist`);
  return t;
}

describe("selfpost tools (incognito)", () => {
  function makeTools(incognito: boolean) {
    const { deps, store } = makeDeps({ incognito });
    const tools = createSelfpostTools({
      selfpostStore: store,
      buildExecutorDeps: async () => deps,
      isIncognito: () => incognito,
      nowMs: () => NIGHT,
    });
    return { tools, store };
  }

  it("selfpost_config writes are blocked in incognito", async () => {
    const { tools } = makeTools(true);
    const cfg = mustTool(tools, "selfpost_config");
    await assert.rejects(() => cfg.run({ enabled: true }, {} as ToolContext), /Incognito/);
  });

  it("selfpost_post_now is blocked in incognito", async () => {
    const { tools } = makeTools(true);
    const post = mustTool(tools, "selfpost_post_now");
    await assert.rejects(() => post.run({}, {} as ToolContext), /Incognito/);
  });

  it("selfpost_status and selfpost_log stay readable in incognito", async () => {
    const { tools, store } = makeTools(true);
    await seedConfig(store);
    const status = mustTool(tools, "selfpost_status");
    const log = mustTool(tools, "selfpost_log");
    const s = await status.run({}, {} as ToolContext);
    assert.match(String(s), /AI self-post trigger/);
    const l = await log.run({}, {} as ToolContext);
    assert.match(String(l), /No self-post decisions/);
  });

  it("selfpost_config writes work outside incognito", async () => {
    const { tools, store } = makeTools(false);
    const cfg = mustTool(tools, "selfpost_config");
    const out = await cfg.run({ dailyCap: 3 }, {} as ToolContext);
    assert.match(String(out), /cap 3\/day/);
    assert.equal((await store.getConfig()).dailyCap, 3);
  });
});

describe("selfpost honest simulation: 3 slots → post/skip/post", () => {
  it("feed shows exactly the posted ones; the log shows the skip", async () => {
    // A quiet evening on her clock: slots at 21:00, 23:30, 01:00.
    const base = Date.UTC(2026, 9, 6, 13, 0, 0); // 21:00 Shanghai
    const responses = ["今晚的云很好看，像你。", "SKIP", "夜深了，你还在吗。"];
    let now = base;
    const store = new SelfpostStore(fakeKv());
    const { deps, feed, calls } = makeDeps({
      store,
      generate: async (call) => responses[call - 1],
    });
    // nowMs must follow the mutable clock — rewire through deps closure.
    const dynDeps: SelfpostExecutorDeps = { ...deps, nowMs: () => now };
    await seedConfig(store, { slotCount: 3, dailyCap: 3 });

    const outcomes = [];
    for (let i = 0; i < 3; i += 1) {
      now = base + i * 2.5 * 3600_000; // 21:00 → 23:30 → 01:00(next day)
      const slotNow = dynDeps.nowMs();
      outcomes.push(
        await fireSelfpostSlot(dynDeps, { index: i, atMs: slotNow - 60_000, label: `s${i}` }),
      );
    }

    assert.equal(calls.length, 3, "one model call per slot");
    assert.deepEqual(
      outcomes.map((o) => (o.fired ? o.outcome : "vetoed")),
      ["posted", "skipped", "posted"],
    );
    assert.deepEqual(feed, [responses[0], responses[2]], "feed has exactly the posted ones");

    const log = await store.listLog(10);
    assert.equal(log.length, 3);
    // listLog is newest-first.
    assert.equal(log[0].outcome, "posted");
    assert.equal(log[1].outcome, "skipped");
    assert.equal(log[1].reason, "model-skip");
    assert.equal(log[2].outcome, "posted");
    assert.equal(log[2].textPreview, responses[0].slice(0, 120));
  });
});
