/**
 * Harness Phase 1 — session log: append-only ordering, replay derivation,
 * fork, and usage stats. All against the in-memory backend (the SQLite
 * backend shares the same interface; its SQL is exercised on-device).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createMemorySessionLogBackend,
  createSessionLog,
  logPayload,
} from "../src/harness/session-log.js";

function makeLog() {
  return createSessionLog(createMemorySessionLogBackend());
}

describe("session log: append-only ordering", () => {
  it("assigns increasing seq numbers in append order", async () => {
    const log = makeLog();
    const s1 = await log.append({ sessionId: "s1", type: "turn/start", payload: "{}" });
    const s2 = await log.append({
      sessionId: "s1",
      type: "user/message",
      payload: logPayload.userMessage("hi"),
    });
    assert.equal(s2, s1 + 1);
    const events = await log.readSession("s1");
    assert.deepEqual(
      events.map((e) => e.type),
      ["turn/start", "user/message"],
    );
  });

  it("reads are isolated per session", async () => {
    const log = makeLog();
    await log.append({ sessionId: "a", type: "turn/start", payload: "{}" });
    await log.append({ sessionId: "b", type: "turn/start", payload: "{}" });
    assert.equal((await log.readSession("a")).length, 1);
    assert.equal((await log.readSession("b")).length, 1);
  });

  it("read supports fromSeq (incremental tail)", async () => {
    const log = makeLog();
    await log.append({ sessionId: "s", type: "turn/start", payload: "{}" });
    const s2 = await log.append({ sessionId: "s", type: "user/message", payload: "{}" });
    await log.append({ sessionId: "s", type: "turn/end", payload: "{}" });
    const tail = await log.readSession("s", s2);
    assert.deepEqual(
      tail.map((e) => e.type),
      ["user/message", "turn/end"],
    );
  });
});

describe("session log: deriveMessages (resume/replay from the same log)", () => {
  it("replays a full turn: user → assistant(tool_calls) → tool → assistant", async () => {
    const log = makeLog();
    const sid = "replay-1";
    await log.append({ sessionId: sid, type: "turn/start", payload: "{}" });
    await log.append({
      sessionId: sid,
      type: "user/message",
      payload: logPayload.userMessage("what time is it"),
    });
    await log.append({
      sessionId: sid,
      type: "assistant/message",
      payload: logPayload.assistantMessage({
        text: "",
        toolCalls: [{ id: "c1", name: "get_time", args: "{}" }],
      }),
    });
    await log.append({
      sessionId: sid,
      type: "tool/call",
      payload: logPayload.toolCall({ toolCallId: "c1", name: "get_time", args: "{}" }),
    });
    await log.append({
      sessionId: sid,
      type: "tool/result",
      payload: logPayload.toolResult({ toolCallId: "c1", result: "12:00", isError: false }),
    });
    await log.append({
      sessionId: sid,
      type: "assistant/message",
      payload: logPayload.assistantMessage({ text: "It's 12:00." }),
    });
    const msgs = log.deriveMessages(await log.readSession(sid));
    assert.equal(msgs.length, 4);
    assert.equal(msgs[0].role, "user");
    assert.equal(msgs[0].content, "what time is it");
    assert.equal(msgs[1].role, "assistant");
    assert.deepEqual(msgs[1].toolCalls, [{ id: "c1", name: "get_time", args: "{}" }]);
    assert.equal(msgs[2].role, "tool");
    assert.equal(msgs[2].content, "12:00");
    assert.equal(msgs[2].toolCallId, "c1");
    assert.equal(msgs[3].role, "assistant");
    assert.equal(msgs[3].content, "It's 12:00.");
  });

  it("skips corrupt payloads instead of breaking replay", async () => {
    const log = makeLog();
    await log.append({ sessionId: "s", type: "user/message", payload: "not-json{{{" });
    await log.append({
      sessionId: "s",
      type: "user/message",
      payload: logPayload.userMessage("ok"),
    });
    const msgs = log.deriveMessages(await log.readSession("s"));
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].content, "ok");
  });
});

describe("session log: fork", () => {
  it("forks a prefix of the log into a new session, source untouched", async () => {
    const log = makeLog();
    await log.append({ sessionId: "src", type: "turn/start", payload: "{}" });
    const s2 = await log.append({
      sessionId: "src",
      type: "user/message",
      payload: logPayload.userMessage("one"),
    });
    await log.append({
      sessionId: "src",
      type: "user/message",
      payload: logPayload.userMessage("two"),
    });
    await log.fork("src", s2, "dst");
    const dst = await log.readSession("dst");
    assert.deepEqual(
      dst.map((e) => e.type),
      ["turn/start", "user/message"],
    );
    assert.equal(dst[1].sessionId, "dst");
    // Source untouched.
    assert.equal((await log.readSession("src")).length, 3);
  });
});

describe("session log: usage stats derive from the log itself", () => {
  it("counts turns, steps, tool calls (per tool), messages", async () => {
    const log = makeLog();
    const sid = "stats-1";
    await log.append({ sessionId: sid, type: "turn/start", payload: "{}" });
    await log.append({
      sessionId: sid,
      type: "user/message",
      payload: logPayload.userMessage("hi"),
    });
    await log.append({
      sessionId: sid,
      type: "step/start",
      payload: logPayload.stepStart({ iteration: 0 }),
    });
    await log.append({
      sessionId: sid,
      type: "tool/call",
      payload: logPayload.toolCall({ toolCallId: "c1", name: "a", args: "{}" }),
    });
    await log.append({
      sessionId: sid,
      type: "tool/call",
      payload: logPayload.toolCall({ toolCallId: "c2", name: "b", args: "{}" }),
    });
    await log.append({
      sessionId: sid,
      type: "assistant/message",
      payload: logPayload.assistantMessage({ text: "done" }),
    });
    await log.append({ sessionId: sid, type: "turn/end", payload: "{}" });
    const stats = await log.getUsageStats(sid);
    assert.equal(stats.turns, 1);
    assert.equal(stats.steps, 1);
    assert.equal(stats.toolCalls, 2);
    assert.deepEqual(stats.byTool, { a: 1, b: 1 });
    assert.equal(stats.userMessages, 1);
    assert.equal(stats.assistantMessages, 1);
  });
});

describe("session log: payload builders never carry secrets", () => {
  it("request/header has no key/header fields", () => {
    const p = JSON.parse(
      logPayload.requestHeader({
        model: "m",
        endpoint: "https://x.test",
        toolCount: 3,
        wireMessages: 5,
      }),
    );
    assert.deepEqual(Object.keys(p).sort(), ["endpoint", "model", "toolCount", "wireMessages"]);
  });
});
