/**
 * Harness Phase 1 — lightweight tool registry (NOT Cordis).
 *
 * 抄思路不抄代码: dsh's "everything is a plugin" idea, sized for a phone.
 * Cordis stays off the device: too heavy, and hot-loading plugins is a
 * review + Expo pitfall. What we take is the shape —
 *   tool = module + manifest (name, description, param schema,
 *          needsApproval declaration)
 * — runtime-registered, mountable, replaceable. No privileged core:
 * API groups, model backends, the MCP tool pool, and browser tools all
 * resolve through this one registry.
 *
 * PURE module: no React Native / expo imports.
 *
 * needsApproval semantics:
 * - true  = the tool goes through the tools/pre-execute approval
 *           checkpoint (the agent's authorize gate) before EVERY call.
 * - false = runs free; approval (if any) lives in the tool's own chain
 *           (e.g. MCP per-server ask/allow/deny in mcp/client.ts).
 * Derived for existing tools: capability != null (out-of-app) → true.
 */

import type { LocalTool, ToolContext, ToolParametersSchema } from "../api-groups/local-tools";
import { ToolError } from "../api-groups/local-tools";
import type { CapabilityId } from "../capabilities";

export interface ToolManifest {
  name: string;
  description: string;
  parameters: ToolParametersSchema;
  /**
   * dsh-style declaration. true = must pass the tools/pre-execute
   * approval checkpoint on every call. MCP tools keep their own
   * per-server approval chain (false here, enforced in mcp/client.ts).
   */
  needsApproval: boolean;
  /** Proactive note system (纸条机制): manual to point at on failure. */
  manualId?: string;
  /** Set for out-of-app tools — implies needsApproval. */
  capability?: CapabilityId;
}

export interface HarnessTool extends ToolManifest {
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

export interface HarnessRegistry {
  /** Register a tool. Throws on duplicate name — use replace() to swap. */
  register(tool: HarnessTool): void;
  /** Swap a tool's implementation under the same manifest name. */
  replace(name: string, tool: HarnessTool): void;
  /** Remove a tool. No-op when absent. */
  unregister(name: string): void;
  /** Resolve by name. undefined when absent (caller decides the error). */
  resolve(name: string): HarnessTool | undefined;
  /** All tools, registration order. */
  list(): HarnessTool[];
  /** Bulk mount (e.g. one module's whole tool set). */
  mount(tools: HarnessTool[]): void;
  /** Model-facing function definitions (OpenAI wire format). */
  definitions(): Array<{
    type: "function";
    function: { name: string; description: string; parameters: ToolParametersSchema };
  }>;
  /**
   * Execute by name. Throws ToolError("Unknown tool: …") when absent —
   * same contract as the old createToolRegistry(). Approval is NOT
   * done here: it belongs to the tools/pre-execute hook.
   */
  execute(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

export function createHarnessRegistry(initial: HarnessTool[] = []): HarnessRegistry {
  const byName = new Map<string, HarnessTool>();
  for (const t of initial) byName.set(t.name, t);

  function definitions() {
    return [...byName.values()].map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  async function execute(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<string> {
    const tool = byName.get(name);
    if (!tool) throw new ToolError(`Unknown tool: ${name}.`);
    return tool.run(args, ctx);
  }

  return {
    register(tool: HarnessTool): void {
      if (byName.has(tool.name)) {
        throw new Error(`Tool "${tool.name}" is already registered — use replace() to swap it.`);
      }
      byName.set(tool.name, tool);
    },
    replace(name: string, tool: HarnessTool): void {
      if (!byName.has(name)) {
        throw new Error(`Cannot replace "${name}": no such tool is registered.`);
      }
      byName.set(tool.name, tool);
    },
    unregister(name: string): void {
      byName.delete(name);
    },
    resolve(name: string): HarnessTool | undefined {
      return byName.get(name);
    },
    list(): HarnessTool[] {
      return [...byName.values()];
    },
    mount(tools: HarnessTool[]): void {
      for (const t of tools) byName.set(t.name, t);
    },
    definitions,
    execute,
  };
}

/**
 * Migrate an existing LocalTool onto the harness registry.
 * needsApproval is derived, not guessed: out-of-app tools (capability
 * set) declare approval; everything else keeps its existing chain.
 */
export function harnessToolFromLocalTool(t: LocalTool): HarnessTool {
  return {
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    needsApproval: t.capability != null,
    manualId: t.manualId,
    capability: t.capability,
    run: t.run,
  };
}

/** Migrate a whole assembled tool list (the assembleAgentTools output). */
export function createHarnessRegistryFromLocalTools(tools: LocalTool[]): HarnessRegistry {
  return createHarnessRegistry(tools.map(harnessToolFromLocalTool));
}
