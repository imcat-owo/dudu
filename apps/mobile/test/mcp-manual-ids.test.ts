/**
 * D6: every tool produced by a create*Tools factory carries a legal manualId.
 *
 * Mechanical guarantee for the proactive note system (纸条机制): when a tool
 * FAILS, the agent appends a one-line note pointing at the manual — that only
 * works if the manualId names a manual that actually exists in the registry.
 *
 * Scope: the Batch-4 factories in src/mcp (ask_user, web_search,
 * delegate_task, cross_dialog CLI) plus the sandbox factories in src/sandbox
 * (sandboxTools + createInteractiveTerminalTools: sandbox_*, sandbox_shell_*).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LocalTool } from "../src/api-groups/local-tools.js";
import { manualIds } from "../src/manuals/index.js";
import { createCrossDialogCliTools } from "../src/mcp/agent-cli.js";
import { createAskUserTools } from "../src/mcp/ask-user.js";
import { createDelegateTools } from "../src/mcp/delegate.js";
import { createWebSearchTools } from "../src/mcp/web-search.js";
import { createInteractiveTerminalTools } from "../src/sandbox/interactive-terminal.js";
import { SandboxManager } from "../src/sandbox/manager.js";
import { sandboxTools } from "../src/sandbox/sandbox-tools.js";

function allBatch4Tools(): LocalTool[] {
  return [
    ...createAskUserTools(),
    ...createWebSearchTools(),
    ...createDelegateTools({ runSubtask: async () => "" }),
    ...createCrossDialogCliTools({
      listDialogs: async () => [],
      readDialog: async () => "",
      searchDialogs: async () => [],
    }),
  ];
}

function allSandboxTools(): LocalTool[] {
  return [
    ...sandboxTools(SandboxManager.forTest({})),
    ...createInteractiveTerminalTools(() => null),
  ];
}

describe("D6: batch-4 tools carry legal manualIds", () => {
  it("every create*Tools tool has a manualId registered in the manual index", () => {
    const legal = new Set(manualIds());
    const tools = allBatch4Tools();
    assert.ok(tools.length >= 4, "expected at least 4 batch-4 tools");
    for (const t of tools) {
      assert.ok(t.manualId, `tool "${t.name}" is missing manualId`);
      assert.ok(
        legal.has(t.manualId as string),
        `tool "${t.name}" has unknown manualId "${t.manualId}"`,
      );
    }
  });

  it("the expected tool names are covered", () => {
    const names = allBatch4Tools()
      .map((t) => t.name)
      .sort();
    assert.deepEqual(names, ["ask_user", "cross_dialog", "delegate_task", "web_search"]);
  });
});

describe("D6-sandbox: sandbox tools carry legal manualIds", () => {
  it("every sandbox factory tool has a manualId registered in the manual index", () => {
    const legal = new Set(manualIds());
    const tools = allSandboxTools();
    assert.ok(tools.length >= 10, "expected at least 10 sandbox tools");
    for (const t of tools) {
      assert.ok(t.manualId, `tool "${t.name}" is missing manualId`);
      assert.ok(
        legal.has(t.manualId as string),
        `tool "${t.name}" has unknown manualId "${t.manualId}"`,
      );
    }
  });

  it("the expected sandbox tool names are covered", () => {
    const names = allSandboxTools()
      .map((t) => t.name)
      .sort();
    assert.deepEqual(names, [
      "sandbox_container_start",
      "sandbox_container_stop",
      "sandbox_containers",
      "sandbox_relay_install_guide",
      "sandbox_run",
      "sandbox_shell_close",
      "sandbox_shell_open",
      "sandbox_shell_read",
      "sandbox_shell_write",
      "sandbox_ssh_setup",
    ]);
  });
});
