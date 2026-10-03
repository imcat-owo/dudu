import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { messageToolActions, toolCallToAction } from "../src/activity-drawer-model.js";

function aguiCall(over: Record<string, unknown> = {}) {
  return {
    id: "call_1",
    type: "function",
    function: {
      name: "read_file",
      arguments: JSON.stringify({ path: "/tmp/a.txt", limit: 300 }),
    },
    ...over,
  };
}

function aguiMessage(over: Record<string, unknown> = {}) {
  return {
    id: "msg_tool_1",
    role: "tool",
    toolCallId: "call_1",
    content: "file contents here",
    ...over,
  };
}

describe("toolCallToAction", () => {
  it("maps a completed call: name, named inputs, done status, full output", () => {
    const a = toolCallToAction(aguiCall(), aguiMessage());
    assert.equal(a.kind, "tool");
    assert.equal(a.id, "call_1");
    assert.equal(a.title, "read_file");
    assert.equal(a.status, "done");
    assert.deepEqual(a.inputs, [
      { name: "path", value: "/tmp/a.txt" },
      { name: "limit", value: "300" },
    ]);
    assert.equal(a.output, "file contents here");
  });

  it("marks running when there is no result message yet", () => {
    const a = toolCallToAction(aguiCall(), undefined);
    assert.equal(a.status, "running");
    assert.equal(a.output, "");
    // inputs are known even while running
    assert.equal(a.inputs.length, 2);
  });

  it("marks error when the result message carries an error", () => {
    const a = toolCallToAction(aguiCall(), aguiMessage({ error: "boom" }));
    assert.equal(a.status, "error");
    assert.equal(a.output, "file contents here");
  });

  it("keeps raw arguments when they are not JSON (never throws)", () => {
    const raw = "not-json-at-all";
    const a = toolCallToAction(aguiCall({ function: { name: "x", arguments: raw } }), undefined);
    assert.deepEqual(a.inputs, [{ name: "arguments", value: raw }]);
  });

  it("handles non-object JSON arguments as a single value", () => {
    const a = toolCallToAction(
      aguiCall({ function: { name: "x", arguments: "[1,2]" } }),
      undefined,
    );
    assert.deepEqual(a.inputs, [{ name: "value", value: "[1,2]" }]);
  });

  it("never throws on garbage input", () => {
    for (const bad of [null, undefined, 42, "str", {}, []]) {
      const a = toolCallToAction(bad, bad);
      assert.equal(a.kind, "tool");
      assert.equal(a.status, "running");
    }
  });
});

describe("messageToolActions", () => {
  it("pairs each call with its result message by toolCallId", () => {
    const msg = {
      id: "asst_1",
      role: "assistant",
      toolCalls: [
        aguiCall(),
        aguiCall({ id: "call_2", function: { name: "ls", arguments: "{}" } }),
      ],
    };
    const all = [
      msg,
      aguiMessage(),
      aguiMessage({ id: "msg_tool_2", toolCallId: "call_2", content: "out2" }),
    ];
    const actions = messageToolActions(msg, all);
    assert.equal(actions.length, 2);
    assert.equal(actions[0].status, "done");
    assert.equal(actions[1].title, "ls");
    assert.equal(actions[1].output, "out2");
  });

  it("returns [] for messages without toolCalls", () => {
    assert.deepEqual(messageToolActions({ id: "x" }, []), []);
    assert.deepEqual(messageToolActions(null, []), []);
  });
});
