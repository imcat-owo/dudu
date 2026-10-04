/**
 * Plan gate (开启原则) tests — PURE modules.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlanGateStore,
  planGateStore,
  validatePlanInput,
} from "../src/api-groups/plan-gate.js";
import { createPlanTools } from "../src/api-groups/plan-tools.js";

const ctx = {} as never;

function input() {
  return {
    title: "做个视频",
    reason: "单模型做不了：要画图又要配音",
    steps: [
      { title: "画图", detail: "图片分组" },
      { title: "配音", detail: "语音分组" },
    ],
  };
}

test("validatePlanInput rejects incomplete plans", () => {
  assert.equal(validatePlanInput({}), "titleRequired");
  assert.equal(validatePlanInput({ title: "x" }), "reasonRequired");
  assert.equal(validatePlanInput({ title: "x", reason: "y" }), "stepsRequired");
  assert.equal(validatePlanInput({ title: "x", reason: "y", steps: [] }), "stepsRequired");
  assert.equal(
    validatePlanInput({ title: "x", reason: "y", steps: [{ title: "  " }] }),
    "stepsInvalid",
  );
  assert.equal(validatePlanInput({ title: "x", reason: "y", steps: [{ title: "ok" }] }), null);
});

test("propose -> activePlanFor -> decide round trip", () => {
  const store = createPlanGateStore();
  assert.equal(store.activePlanFor("t1"), null);
  const plan = store.propose("t1", input());
  assert.equal(plan.status, "proposed");
  assert.equal(store.activePlanFor("t1")?.id, plan.id);
  assert.equal(store.activePlanFor("other-thread"), null);
  assert.equal(store.decide(plan.id, true), true);
  assert.equal(store.getPlan(plan.id)?.status, "approved");
  assert.equal(store.activePlanFor("t1"), null, "decided plans are no longer active");
  // deciding twice fails
  assert.equal(store.decide(plan.id, false), false);
});

test("new proposal supersedes a pending one in the same thread", () => {
  const store = createPlanGateStore();
  const first = store.propose("t1", input());
  const second = store.propose("t1", { ...input(), title: "新计划" });
  assert.equal(store.getPlan(first.id)?.status, "superseded");
  assert.equal(store.activePlanFor("t1")?.id, second.id);
});

test("check_plan_status reports superseded distinctly (not her rejection)", async () => {
  planGateStore.__resetForTests();
  const [propose, check] = createPlanTools("thread-3");
  const out1 = (await propose.run(
    { title: "旧计划", reason: "r", steps: [{ title: "s1" }] },
    ctx,
  )) as string;
  const oldId = /id: (plan_[a-z0-9_]+)/.exec(out1)?.[1];
  assert.ok(oldId, "tool returns the plan id");
  await propose.run({ title: "新计划", reason: "r", steps: [{ title: "s1" }] }, ctx);
  const report = (await check.run({ plan_id: String(oldId) }, ctx)) as string;
  assert.ok(report.includes("superseded"), "distinct status");
  assert.ok(report.includes("不是她叫停"), "never claims she rejected it");
});

test("decide on unknown plan returns false", () => {
  const store = createPlanGateStore();
  assert.equal(store.decide("nope", true), false);
});

test("propose_coordination_plan tool validates and instructs waiting", async () => {
  planGateStore.__resetForTests();
  const [propose] = createPlanTools("thread-1");
  assert.equal(propose.name, "propose_coordination_plan");
  assert.equal(propose.manualId, "coordination");
  await assert.rejects(() => propose.run({ title: "x" }, ctx), /reason/);
  const out = (await propose.run(
    { title: "计划", reason: "单模型不行", steps: [{ title: "第一步" }] },
    ctx,
  )) as string;
  assert.ok(out.includes("等她"), "tool must tell the AI to wait");
  assert.ok(planGateStore.activePlanFor("thread-1"), "plan stored for the thread");
});

test("check_plan_status reports proposed/approved/rejected honestly", async () => {
  planGateStore.__resetForTests();
  const [propose, check] = createPlanTools("thread-2");
  assert.equal(check.name, "check_plan_status");
  const out = (await propose.run(
    { title: "计划", reason: "需要多模型", steps: [{ title: "s1" }] },
    ctx,
  )) as string;
  const planId = /id: (plan_[a-z0-9_]+)/.exec(out)?.[1];
  assert.ok(planId, "tool returns the plan id");
  const pid = String(planId);
  const waiting = (await check.run({ plan_id: pid }, ctx)) as string;
  assert.ok(waiting.includes("proposed"), "reports waiting state");
  assert.ok(!waiting.includes("approved"), "does not claim approval");
  planGateStore.decide(pid, false);
  const stopped = (await check.run({ plan_id: pid }, ctx)) as string;
  assert.ok(stopped.includes("rejected"), "reports the rejection");
  await assert.rejects(() => check.run({ plan_id: "unknown" }, ctx), /找不到/);
});
