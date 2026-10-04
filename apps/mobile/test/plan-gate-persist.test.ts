/**
 * P1-9 regression: plan-gated meetings were permanently stuck after app
 * restart because approved plans lived only in a module-level Map.
 * Plans are now persisted; a "fresh" store hydrates them back.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type CoordinationPlan,
  createPlanGateStore,
  isValidPlan,
  type PlanGatePersistence,
} from "../src/api-groups/plan-gate.js";

function fakePersistence(): PlanGatePersistence & { saved: CoordinationPlan[][] } {
  const saved: CoordinationPlan[][] = [];
  let stored: CoordinationPlan[] = [];
  return {
    saved,
    load: async () => stored.map((p) => ({ ...p })),
    save: async (plans) => {
      saved.push(plans);
      stored = plans.map((p) => ({ ...p }));
    },
  };
}

const input = {
  title: "开会讨论晚饭",
  reason: "她说你们讨论一下",
  steps: [{ title: "每人说一个方案" }],
};

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 10));
}

describe("plan-gate persistence (P1-9)", () => {
  it("approved plans survive a restart via hydrate", async () => {
    const persistence = fakePersistence();
    const before = createPlanGateStore(persistence);
    const plan = before.propose("thread-1", input);
    before.decide(plan.id, true);
    await flush();

    // Simulate an app restart: a brand-new store hydrating from storage.
    const after = createPlanGateStore(persistence);
    assert.equal(after.getPlan(plan.id), null, "not loaded before hydrate");
    await after.hydrate();
    const restored = after.getPlan(plan.id);
    assert.ok(restored, "approved plan restored after restart");
    assert.equal(restored.status, "approved");
    assert.equal(restored.threadId, "thread-1");
    assert.equal(restored.title, input.title);
  });

  it("pending proposals also persist (her card reappears after restart)", async () => {
    const persistence = fakePersistence();
    const before = createPlanGateStore(persistence);
    const plan = before.propose("thread-2", input);
    await flush();

    const after = createPlanGateStore(persistence);
    await after.hydrate();
    const active = after.activePlanFor("thread-2");
    assert.ok(active, "proposed plan restored");
    assert.equal(active.id, plan.id);
  });

  it("corrupt persisted rows are dropped, never crash", async () => {
    const raw = [
      { id: "good", threadId: "t", title: "ok", status: "approved", createdAt: 1, steps: [] },
      { id: 42, title: null },
      "not-an-object",
      null,
    ];
    const store = createPlanGateStore({
      load: async () => raw as unknown as CoordinationPlan[],
      save: async () => {},
    });
    await store.hydrate();
    assert.ok(store.getPlan("good"), "valid row kept");
    assert.equal(store.getPlan("42" as string), null);
  });

  it("isValidPlan rejects malformed rows", () => {
    assert.equal(isValidPlan(null), false);
    assert.equal(isValidPlan({}), false);
    assert.equal(
      isValidPlan({
        id: "x",
        threadId: "t",
        title: "x",
        status: "bogus",
        createdAt: 1,
        steps: [],
      }),
      false,
    );
    assert.equal(
      isValidPlan({
        id: "x",
        threadId: "t",
        title: "x",
        status: "approved",
        createdAt: 1,
        steps: [],
      }),
      true,
    );
  });

  it("failed saves do not break the chain (later saves still land)", async () => {
    let failNext = true;
    const saved: CoordinationPlan[][] = [];
    const persistence: PlanGatePersistence = {
      load: async () => [],
      save: async (plans) => {
        if (failNext) {
          failNext = false;
          throw new Error("disk full");
        }
        saved.push(plans);
      },
    };
    const store = createPlanGateStore(persistence);
    store.propose("t", input);
    await flush();
    assert.equal(store.saveFailed(), true, "save failure surfaced");
    store.propose("t2", input);
    await flush();
    assert.equal(store.saveFailed(), false, "chain survived, later save succeeded");
    assert.equal(saved.length, 1);
    assert.equal(saved[0].length, 2, "latest state persisted, not a stale one");
  });

  it("decide persists the approval", async () => {
    const persistence = fakePersistence();
    const store = createPlanGateStore(persistence);
    const plan = store.propose("t", input);
    store.decide(plan.id, true);
    await flush();
    const last = persistence.saved[persistence.saved.length - 1];
    assert.equal(last.find((p) => p.id === plan.id)?.status, "approved");
  });

  it("a plan proposed while hydrate is in flight survives (P2-5)", async () => {
    let resolveLoad!: (plans: CoordinationPlan[]) => void;
    const hangingLoad = new Promise<CoordinationPlan[]>((r) => {
      resolveLoad = r;
    });
    const persistence = fakePersistence();
    persistence.load = () => hangingLoad;
    const store = createPlanGateStore(persistence);
    const hydrating = store.hydrate(); // load() now pending
    const plan = store.propose("t-race", input); // lands mid-load
    resolveLoad([]); // stored snapshot predates the proposal
    await hydrating;
    const got = store.getPlan(plan.id);
    assert.ok(got, "in-flight proposal survives hydrate");
    assert.equal(got.title, input.title);
    assert.equal(got.status, "proposed");
  });
});
