/**
 * Harness Phase 1 — end-to-end proof through the real wiring.
 *
 * Drives one agent turn through createAgentHarness + the harness
 * registry + hooks + an in-memory session log (the same pieces
 * local-agent.ts wires together), with a fake model and fake tools.
 * Asserts the session log contains the full turn in order:
 *   user/message → step/start → request/header → tool/call →
 *   tool/result → assistant/message
 * ("model-visible means logged"), plus: incognito pre-execute deny,
 * the authorize cache (no double-prompt), and the manual note on failure.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createMemorySessionLogBackend,
  createSessionLog,
  logPayload,
} from "../src/harness/session-log.js";
import { createHarnessRegistry, type HarnessTool } from "../src/harness/tool-registry.js";
import { createAgentHarness } from "../src/harness/wiring.js";

function fakeTool(
  name: string,
  run: HarnessTool["run"],
  extra: Partial<HarnessTool> = {},
): HarnessTool {
  return {
    name,
    description: `${name} tool`,
    parameters: { type: "object", properties: {} },
    needsApproval: false,
    manualId: "test-manual",
    run,
    ...extra,
  };
}

const toolCtx = { authorize: async () => true };

async function driveTurn(opts: {
  incognito: boolean;
  toolName: string;
  toolRun: HarnessTool["run"];
  failNoteManualId?: string;
}) {
  const log = createSessionLog(createMemorySessionLogBackend());
  const registry = createHarnessRegistry();
  const harness = createAgentHarness({
    sessionId: "e2e-thread",
    isIncognito: () => opts.incognito,
    isToolBlocked: (n) => n === "write_secret",
    incognitoRefusal: (n) => `REFUSED:${n}`,
    getManualNote: (id) => (id === opts.failNoteManualId ? "NOTE: read the manual" : null),
    getLog: async () => log,
  });
  const readManuals = new Set<string>();
  const turn = harness.beginTurn({
    readManuals,
    findTool: (n) => registry.resolve(n) ?? undefined,
  });

  // turn/start + user/message (what local-agent does at runTurn start).
  turn.logEvent("turn/start", logPayload.turnStart({ model: "m", backend: "b" }));
  turn.logEvent("user/message", logPayload.userMessage("do the thing"));

  // One step: pre-step hook, step/start, request/header.
  const stepId = "step_1";
  turn.setStepId(stepId);
  const preStep = await harness.hooks.runPreStep({
    wire: [{ role: "user", content: "do the thing" }],
    stepIndex: 0,
  });
  assert.ok("wire" in preStep);
  turn.logEvent("step/start", logPayload.stepStart({ iteration: 0 }), stepId);
  turn.logEvent(
    "request/header",
    logPayload.requestHeader({
      model: "m",
      endpoint: "https://x.test",
      toolCount: 1,
      wireMessages: 2,
    }),
    stepId,
  );

  // The fake model returns one tool call.
  const tool = fakeTool(opts.toolName, opts.toolRun);
  registry.register(tool);
  const tc = { id: "call_1", name: opts.toolName, args: "{}" };
  turn.setToolCallId(tc.id);
  const args = JSON.parse(tc.args) as Record<string, unknown>;

  const pre = await harness.hooks.runToolsPreExecute({
    tool,
    args,
    ctx: toolCtx,
    approvals: turn.approvals,
  });
  let result: string;
  let failed = false;
  if (!pre.allow) {
    result = `Error: ${pre.reason}`;
  } else {
    try {
      result = await registry.execute(tc.name, args, turn.wrapContext(toolCtx, tc.name));
    } catch (e) {
      failed = true;
      result = `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  const { notes } = await harness.hooks.runToolsPostExecute({
    tool,
    args,
    result,
    failed,
    ctx: toolCtx,
  });
  for (const n of notes) result += `\n${n}`;
  turn.setToolCallId(undefined);

  // assistant/message + step/end + turn/end.
  turn.logEvent("assistant/message", logPayload.assistantMessage({ text: "done" }), stepId);
  turn.logEvent("step/end", JSON.stringify({}), stepId);
  turn.setStepId(undefined);
  turn.logEvent("turn/end", JSON.stringify({}));

  // Flush the fire-and-forget appends.
  await new Promise((r) => setTimeout(r, 50));
  return { log, result, turn };
}

describe("harness e2e: one full turn lands in the session log in order", () => {
  it("user/message → step/start → request/header → tool/call → tool/result → assistant/message", async () => {
    const { log, result } = await driveTurn({
      incognito: false,
      toolName: "get_time",
      toolRun: async () => "12:00",
    });
    assert.equal(result, "12:00");
    const types = (await log.readSession("e2e-thread")).map((e) => e.type);
    assert.deepEqual(types, [
      "turn/start",
      "user/message",
      "step/start",
      "request/header",
      "tool/call",
      "tool/result",
      "assistant/message",
      "step/end",
      "turn/end",
    ]);
    // The tool call/result pair carries the real payload.
    const events = await log.readSession("e2e-thread");
    const call = JSON.parse(events[4].payload) as { name: string; toolCallId: string };
    const res = JSON.parse(events[5].payload) as {
      result: string;
      toolCallId: string;
      isError: boolean;
    };
    assert.equal(call.name, "get_time");
    assert.equal(call.toolCallId, "call_1");
    assert.equal(res.result, "12:00");
    assert.equal(res.toolCallId, "call_1");
    assert.equal(res.isError, false);
    // Replay derives the same conversation back.
    const msgs = log.deriveMessages(events);
    assert.equal(msgs[0].role, "user");
    assert.equal(msgs[msgs.length - 1].content, "done");
  });

  it("a failing tool gets the manual note appended (proactive note system)", async () => {
    const { result } = await driveTurn({
      incognito: false,
      toolName: "flaky",
      toolRun: async () => {
        throw new Error("kaput");
      },
      failNoteManualId: "test-manual",
    });
    assert.match(result, /^Error: kaput/);
    assert.match(result, /NOTE: read the manual/);
  });

  it("incognito pre-execute denies a blocked tool with an honest refusal", async () => {
    const { log, result } = await driveTurn({
      incognito: true,
      toolName: "write_secret",
      toolRun: async () => "should never run",
    });
    assert.match(result, /^Error: REFUSED:write_secret/);
    // Incognito promised zero trace: the denial is model-visible in the
    // reply, but NOTHING lands in the session log (fail-closed).
    const types = (await log.readSession("e2e-thread")).map((e) => e.type);
    assert.deepEqual(types, []);
  });

  it("authorize is cached per tool per turn (no double prompt)", async () => {
    let prompts = 0;
    const log = createSessionLog(createMemorySessionLogBackend());
    const harness = createAgentHarness({
      sessionId: "s",
      isIncognito: () => false,
      isToolBlocked: () => false,
      incognitoRefusal: (n) => n,
      getManualNote: () => null,
      getLog: async () => log,
    });
    const turn = harness.beginTurn({ readManuals: new Set(), findTool: () => undefined });
    const rawCtx = {
      authorize: async () => {
        prompts += 1;
        return true;
      },
    };
    const wrapped = turn.wrapContext(rawCtx, "photos_tool");
    assert.equal(await wrapped.authorize({ capability: "photos", action: "a", reason: "r" }), true);
    assert.equal(await wrapped.authorize({ capability: "photos", action: "a", reason: "r" }), true);
    assert.equal(prompts, 1);
  });
});
