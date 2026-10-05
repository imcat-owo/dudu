/**
 * Batch 4 integration wiring tests.
 *
 * Proves:
 * 1. MCP tool factories produce registered tools (ask_user, web_search,
 *    delegate_task, cross_dialog CLI, terminal tools).
 * 2. ask_user flow: subscribe → request emitted → answer resolves.
 * 3. mcpBackupPayload strips OAuth client secrets from backup.
 * 4. Long-paste threshold logic.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCrossDialogCliTools } from "../src/mcp/agent-cli";
import {
  __pendingAskUserCount,
  answerAskUserRequest,
  createAskUserTools,
  subscribeAskUserRequest,
} from "../src/mcp/ask-user";
import { createDelegateTools } from "../src/mcp/delegate";
import { pastePreview, shouldConvertPaste } from "../src/mcp/long-paste";
import { mcpBackupPayload } from "../src/mcp/store";
import { descOverrideStore } from "../src/mcp/tool-descriptions";
import { createWebSearchTools } from "../src/mcp/web-search";
import { createInteractiveTerminalTools } from "../src/sandbox/interactive-terminal";

describe("Batch 4 wiring", () => {
  it("ask_user tool is registered with correct shape", () => {
    const tools = createAskUserTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, "ask_user");
    assert.ok(tools[0].description.length > 0);
    assert.ok(tools[0].parameters);
  });

  it("ask_user flow: subscribe → answer resolves", async () => {
    const tools = createAskUserTools();
    let seen: unknown = null;
    const unsub = subscribeAskUserRequest((req) => {
      seen = req;
    });
    try {
      const runPromise = tools[0].run(
        {
          questions: [{ id: "q1", question: "Which?", kind: "single", options: ["A", "B"] }],
        },
        {} as never,
      );
      // The request should be pending now.
      assert.equal(__pendingAskUserCount(), 1);
      assert.ok(seen !== null, "subscriber should have seen the request");
      const req = seen as { id: string };
      const ok = answerAskUserRequest(req.id, { q1: "A" });
      assert.equal(ok, true);
      const result = await runPromise;
      const parsed = JSON.parse(result as string);
      assert.deepEqual(parsed.answers, { q1: "A" });
      assert.equal(__pendingAskUserCount(), 0);
    } finally {
      unsub();
    }
  });

  it("web_search tool is registered", () => {
    const tools = createWebSearchTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, "web_search");
  });

  it("delegate_task tool is registered and runs subtask", async () => {
    const tools = createDelegateTools({
      runSubtask: async (prompt) => `done: ${prompt}`,
    });
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, "delegate_task");
    const out = await tools[0].run({ task: "hello" }, {} as never);
    assert.equal(out, "done: hello");
  });

  it("cross_dialog agent CLI tools are registered", () => {
    const tools = createCrossDialogCliTools({
      listDialogs: async () => [],
      readDialog: async () => "",
      searchDialogs: async () => [],
    });
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, "cross_dialog");
  });

  it("interactive terminal tools are registered", () => {
    const tools = createInteractiveTerminalTools(() => null);
    const names = tools.map((t) => t.name);
    assert.ok(names.includes("sandbox_shell_open"));
    assert.ok(names.includes("sandbox_shell_write"));
    assert.ok(names.includes("sandbox_shell_read"));
    assert.ok(names.includes("sandbox_shell_close"));
  });

  it("mcpBackupPayload strips OAuth client secrets", () => {
    const servers = [
      {
        id: "s1",
        name: "Test",
        transport: "http" as const,
        url: "https://example.com/mcp",
        enabled: true,
        headers: { "X-Key": "secret123" },
        oauth: {
          clientId: "cid",
          clientSecret: "supersecret",
          scopes: ["read"],
        },
      },
    ];
    const payload = mcpBackupPayload(servers);
    assert.equal(payload.length, 1);
    // clientId and scopes are kept (needed to re-auth), secret is stripped.
    assert.equal(payload[0].oauth?.clientId, "cid");
    assert.deepEqual(payload[0].oauth?.scopes, ["read"]);
    assert.ok(!("clientSecret" in (payload[0].oauth ?? {})));
    // Headers are kept as-is (they may contain ${ENV} refs, not raw secrets).
    assert.deepEqual(payload[0].headers, { "X-Key": "secret123" });
  });

  it("shouldConvertPaste respects threshold", () => {
    assert.equal(shouldConvertPaste("short"), false);
    assert.equal(shouldConvertPaste("x".repeat(2000)), true);
    assert.equal(shouldConvertPaste("x".repeat(1999)), false);
    assert.equal(shouldConvertPaste("x".repeat(5000), 10000), false);
  });

  it("pastePreview truncates", () => {
    assert.equal(pastePreview("hello"), "hello");
    const long = "a".repeat(200);
    assert.ok(pastePreview(long).length <= 121); // 120 + …
  });

  it("descOverrideStore.apply is a pass-through with no overrides", async () => {
    const tools = [
      { name: "a", description: "A" },
      { name: "b", description: "B" },
    ];
    const out = await descOverrideStore.apply(tools);
    assert.deepEqual(out, tools);
  });
});
