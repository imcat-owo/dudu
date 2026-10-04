/**
 * send_to_dialog plan_id mechanical verification
 * (audit round 2, AI-use P1-3): a cited plan id must exist AND be approved.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { planGateStore } from "../src/api-groups/plan-gate.js";
import { type CrossDialogStorage, createCrossDialogTools } from "../src/chat/cross-dialog.js";
import {
  type CrossDialogTraceStorage,
  CrossDialogTraceStore,
  CrossDialogVisibilityStore,
} from "../src/chat/cross-dialog-trace.js";

type FakeStorage = CrossDialogStorage & CrossDialogTraceStorage & { __map: Map<string, string> };

function fakeStorage(): FakeStorage {
  const map = new Map<string, string>();
  return {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v);
    },
    getAllKeys: async () => [...map.keys()],
    __map: map,
  };
}

function toolOpts(storage: CrossDialogStorage, threadId = "current") {
  return {
    storage,
    threadId,
    trace: new CrossDialogTraceStore(storage),
    visibility: new CrossDialogVisibilityStore(storage),
    isIncognito: undefined as undefined | (() => boolean),
  };
}

function seedDialog(storage: FakeStorage, threadId: string, name: string) {
  storage.__map.set(
    `dudu.local-chat.${threadId}.v1`,
    JSON.stringify([{ id: "m0", role: "user", content: "hi" }]),
  );
  storage.__map.set(
    "dudu.dialog-registry.v1",
    JSON.stringify({ [threadId]: { name, personaId: "default" } }),
  );
}

async function sendReason(storage: FakeStorage, reason: string): Promise<string> {
  const tools = createCrossDialogTools(toolOpts(storage));
  const send = tools.find((t) => t.name === "send_to_dialog");
  assert.ok(send, "send_to_dialog exists");
  return send.run({ dialog: "target", message: "hello there", reason }, {} as never);
}

describe("send_to_dialog plan verification (P1-3)", () => {
  beforeEach(() => {
    planGateStore.__resetForTests();
  });

  it("refuses a fabricated plan id", async () => {
    const s = fakeStorage();
    seedDialog(s, "target", "目标对话");
    await assert.rejects(
      () => sendReason(s, "plan_zzzzzz_zzzzz approved by her"),
      /不存在/,
      "fabricated plan id is refused",
    );
  });

  it("refuses a real but unapproved plan", async () => {
    const s = fakeStorage();
    seedDialog(s, "target", "目标对话");
    const plan = planGateStore.propose("current", {
      title: "t",
      reason: "r",
      steps: [{ title: "s1" }],
    });
    await assert.rejects(
      () => sendReason(s, `按计划 ${plan.id} 发送`),
      /还没被批准/,
      "proposed-but-not-approved plan is refused",
    );
  });

  it("allows the send once the plan is approved", async () => {
    const s = fakeStorage();
    seedDialog(s, "target", "目标对话");
    const plan = planGateStore.propose("current", {
      title: "t",
      reason: "r",
      steps: [{ title: "s1" }],
    });
    planGateStore.decide(plan.id, true);
    const out = await sendReason(s, `按计划 ${plan.id} 发送`);
    assert.ok(out.includes("Delivered"), "approved plan lets the send through");
  });

  it("still allows her explicit request with no plan id", async () => {
    const s = fakeStorage();
    seedDialog(s, "target", "目标对话");
    const out = await sendReason(s, "她说：跟目标对话说一声晚上一起听歌");
    assert.ok(out.includes("Delivered"), "plain her-request reason still works");
  });
});
