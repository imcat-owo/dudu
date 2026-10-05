/**
 * Harness Phase 1 — agent-loop hooks: pre-step rewrite/reject,
 * tools/pre-execute deny-wins (fail closed), tools/post-execute notes +
 * isolation, unsubscribe.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAgentHooks } from "../src/harness/hooks.js";
import type { HarnessTool } from "../src/harness/tool-registry.js";

function fakeTool(name = "t"): HarnessTool {
  return {
    name,
    description: "d",
    parameters: { type: "object", properties: {} },
    needsApproval: false,
    run: async () => "ok",
  };
}

const ctx = { authorize: async () => true };

describe("hooks: pre-step", () => {
  it("no hooks → wire passes through", async () => {
    const h = createAgentHooks();
    const wire = [{ role: "user", content: "hi" }];
    const r = await h.runPreStep({ wire, stepIndex: 0 });
    assert.ok("wire" in r && r.wire === wire);
  });

  it("a hook can rewrite the wire", async () => {
    const h = createAgentHooks();
    h.on("pre-step", () => ({ rewriteWire: [{ role: "user", content: "rewritten" }] }));
    const r = await h.runPreStep({ wire: [{ role: "user", content: "hi" }], stepIndex: 0 });
    assert.ok("wire" in r && r.wire[0].content === "rewritten");
  });

  it("first reject wins with an honest reason", async () => {
    const h = createAgentHooks();
    h.on("pre-step", () => ({ reject: "nope: policy" }));
    h.on("pre-step", () => ({ reject: "second" }));
    const r = await h.runPreStep({ wire: [], stepIndex: 0 });
    assert.ok("rejected" in r && r.rejected === "nope: policy");
  });

  it("a throwing pre-step hook fails the step closed", async () => {
    const h = createAgentHooks();
    h.on("pre-step", () => {
      throw new Error("boom");
    });
    const r = await h.runPreStep({ wire: [], stepIndex: 0 });
    assert.ok("rejected" in r && /pre-step hook failed/.test(r.rejected));
  });
});

describe("hooks: tools/pre-execute (approval checkpoint)", () => {
  function preInput(name = "t") {
    return { tool: fakeTool(name), args: {}, ctx, approvals: new Map<string, boolean>() };
  }

  it("no hooks → allow", async () => {
    const h = createAgentHooks();
    assert.deepEqual(await h.runToolsPreExecute(preInput()), { allow: true });
  });

  it("first deny wins; reason is honest", async () => {
    const h = createAgentHooks();
    h.on("tools/pre-execute", () => ({ allow: false, reason: "she said no" }));
    h.on("tools/pre-execute", () => ({ allow: true }));
    const r = await h.runToolsPreExecute(preInput());
    assert.equal(r.allow, false);
    assert.equal(r.reason, "she said no");
  });

  it("deny without reason gets a default honest reason", async () => {
    const h = createAgentHooks();
    h.on("tools/pre-execute", () => ({ allow: false }));
    const r = await h.runToolsPreExecute(preInput("mytool"));
    assert.equal(r.allow, false);
    assert.match(r.reason ?? "", /mytool.*blocked by policy/);
  });

  it("a throwing pre-execute hook denies (fail closed)", async () => {
    const h = createAgentHooks();
    h.on("tools/pre-execute", () => {
      throw new Error("boom");
    });
    const r = await h.runToolsPreExecute(preInput());
    assert.equal(r.allow, false);
    assert.match(r.reason ?? "", /pre-execute hook failed/);
  });
});

describe("hooks: tools/post-execute", () => {
  it("collects notes in registration order", async () => {
    const h = createAgentHooks();
    h.on("tools/post-execute", () => ({ note: "first" }));
    h.on("tools/post-execute", () => undefined);
    h.on("tools/post-execute", () => ({ note: "second" }));
    const r = await h.runToolsPostExecute({
      tool: fakeTool(),
      args: {},
      result: "ok",
      failed: true,
      ctx,
    });
    assert.deepEqual(r.notes, ["first", "second"]);
  });

  it("one throwing hook does not kill the others", async () => {
    const h = createAgentHooks();
    h.on("tools/post-execute", () => {
      throw new Error("boom");
    });
    h.on("tools/post-execute", () => ({ note: "survived" }));
    const r = await h.runToolsPostExecute({
      tool: fakeTool(),
      args: {},
      result: "ok",
      failed: false,
      ctx,
    });
    assert.deepEqual(r.notes, ["survived"]);
  });

  it("unsubscribe removes the hook", async () => {
    const h = createAgentHooks();
    const off = h.on("tools/pre-execute", () => ({ allow: false, reason: "x" }));
    off();
    const r = await h.runToolsPreExecute({
      tool: fakeTool(),
      args: {},
      ctx,
      approvals: new Map(),
    });
    assert.equal(r.allow, true);
  });
});
