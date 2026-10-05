/**
 * Proactive initiative （主动约定） — executor tests.
 *
 * Hard guarantees under test:
 *  1. A due rule generates -> delivers to the dialog -> traces. The full
 *     happy path is real (message bytes land in dialog storage).
 *  2. Persona isolation: a rule for persona A NEVER lands in persona B's
 *     dialog (latest target and pinned-cross-persona both fail closed).
 *  3. Daily cap (initiative + shared outreach channel) blocks firing.
 *  4. A fired slot never refires; a failed fire consumes its slot
 *     (interrupted execution is never retried).
 *  5. Copy iron rule: the generation prompt NEVER claims she just sent
 *     a request — this is HIS initiative.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ApiGroup } from "../src/api-groups/types.js";
import {
  buildInitiativeSystemPrompt,
  dueSlot,
  fireInitiativeRule,
  INITIATIVE_TICK_GRACE_MS,
  type InitiativeExecutorDeps,
  isSlotExpired,
} from "../src/initiative/executor.js";
import type { InitiativeRule } from "../src/initiative/rules.js";
import { InitiativeStore } from "../src/initiative/store.js";

// 2026-10-05 12:00 Shanghai.
const NOW = Date.UTC(2026, 9, 5, 4, 0, 0);

const FAKE_GROUP = { id: "g1", name: "test" } as unknown as ApiGroup;

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

interface TraceEntry {
  action: string;
  personaId?: string;
  summary?: string;
}

interface TestCtx {
  deps: InitiativeExecutorDeps;
  kv: ReturnType<typeof fakeKv>;
  traceEntries: TraceEntry[];
  generated: { system: string; user: string }[];
  generateImpl: (system: string, user: string) => Promise<string>;
  outreachLast: Record<string, number>;
  personaExists: boolean;
  threadMessages: (id: string) => { content: string }[];
}

function seedDialogs(kv: ReturnType<typeof fakeKv>) {
  // threadA belongs to personaA, threadB to personaB.
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

function makeCtx(): TestCtx {
  const kv = fakeKv();
  seedDialogs(kv);
  const initiativeStore = new InitiativeStore(kv, { nowMs: () => NOW });
  const traceEntries: TraceEntry[] = [];
  const generated: { system: string; user: string }[] = [];
  const ctx: TestCtx = {
    kv,
    traceEntries,
    generated,
    generateImpl: async () => "早安呀，昨晚睡得好吗",
    outreachLast: {},
    personaExists: true,
    threadMessages: (id: string) => {
      const raw = kv.__map.get(`dudu.local-chat.${id}.v1`);
      return raw ? (JSON.parse(raw) as { content: string }[]) : [];
    },
    deps: null as unknown as InitiativeExecutorDeps,
  };
  ctx.deps = {
    initiativeStore,
    outreachStore: {
      getLastOutreachAt: async () => ctx.outreachLast,
    } as unknown as TestCtx["deps"]["outreachStore"],
    storage: kv,
    trace: {
      append: async (e: TraceEntry) => {
        traceEntries.push(e);
        return {};
      },
    },
    visibility: {
      isSendTagVisible: async () => true,
    } as unknown as TestCtx["deps"]["visibility"],
    notifications: {
      getPermissionsAsync: async () => ({ status: "granted" }),
      cancelScheduledNotificationAsync: async () => {},
      scheduleNotificationAsync: async () => "id",
    },
    getActiveGroup: async () => FAKE_GROUP,
    generateText: async (_g, system, user) => {
      generated.push({ system, user });
      return ctx.generateImpl(system, user);
    },
    getPersona: async (id: string) =>
      ctx.personaExists ? ({ id, name: "测试人设" } as never) : null,
    personaDisplayName: (p) => (p as { name: string }).name,
    nowMs: () => NOW,
  };
  return ctx;
}

async function makeRule(ctx: TestCtx, over: Partial<InitiativeRule> = {}): Promise<InitiativeRule> {
  // The store stamps createdAt from the injected test clock (NOW).
  return ctx.deps.initiativeStore.create({
    personaId: "personaA",
    title: "早安",
    topic: "跟她说早安",
    type: "daily",
    schedule: { kind: "daily", hour: 8, minute: 0 },
    ...over,
  });
}

describe("fireInitiativeRule — happy path", () => {
  it("generates -> delivers to the dialog -> traces, slot consumed", async () => {
    const ctx = makeCtx();
    const rule = await makeRule(ctx);
    // Explicit slot (today 8:00 Shanghai). dueSlot() itself is tested
    // separately; firing takes the slot as given.
    const slot = Date.UTC(2026, 9, 5, 0, 0, 0);

    const before = ctx.threadMessages("threadA").length;
    const outcome = await fireInitiativeRule(ctx.deps, rule.id, slot);
    assert.equal(outcome.fired, true);
    if (!outcome.fired) throw new Error("unreachable");

    // Message bytes really landed in personaA's dialog.
    const after = ctx.threadMessages("threadA");
    assert.equal(after.length, before + 1);
    assert.equal(after[after.length - 1].content, "早安呀，昨晚睡得好吗");

    // Generation happened with the topic.
    assert.equal(ctx.generated.length, 1);
    assert.ok(ctx.generated[0].user.includes("跟她说早安"));

    // Trace logged for her audit.
    assert.equal(ctx.traceEntries.length, 1);
    assert.equal(ctx.traceEntries[0].action, "proactive_send");
    assert.equal(ctx.traceEntries[0].personaId, "personaA");

    // Slot is consumed: firing again reports already-fired, no duplicate.
    const again = await fireInitiativeRule(ctx.deps, rule.id, slot);
    assert.deepEqual(again, { fired: false, reason: "already-fired" });
    assert.equal(ctx.threadMessages("threadA").length, after.length);
  });

  it("one_time manual run fires with slot = now", async () => {
    const ctx = makeCtx();
    const rule = await makeRule(ctx, {
      type: "one_time",
      schedule: { kind: "one_time", atMs: NOW + 3_600_000 },
    });
    const outcome = await fireInitiativeRule(ctx.deps, rule.id, NOW);
    assert.equal(outcome.fired, true);
  });
});

describe("persona isolation", () => {
  it("latest target never lands in another persona's dialog", async () => {
    const ctx = makeCtx();
    const rule = await makeRule(ctx); // personaA, latest -> threadA
    const slot = Date.UTC(2026, 9, 5, 0, 0, 0);
    const beforeB = ctx.threadMessages("threadB").length;
    const outcome = await fireInitiativeRule(ctx.deps, rule.id, slot);
    assert.equal(outcome.fired, true);
    assert.equal(ctx.threadMessages("threadB").length, beforeB);
    if (outcome.fired) assert.equal(outcome.threadId, "threadA");
  });

  it("pinned dialog of another persona fails closed (no leak, no reroute)", async () => {
    const ctx = makeCtx();
    const rule = await makeRule(ctx, { target: { mode: "pinned", threadId: "threadB" } });
    const outcome = await fireInitiativeRule(ctx.deps, rule.id, NOW);
    assert.deepEqual(outcome, { fired: false, reason: "no-dialog" });
    assert.equal(ctx.generated.length, 0, "no generation for a refused delivery");
    assert.equal(ctx.traceEntries.length, 0);
  });

  it("pinned dialog of the OWN persona delivers", async () => {
    const ctx = makeCtx();
    const rule = await makeRule(ctx, { target: { mode: "pinned", threadId: "threadA" } });
    const outcome = await fireInitiativeRule(ctx.deps, rule.id, NOW);
    assert.equal(outcome.fired, true);
    if (outcome.fired) assert.equal(outcome.threadId, "threadA");
  });

  it("rule for a deleted persona stays silent", async () => {
    const ctx = makeCtx();
    ctx.personaExists = false;
    const rule = await makeRule(ctx);
    const outcome = await fireInitiativeRule(ctx.deps, rule.id, NOW);
    assert.deepEqual(outcome, { fired: false, reason: "persona-missing" });
  });

  it("persona with no dialogs stays silent", async () => {
    const ctx = makeCtx();
    const rule = await makeRule(ctx, { personaId: "personaNobody" });
    const outcome = await fireInitiativeRule(ctx.deps, rule.id, NOW);
    assert.deepEqual(outcome, { fired: false, reason: "no-dialog" });
  });
});

describe("daily cap (shared channel)", () => {
  it("initiative sends at cap block firing", async () => {
    const ctx = makeCtx();
    await ctx.deps.initiativeStore.setDailyCap(1);
    await ctx.deps.initiativeStore.recordSend("personaA", NOW);
    const rule = await makeRule(ctx);
    const outcome = await fireInitiativeRule(ctx.deps, rule.id, NOW);
    assert.deepEqual(outcome, { fired: false, reason: "capped" });
    assert.equal(ctx.generated.length, 0);
  });

  it("outreach sends today count toward the same cap", async () => {
    const ctx = makeCtx();
    await ctx.deps.initiativeStore.setDailyCap(1);
    ctx.outreachLast = { anniversary: NOW - 3_600_000 };
    const rule = await makeRule(ctx);
    const outcome = await fireInitiativeRule(ctx.deps, rule.id, NOW);
    assert.deepEqual(outcome, { fired: false, reason: "capped" });
  });

  it("yesterday's outreach does not count", async () => {
    const ctx = makeCtx();
    await ctx.deps.initiativeStore.setDailyCap(1);
    ctx.outreachLast = { anniversary: NOW - 26 * 3_600_000 };
    const rule = await makeRule(ctx);
    const outcome = await fireInitiativeRule(ctx.deps, rule.id, NOW);
    assert.equal(outcome.fired, true);
  });

  it("outreach counting is global, not per persona (P2-3): two kinds today count as two", async () => {
    const ctx = makeCtx();
    await ctx.deps.initiativeStore.setDailyCap(2);
    // Two different outreach kinds fired today — both count, regardless
    // of which persona the rule belongs to. The outreach ledger has no
    // persona dimension; this is the conservative global semantics.
    ctx.outreachLast = { anniversary: NOW - 3_600_000, silence: NOW - 2 * 3_600_000 };
    const rule = await makeRule(ctx);
    const outcome = await fireInitiativeRule(ctx.deps, rule.id, NOW);
    assert.deepEqual(outcome, { fired: false, reason: "capped" });
  });

  it("cap is per persona", async () => {
    const ctx = makeCtx();
    await ctx.deps.initiativeStore.setDailyCap(1);
    await ctx.deps.initiativeStore.recordSend("personaB", NOW);
    const rule = await makeRule(ctx); // personaA
    const outcome = await fireInitiativeRule(ctx.deps, rule.id, NOW);
    assert.equal(outcome.fired, true);
  });
});

describe("in-flight slot claim (P2-1)", () => {
  it("two concurrent fires of one slot deliver exactly once", async () => {
    const ctx = makeCtx();
    const rule = await makeRule(ctx);
    const slot = Date.UTC(2026, 9, 5, 0, 0, 0);
    // Gate generation so both calls are genuinely in flight together.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    ctx.generateImpl = async () => {
      await gate;
      return "想你了";
    };
    const before = ctx.threadMessages("threadA").length;
    const p1 = fireInitiativeRule(ctx.deps, rule.id, slot);
    const p2 = fireInitiativeRule(ctx.deps, rule.id, slot);
    release();
    const [a, b] = await Promise.all([p1, p2]);
    const fired = [a, b].filter((o) => o.fired);
    const refused = [a, b].filter((o) => !o.fired);
    assert.equal(fired.length, 1, "exactly one winner");
    assert.equal(refused.length, 1);
    assert.deepEqual(refused[0], { fired: false, reason: "already-fired" });
    assert.equal(ctx.threadMessages("threadA").length, before + 1, "one delivery");
  });
});

describe("tick grace window (P1-1)", () => {
  it("isSlotExpired: 15 minutes is the boundary", () => {
    assert.equal(isSlotExpired(NOW - INITIATIVE_TICK_GRACE_MS, NOW), false);
    assert.equal(isSlotExpired(NOW - INITIATIVE_TICK_GRACE_MS - 1, NOW), true);
    assert.equal(isSlotExpired(NOW, NOW), false);
  });
});

describe("no auto-retry on interruption", () => {
  it("a failed fire consumes its slot — the next attempt reports already-fired", async () => {
    const ctx = makeCtx();
    ctx.generateImpl = async () => {
      throw new Error("network down");
    };
    const rule = await makeRule(ctx);
    const first = await fireInitiativeRule(ctx.deps, rule.id, NOW);
    assert.deepEqual(first, { fired: false, reason: "generate-failed" });

    ctx.generateImpl = async () => "recovered";
    const second = await fireInitiativeRule(ctx.deps, rule.id, NOW);
    assert.deepEqual(second, { fired: false, reason: "already-fired" });
    assert.equal(ctx.threadMessages("threadA").length, 1, "nothing delivered");
  });

  it("archived rules refuse; unknown rules refuse", async () => {
    const ctx = makeCtx();
    const rule = await makeRule(ctx);
    await ctx.deps.initiativeStore.setStatus(rule.id, "archived");
    assert.deepEqual(await fireInitiativeRule(ctx.deps, rule.id, NOW), {
      fired: false,
      reason: "rule-archived",
    });
    assert.deepEqual(await fireInitiativeRule(ctx.deps, "nope", NOW), {
      fired: false,
      reason: "rule-not-found",
    });
  });

  it("no API group fails honestly without consuming generation", async () => {
    const ctx = makeCtx();
    ctx.deps.getActiveGroup = async () => null;
    const rule = await makeRule(ctx);
    assert.deepEqual(await fireInitiativeRule(ctx.deps, rule.id, NOW), {
      fired: false,
      reason: "no-api-group",
    });
    assert.equal(ctx.generated.length, 0);
  });
});

describe("copy iron rule", () => {
  it("the generation prompt forbids claiming she just sent a request", () => {
    const prompt = buildInitiativeSystemPrompt("小梦");
    assert.ok(prompt.includes("小梦"), "addresses the persona by name");
    const lower = prompt.toLowerCase();
    assert.ok(
      lower.includes("never") && lower.includes("she just sent"),
      "explicitly forbids claiming she just sent a request",
    );
    // The forbidden phrases are named only as prohibitions ("No ...").
    assert.ok(
      lower.includes('no "你刚才说"') || lower.includes("never claim"),
      "forbidden phrasing is framed as a prohibition, not an instruction",
    );
    assert.ok(lower.includes("initiative"), "frames this as his initiative");
  });
});

describe("dueSlot", () => {
  it("daily: yesterday's slot is due, and a rule born after it is not", async () => {
    const ctx = makeCtx();
    const rule = await makeRule(ctx); // createdAt = now (set by store)
    // Pretend it was created yesterday: dueSlot guards on createdAt.
    const old = { ...rule, createdAt: NOW - 2 * 86_400_000 };
    const slot = dueSlot(old, NOW);
    assert.equal(slot, Date.UTC(2026, 9, 5, 0, 0, 0), "today 8:00 Shanghai");

    const newborn = { ...rule, createdAt: NOW };
    assert.equal(dueSlot(newborn, NOW), null, "born after today's slot: waits for tomorrow");
  });

  it("one_time past is due; future is not; archived never", async () => {
    const ctx = makeCtx();
    const past = await makeRule(ctx, {
      type: "one_time",
      schedule: { kind: "one_time", atMs: NOW - 60_000 },
    });
    assert.equal(dueSlot(past, NOW), NOW - 60_000);

    const future = await makeRule(ctx, {
      type: "one_time",
      schedule: { kind: "one_time", atMs: NOW + 60_000 },
    });
    assert.equal(dueSlot(future, NOW), null);
    assert.equal(dueSlot({ ...past, status: "archived" }, NOW), null);
  });
});
