/**
 * D25: delegate_task's allowedTools actually reaches the sub-agent.
 *
 * - resolveSubagentTools: an explicit list selects exactly those tools
 *   (unknown names throw — a misspelled name is a gap, not a silent drop);
 *   omitted = the default set (everything except delegate_task + ask_user).
 * - delegate_task run() forwards allowedTools to deps.runSubtask.
 * - generateOneShot with tools runs the agentic loop: the model receives the
 *   tool definitions, its tool_calls execute, results feed back as
 *   role:"tool" messages, and the final text is returned. fetch is stubbed —
 *   no network.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LocalTool } from "../src/api-groups/local-tools.js";
import type { ApiGroup } from "../src/api-groups/types.js";
import { generateOneShot, type OneShotTool } from "../src/chat/group-meeting-tools.js";
import { createDelegateTools, resolveSubagentTools } from "../src/mcp/delegate.js";

function fakeTool(name: string): LocalTool {
  return {
    name,
    description: `${name} description`,
    parameters: { type: "object", properties: {} },
    run: async () => `ok:${name}`,
  };
}

const ALL = [
  "get_current_time",
  "web_search",
  "read_manual",
  "delegate_task",
  "ask_user",
  "sandbox_run",
].map(fakeTool);

describe("resolveSubagentTools", () => {
  it("explicit allowedTools selects exactly those tools", () => {
    const out = resolveSubagentTools(ALL, ["web_search", "get_current_time"]);
    assert.deepEqual(
      out.map((t) => t.name),
      ["web_search", "get_current_time"],
    );
  });

  it("unknown tool names throw instead of silently dropping", () => {
    assert.throws(
      () => resolveSubagentTools(ALL, ["web_search", "nope_not_a_tool"]),
      /unknown tool "nope_not_a_tool"/,
    );
  });

  it("omitted allowedTools = default set (no delegate_task, no ask_user)", () => {
    const names = resolveSubagentTools(ALL).map((t) => t.name);
    assert.ok(!names.includes("delegate_task"), "default set must not recurse");
    assert.ok(!names.includes("ask_user"), "default set must not ask her directly");
    for (const want of ["web_search", "get_current_time", "read_manual", "sandbox_run"]) {
      assert.ok(names.includes(want), `default set should include ${want}`);
    }
  });

  it("empty array behaves like omitted (default set)", () => {
    const names = resolveSubagentTools(ALL, []).map((t) => t.name);
    assert.ok(!names.includes("delegate_task"));
    assert.ok(!names.includes("ask_user"));
  });
});

describe("delegate_task forwards allowedTools", () => {
  it("runSubtask receives (task, allowedTools)", async () => {
    const seen: Array<{ task: string; allowed?: string[] }> = [];
    const [tool] = createDelegateTools({
      runSubtask: async (task, allowedTools) => {
        seen.push({ task, allowed: allowedTools });
        return "done";
      },
    });
    const out = await tool.run({ task: "do research", allowedTools: ["web_search"] }, {} as never);
    assert.equal(out, "done");
    assert.equal(seen.length, 1);
    assert.equal(seen[0].task, "do research");
    assert.deepEqual(seen[0].allowed, ["web_search"]);
  });

  it("omitted allowedTools forwards undefined", async () => {
    let seenAllowed: string[] | undefined | "unset" = "unset";
    const [tool] = createDelegateTools({
      runSubtask: async (_task, allowedTools) => {
        seenAllowed = allowedTools;
        return "done";
      },
    });
    await tool.run({ task: "think" }, {} as never);
    assert.equal(seenAllowed, undefined);
  });
});

describe("generateOneShot agentic loop (D25)", () => {
  const group = { baseUrl: "https://example.com/v1", model: "test-model" } as ApiGroup;
  const realFetch = globalThis.fetch;

  function stubFetch(responses: unknown[]): unknown[] {
    const calls: unknown[] = [];
    let i = 0;
    globalThis.fetch = (async (_url: unknown, init: unknown) => {
      calls.push(JSON.parse(String((init as { body: string }).body)));
      const payload = responses[Math.min(i++, responses.length - 1)];
      return { ok: true, json: async () => payload, text: async () => "" };
    }) as typeof fetch;
    return calls;
  }

  it("no tools = old behavior (bare call, text returned, no tools field)", async () => {
    const calls = stubFetch([{ choices: [{ message: { content: "hello" } }] }]);
    try {
      const out = await generateOneShot(group, "sys", "hi");
      assert.equal(out, "hello");
      assert.equal(calls.length, 1);
      assert.ok(!("tools" in (calls[0] as Record<string, unknown>)));
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("with tools: the model gets definitions, tool_calls execute, results feed back", async () => {
    let toolRanWith: unknown = null;
    const tools: OneShotTool[] = [
      {
        name: "web_search",
        description: "search the web",
        parameters: { type: "object", properties: { query: { type: "string" } } },
        run: async (args) => {
          toolRanWith = args;
          return "result: cats";
        },
      },
    ];
    const calls = stubFetch([
      {
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id: "c1",
                  type: "function",
                  function: { name: "web_search", arguments: '{"query":"cats"}' },
                },
              ],
            },
          },
        ],
      },
      { choices: [{ message: { content: "Cats are great." } }] },
    ]);
    try {
      const out = await generateOneShot(group, "sys", "tell me about cats", { tools });
      assert.equal(out, "Cats are great.");
      // The tool actually ran with the model's arguments...
      assert.deepEqual(toolRanWith, { query: "cats" });
      assert.equal(calls.length, 2);
      // ...the model received the tool definition...
      const first = calls[0] as { tools: Array<{ function: { name: string } }> };
      assert.equal(first.tools[0].function.name, "web_search");
      // ...and the tool result fed back as a role:"tool" message.
      const second = calls[1] as { messages: Array<{ role: string; content: string }> };
      const toolMsg = second.messages.find((m) => m.role === "tool");
      assert.ok(toolMsg, "expected a role:tool message");
      assert.ok(toolMsg.content.includes("result: cats"));
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("tool errors become tool messages the model sees (never silent)", async () => {
    const tools: OneShotTool[] = [
      {
        name: "boom",
        description: "fails",
        parameters: { type: "object", properties: {} },
        run: async () => {
          throw new Error("kaboom");
        },
      },
    ];
    const calls = stubFetch([
      {
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                { id: "c1", type: "function", function: { name: "boom", arguments: "{}" } },
              ],
            },
          },
        ],
      },
      { choices: [{ message: { content: "recovered" } }] },
    ]);
    try {
      const out = await generateOneShot(group, "sys", "go", { tools });
      assert.equal(out, "recovered");
      const second = calls[1] as { messages: Array<{ role: string; content: string }> };
      assert.ok(
        second.messages.some((m) => m.role === "tool" && m.content.includes("kaboom")),
        "tool error must reach the model as a tool message",
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("loop cap terminates runaway tool calling", async () => {
    const tools: OneShotTool[] = [
      {
        name: "loop",
        description: "loops",
        parameters: { type: "object", properties: {} },
        run: async () => "again",
      },
    ];
    const toolCall = {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              { id: "c1", type: "function", function: { name: "loop", arguments: "{}" } },
            ],
          },
        },
      ],
    };
    const calls = stubFetch([toolCall]); // the model never stops calling
    try {
      await assert.rejects(
        () => generateOneShot(group, "sys", "go", { tools, maxToolIterations: 2 }),
        /empty reply/,
      );
      assert.equal(calls.length, 3, "initial + 2 iterations, then the cap stops it");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
