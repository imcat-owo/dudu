/**
 * Tool-list assembly for the local agent.
 *
 * PURE module: no React Native / expo imports, so the assembly ORDER —
 * the exact thing that caused the MCP-invisibility P0 — stays unit-testable
 * in plain node. local-agent.ts calls assembleAgentTools() and builds the
 * registry from its result; the registry must NEVER be built from a
 * pre-MCP snapshot again.
 *
 * Order contract (do not reorder without updating tool-assembly.test.ts):
 *  1. base in-app tools
 *  2. external (MCP server) tools appended — SKIPPED entirely for incognito
 *     sessions, so "zero trace" is structural, not filter-order-dependent
 *  3. editable description overrides applied
 *  4. incognito filter (write tools) applied last, right before the registry
 */

import { isBlockedInIncognito } from "./incognito-guard";
import type { LocalTool } from "./local-tools";

export interface ToolAssemblyDeps {
  /** Base in-app tools (already constructed by the caller). */
  baseTools: LocalTool[];
  /** Load external (MCP server) tools. May throw — treated as unavailable. */
  loadExternalTools: () => Promise<LocalTool[]>;
  /** Apply editable description overrides before the model sees the tools. */
  applyDescOverrides: (tools: LocalTool[]) => Promise<LocalTool[]>;
  /** True when the caller supplied an explicit tool list (opts.tools). */
  externalSupplied: boolean;
  /** True for incognito ("zero trace") sessions. */
  isIncognito: boolean;
}

export interface AssembledTools {
  /**
   * Every tool, pre-incognito-filter — used for failure manual-note lookup
   * (same semantics as the old `tools` variable in local-agent.ts).
   */
  allTools: LocalTool[];
  /**
   * What the model actually sees: external tools included (when loaded),
   * incognito-blocked tools excluded. Feed THIS to createToolRegistry().
   */
  effectiveTools: LocalTool[];
}

export async function assembleAgentTools(deps: ToolAssemblyDeps): Promise<AssembledTools> {
  let tools = deps.baseTools;
  if (!deps.externalSupplied) {
    // External (MCP) tools. Incognito sessions never load them: a session
    // that promised zero trace must not even SEE external server tools.
    // Skipping the load (rather than appending then filtering) makes the
    // guarantee structural instead of depending on statement order.
    if (!deps.isIncognito) {
      try {
        tools = [...tools, ...(await deps.loadExternalTools())];
      } catch {
        // External tools unavailable — the agent works without them.
      }
    }
    tools = await deps.applyDescOverrides(tools);
  }
  const effectiveTools = deps.isIncognito
    ? tools.filter((t) => !isBlockedInIncognito(t.name))
    : tools;
  return { allTools: tools, effectiveTools };
}
