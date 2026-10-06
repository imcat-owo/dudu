/**
 * Proactive initiative （主动约定） — scheduler tests.
 *
 * Under test:
 *  1. ensureScheduled pre-schedules exactly one template notification per
 *     rule (identifier, kind, slotTime); archived/past rules cancel.
 *  2. checkDueInitiatives: a due rule cancels its notification and runs
 *     the AI path; a not-due rule is untouched.
 *  3. handleInitiativeTap delivers exactly once (double tap = null).
 *  4. E2E-ish proof: rule -> notification scheduled -> tap -> AI message
 *     lands in the dialog + trace written + slot consumed.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ApiGroup } from "../src/api-groups/types.js";
import { initiativeNotificationId, isSlotExpired } from "../src/initiative/executor.js";
import type { InitiativeRule } from "../src/initiative/rules.js";
import { slotId } from "../src/initiative/rules.js";
import {
  cancelScheduled,
  checkDueInitiatives,
  ensureScheduled,
  handleInitiativeTap,
  type InitiativeSchedulerDeps,
  rescheduleAll,
} from "../src/initiative/scheduler.js";
import { InitiativeStore } from "../src/initiative/store.js";
import { PhotoshareStore } from "../src/photoshare/store.js";
import { SelfpostStore } from "../src/selfpost/store.js";

// 2026-10-05 12:00 Shanghai.
const NOW = Date.UTC(2026, 9, 5, 4, 0, 0);
const FAKE_GROUP = { id: "g1", name: "test" } as unknown as ApiGroup;

interface ScheduledReq {
  identifier: string;
  content: { title: string; body: string; data?: Record<string, string> };
  trigger: { seconds: number };
}

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

interface TestCtx {
  deps: InitiativeSchedulerDeps;
  kv: ReturnType<typeof fakeKv>;
  scheduled: ScheduledReq[];
  cancelled: string[];
  traceActions: string[];
  permission: string;
}

function makeCtx(permission = "granted", clock: () => number = () => NOW): TestCtx {
  const kv = fakeKv();
  kv.__map.set(
    "dudu.local-chat.threadA.v1",
    JSON.stringify([{ id: "m1", role: "user", content: "hi" }]),
  );
  kv.__map.set(
    "dudu.dialog-registry.v1",
    JSON.stringify({ threadA: { personaId: "personaA", name: "A" } }),
  );
  const initiativeStore = new InitiativeStore(kv, { nowMs: clock });
  const ctx: TestCtx = {
    kv,
    scheduled: [],
    cancelled: [],
    traceActions: [],
    permission,
    deps: null as unknown as InitiativeSchedulerDeps,
  };
  ctx.deps = {
    initiativeStore,
    outreachStore: {
      getLastOutreachAt: async () => ({}),
    } as unknown as TestCtx["deps"]["outreachStore"],
    selfpostStore: new SelfpostStore(kv, { nowMs: clock }),
    photoshareStore: new PhotoshareStore(kv, { nowMs: clock }),
    storage: kv,
    trace: {
      append: async (e: { action: string }) => {
        ctx.traceActions.push(e.action);
        return {};
      },
    },
    visibility: {
      isSendTagVisible: async () => true,
    } as unknown as TestCtx["deps"]["visibility"],
    notifications: {
      getPermissionsAsync: async () => ({ status: ctx.permission }),
      cancelScheduledNotificationAsync: async (id: string) => {
        ctx.cancelled.push(id);
      },
      scheduleNotificationAsync: async (req: ScheduledReq) => {
        ctx.scheduled.push(req);
        return req.identifier;
      },
    },
    getActiveGroup: async () => FAKE_GROUP,
    generateText: async () => "想你了，过来抱一下",
    getPersona: async (id: string) => ({ id, name: "测试人设" }) as never,
    personaDisplayName: (p) => (p as { name: string }).name,
    nowMs: () => NOW,
  };
  return ctx;
}

async function makeDaily(ctx: TestCtx, hour: number, minute = 0): Promise<InitiativeRule> {
  // The store stamps createdAt from the injected test clock (NOW).
  return ctx.deps.initiativeStore.create({
    personaId: "personaA",
    title: "测试约定",
    topic: "测试话题",
    type: "daily",
    schedule: { kind: "daily", hour, minute },
  });
}

function threadMessages(ctx: TestCtx, id: string): { content: string }[] {
  const raw = ctx.kv.__map.get(`dudu.local-chat.${id}.v1`);
  return raw ? (JSON.parse(raw) as { content: string }[]) : [];
}

describe("ensureScheduled", () => {
  it("schedules one template notification with kind + slotTime data", async () => {
    const ctx = makeCtx();
    const rule = await makeDaily(ctx, 13); // 13:00 Shanghai today
    await ensureScheduled(ctx.deps, rule, NOW);
    assert.equal(ctx.scheduled.length, 1);
    const req = ctx.scheduled[0];
    assert.equal(req.identifier, initiativeNotificationId(rule.id));
    assert.equal(req.content.title, rule.title);
    assert.ok(req.content.body.length > 0, "template body is real copy, not empty");
    assert.equal(req.content.data?.kind, "initiative");
    assert.equal(req.content.data?.ruleId, rule.id);
    assert.equal(req.content.data?.slotTime, String(Date.UTC(2026, 9, 5, 5, 0, 0)));
    assert.ok(req.trigger.seconds > 0 && req.trigger.seconds <= 3_600);
  });

  it("archived rules cancel instead of scheduling", async () => {
    const ctx = makeCtx();
    const rule = await makeDaily(ctx, 13);
    await ctx.deps.initiativeStore.setStatus(rule.id, "archived");
    const archived = (await ctx.deps.initiativeStore.get(rule.id)) as InitiativeRule;
    await ensureScheduled(ctx.deps, archived, NOW);
    assert.equal(ctx.scheduled.length, 0);
    assert.deepEqual(ctx.cancelled, [initiativeNotificationId(rule.id)]);
  });

  it("one_time in the past cancels", async () => {
    const ctx = makeCtx();
    const created = await ctx.deps.initiativeStore.create({
      personaId: "personaA",
      title: "过期",
      topic: "x",
      type: "one_time",
      schedule: { kind: "one_time", atMs: NOW - 1_000 },
    });
    await ensureScheduled(ctx.deps, created, NOW);
    assert.equal(ctx.scheduled.length, 0);
    assert.deepEqual(ctx.cancelled, [initiativeNotificationId(created.id)]);
  });

  it("no notification permission -> stays silent", async () => {
    const ctx = makeCtx("denied");
    const rule = await makeDaily(ctx, 13);
    await ensureScheduled(ctx.deps, rule, NOW);
    assert.equal(ctx.scheduled.length, 0);
  });

  it("cancelScheduled is idempotent", async () => {
    const ctx = makeCtx();
    await cancelScheduled(ctx.deps.notifications, "nope");
    assert.deepEqual(ctx.cancelled, ["dudu-initiative-nope"]);
  });

  it("rescheduleAll arms every active rule", async () => {
    const ctx = makeCtx();
    await makeDaily(ctx, 13);
    await makeDaily(ctx, 14);
    await rescheduleAll(ctx.deps, NOW);
    assert.equal(ctx.scheduled.length, 2);
  });
});

describe("checkDueInitiatives", () => {
  // 8:00 Shanghai slot; 8:10 is inside the 15-minute grace window.
  const WITHIN_GRACE = NOW - 230 * 60_000;

  it("a due rule cancels its notification and runs the AI path", async () => {
    // Rule born two days ago: today's 8:00 slot is genuinely due at 8:10.
    const ctx = makeCtx("granted", () => NOW - 2 * 86_400_000);
    const rule = await makeDaily(ctx, 8); // 8:00 Shanghai today — due at 8:10
    await ensureScheduled(ctx.deps, rule, NOW);
    assert.equal(ctx.scheduled.length, 1);

    await checkDueInitiatives(ctx.deps, WITHIN_GRACE);
    assert.deepEqual(ctx.cancelled, [initiativeNotificationId(rule.id)]);
    const msgs = threadMessages(ctx, "threadA");
    assert.equal(msgs[msgs.length - 1].content, "想你了，过来抱一下");
    assert.deepEqual(ctx.traceActions, ["proactive_send"]);
  });

  it("an expired slot is consumed on the tick, never delivered (P1-1)", async () => {
    // Same rule, but the tick runs at 12:00 — the 8:00 slot is 4 hours
    // stale. Her anti-disturbance rule: consume silently, no backfill.
    const ctx = makeCtx("granted", () => NOW - 2 * 86_400_000);
    const rule = await makeDaily(ctx, 8);
    const slot = Date.UTC(2026, 9, 5, 0, 0, 0); // 8:00 Shanghai
    assert.ok(isSlotExpired(slot, NOW));

    await checkDueInitiatives(ctx.deps, NOW);
    assert.equal(threadMessages(ctx, "threadA").length, 1, "nothing delivered");
    assert.deepEqual(ctx.traceActions, [], "nothing traced");
    assert.equal(
      await ctx.deps.initiativeStore.wasSlotFired(slotId(rule.id, slot)),
      true,
      "expired slot is consumed",
    );
    // A later tick can never deliver it either.
    await checkDueInitiatives(ctx.deps, NOW + 60_000);
    assert.equal(threadMessages(ctx, "threadA").length, 1);
  });

  it("concurrent double-tick fires one slot at most once (P2-1)", async () => {
    const ctx = makeCtx("granted", () => NOW - 2 * 86_400_000);
    await makeDaily(ctx, 8);
    const before = threadMessages(ctx, "threadA").length;
    // The 30s timer and a foreground event firing at the same instant.
    await Promise.all([
      checkDueInitiatives(ctx.deps, WITHIN_GRACE),
      checkDueInitiatives(ctx.deps, WITHIN_GRACE),
    ]);
    assert.equal(threadMessages(ctx, "threadA").length, before + 1, "exactly one delivery");
    assert.deepEqual(ctx.traceActions, ["proactive_send"]);
  });

  it("a not-due rule is untouched", async () => {
    const ctx = makeCtx();
    await makeDaily(ctx, 13); // 13:00 — not due at 12:00
    await checkDueInitiatives(ctx.deps, NOW);
    assert.equal(ctx.cancelled.length, 0);
    assert.equal(threadMessages(ctx, "threadA").length, 1);
  });
});

describe("handleInitiativeTap", () => {
  it("delivers exactly once; second tap returns null", async () => {
    const ctx = makeCtx();
    const rule = await makeDaily(ctx, 8);
    const slot = Date.UTC(2026, 9, 5, 0, 0, 0); // 8:00 Shanghai
    const first = await handleInitiativeTap(ctx.deps, rule.id, slot);
    assert.ok(first);
    assert.ok(first.fired);
    assert.equal(first.threadId, "threadA");

    const second = await handleInitiativeTap(ctx.deps, rule.id, slot);
    assert.equal(second, null);
    assert.equal(threadMessages(ctx, "threadA").length, 2, "no duplicate delivery");
  });

  it("unknown rule returns a failed outcome, not a throw", async () => {
    const ctx = makeCtx();
    const r = await handleInitiativeTap(ctx.deps, "nope", NOW);
    assert.deepEqual(r, { fired: false });
  });

  it("a tap on an EXPIRED slot still delivers (tap is not grace-limited, P1-1)", async () => {
    const ctx = makeCtx("granted", () => NOW - 2 * 86_400_000);
    const rule = await makeDaily(ctx, 8);
    const slot = Date.UTC(2026, 9, 5, 0, 0, 0); // 8:00 Shanghai
    assert.ok(isSlotExpired(slot, NOW), "4 hours stale — the tick would skip this");
    // She taps the notification herself at 12:00: the promised message
    // is delivered — a tap is the delivery she asked for, not a backfill.
    const first = await handleInitiativeTap(ctx.deps, rule.id, slot);
    assert.ok(first);
    assert.ok(first.fired);
    const msgs = threadMessages(ctx, "threadA");
    assert.equal(msgs[msgs.length - 1].content, "想你了，过来抱一下");
    assert.equal(await handleInitiativeTap(ctx.deps, rule.id, slot), null, "no double tap");
  });
});

describe("e2e-ish: rule -> notification -> tap -> message in dialog", () => {
  it("the whole loop works with real storage bytes", async () => {
    const ctx = makeCtx();
    // 1. She creates a rule (via UI or AI tool).
    const rule = await makeDaily(ctx, 13);
    // 2. The rule is armed: a template notification is pre-scheduled.
    await ensureScheduled(ctx.deps, rule, NOW);
    assert.equal(ctx.scheduled.length, 1);
    const data = ctx.scheduled[0].content.data as Record<string, string>;
    assert.equal(data.kind, "initiative");

    // 3. App was backgrounded at fire time; she taps the notification.
    //    Simulate the tap with the slot from the notification payload.
    const slotTime = Number(data.slotTime);
    const tapped = await handleInitiativeTap(ctx.deps, data.ruleId, slotTime);
    assert.ok(tapped?.fired, "tap delivers the promised message");

    // 4. The AI-generated message is really in the dialog; trace written.
    const msgs = threadMessages(ctx, "threadA");
    assert.equal(msgs[msgs.length - 1].content, "想你了，过来抱一下");
    assert.deepEqual(ctx.traceActions, ["proactive_send"]);

    // 5. Slot consumed: a replayed tap does nothing.
    assert.equal(await handleInitiativeTap(ctx.deps, data.ruleId, slotTime), null);
  });
});
