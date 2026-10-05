/**
 * Tool-assembly order tests (P0: MCP tools pulled but never registered).
 *
 * The registry MUST be built from the FINAL tool list (base + MCP,
 * minus incognito-blocked). These tests pin that order contract:
 *  - external (MCP) tools reach registry.definitions() and registry.execute()
 *  - incognito sessions never load external tools and never see blocked tools
 *  - a failing external loader degrades to base tools, never breaks the agent
 *  - an explicitly supplied tool list skips external loading + desc overrides
 *
 * Uses node:test + tsx (no React Native in the import chain:
 * tool-assembly -> local-tools/incognito-guard are PURE modules).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createToolRegistry,
  type LocalTool,
  type ToolContext,
} from "../src/api-groups/local-tools";
import { assembleAgentTools, type ToolAssemblyDeps } from "../src/api-groups/tool-assembly";

function fakeTool(
  name: string,
  runImpl?: (args: Record<string, unknown>) => Promise<string>,
): LocalTool {
  return {
    name,
    description: `${name} description`,
    parameters: { type: "object", properties: {} },
    run: async (args) => (runImpl ? runImpl(args) : `ok:${name}:${JSON.stringify(args)}`),
  };
}

const testCtx: ToolContext = { authorize: async () => true };

function baseDeps(overrides: Partial<ToolAssemblyDeps>): ToolAssemblyDeps {
  return {
    baseTools: [fakeTool("time_now")],
    loadExternalTools: async () => [],
    applyDescOverrides: async (t) => t,
    externalSupplied: false,
    isIncognito: false,
    ...overrides,
  };
}

describe("tool assembly order (MCP P0)", () => {
  it("external MCP tools reach definitions() and execute()", async () => {
    const mcpTool = fakeTool("mcp__srv__search", async (args) => `searched:${args.q}`);
    const { allTools, effectiveTools } = await assembleAgentTools(
      baseDeps({ loadExternalTools: async () => [mcpTool] }),
    );

    assert.ok(
      allTools.some((t) => t.name === "mcp__srv__search"),
      "allTools must contain the MCP tool",
    );
    const registry = createToolRegistry(effectiveTools);
    const names = registry.definitions().map((d) => d.function.name);
    assert.ok(
      names.includes("mcp__srv__search"),
      `definitions() must include the MCP tool, got: ${names.join(",")}`,
    );
    const result = await registry.execute("mcp__srv__search", { q: "x" }, testCtx);
    assert.equal(result, "searched:x");
  });

  it("incognito: external tools are never loaded, blocked tools are filtered", async () => {
    let loaderCalled = false;
    const { effectiveTools } = await assembleAgentTools(
      baseDeps({
        baseTools: [fakeTool("time_now"), fakeTool("memory_add")], // memory_add is incognito-blocked
        isIncognito: true,
        loadExternalTools: async () => {
          loaderCalled = true;
          return [fakeTool("mcp__srv__search")];
        },
      }),
    );

    assert.equal(loaderCalled, false, "incognito must not load external tools at all");
    const registry = createToolRegistry(effectiveTools);
    const names = registry.definitions().map((d) => d.function.name);
    assert.ok(names.includes("time_now"), "read tools stay visible");
    assert.ok(!names.includes("memory_add"), "blocked write tools are filtered");
    assert.ok(!names.includes("mcp__srv__search"), "MCP tools never reach incognito");
    await assert.rejects(
      registry.execute("mcp__srv__search", {}, testCtx),
      /Unknown tool/,
      "execute() must refuse MCP tools in incognito",
    );
    await assert.rejects(
      registry.execute("memory_add", {}, testCtx),
      /Unknown tool/,
      "execute() must refuse blocked tools in incognito",
    );
  });

  it("external loader failure degrades to base tools", async () => {
    const { effectiveTools } = await assembleAgentTools(
      baseDeps({
        loadExternalTools: async () => {
          throw new Error("server unreachable");
        },
      }),
    );
    const registry = createToolRegistry(effectiveTools);
    const names = registry.definitions().map((d) => d.function.name);
    assert.deepEqual(names, ["time_now"]);
  });

  it("explicitly supplied tool list skips external loading and desc overrides", async () => {
    let loaderCalled = false;
    let overridesCalled = false;
    const supplied = [fakeTool("custom_tool")];
    const { effectiveTools } = await assembleAgentTools(
      baseDeps({
        baseTools: supplied,
        externalSupplied: true,
        loadExternalTools: async () => {
          loaderCalled = true;
          return [fakeTool("mcp__srv__search")];
        },
        applyDescOverrides: async (t) => {
          overridesCalled = true;
          return t;
        },
      }),
    );
    assert.equal(loaderCalled, false);
    assert.equal(overridesCalled, false);
    assert.deepEqual(
      effectiveTools.map((t) => t.name),
      ["custom_tool"],
    );
  });

  it("desc overrides apply after external tools are appended", async () => {
    const seen: string[][] = [];
    const { effectiveTools } = await assembleAgentTools(
      baseDeps({
        loadExternalTools: async () => [fakeTool("mcp__srv__search")],
        applyDescOverrides: async (t) => {
          seen.push(t.map((x) => x.name));
          return t.map((x) =>
            x.name === "mcp__srv__search" ? { ...x, description: "OVERRIDDEN" } : x,
          );
        },
      }),
    );
    assert.deepEqual(seen, [["time_now", "mcp__srv__search"]]);
    assert.equal(
      effectiveTools.find((t) => t.name === "mcp__srv__search")?.description,
      "OVERRIDDEN",
    );
  });
});
