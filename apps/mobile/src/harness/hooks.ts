/**
 * Harness Phase 1 — agent-loop hooks.
 *
 * 抄思路不抄代码: dsh's plugin hook points, sized for a phone. Three hook
 * positions on the agent loop:
 *   pre-step           — before each model request. Can rewrite the step
 *                        input (the wire messages) or reject the step
 *                        outright with an honest reason.
 *   tools/pre-execute  — the approval checkpoint. Runs before EVERY tool
 *                        call. First deny wins (fail closed).
 *   tools/post-execute — after every tool call. Logging, slip injection,
 *                        usage stats. Never blocks the loop.
 *
 * Hooks are additive: the agent mounts its current behavior as the
 * DEFAULT hooks (same policy, same strings), and third-party / future
 * code mounts more via on(). Unsubscribe with the returned function.
 *
 * PURE module: no React Native / expo imports.
 */

import type { ToolContext } from "../api-groups/local-tools";
import type { HarnessTool } from "./tool-registry";

/** Model-facing message shape (OpenAI wire format, minimal). */
export interface HookWireMessage {
  role: string;
  content: unknown;
  [k: string]: unknown;
}

export type HookName = "pre-step" | "tools/pre-execute" | "tools/post-execute";

export interface PreStepInput {
  wire: HookWireMessage[];
  /** 0-based model request index within the turn. */
  stepIndex: number;
}
export type PreStepResult = undefined | { rewriteWire?: HookWireMessage[] } | { reject: string };

export interface PreExecuteInput {
  tool: HarnessTool;
  args: Record<string, unknown>;
  ctx: ToolContext;
  /**
   * Per-turn approval cache, keyed by tool name. A hook that approved a
   * tool writes true here so the tool's own in-run authorize backstop
   * doesn't prompt her twice for the same call.
   */
  approvals: Map<string, boolean>;
}
export interface PreExecuteResult {
  allow: boolean;
  /** Honest reason, shown to the model when denied. Required on deny. */
  reason?: string;
}

export interface PostExecuteInput {
  tool: HarnessTool;
  args: Record<string, unknown>;
  /** The tool's return string (or the honest error string on failure). */
  result: string;
  /** True only when execution threw (the catch branch ran). */
  failed: boolean;
  ctx: ToolContext;
}

/**
 * A post-execute hook may return a note to append to the tool result
 * (e.g. the proactive manual note / 纸条). Notes are appended in
 * registration order, each on its own line.
 */
export type PostExecuteResult = undefined | { note?: string };

export type HookFn =
  | ((input: PreStepInput) => PreStepResult | Promise<PreStepResult>)
  | ((input: PreExecuteInput) => PreExecuteResult | Promise<PreExecuteResult>)
  | ((input: PostExecuteInput) => PostExecuteResult | Promise<PostExecuteResult>);

export interface AgentHooks {
  /** Mount a hook. Returns an unsubscribe function. */
  on(
    name: "pre-step",
    fn: (input: PreStepInput) => PreStepResult | Promise<PreStepResult>,
  ): () => void;
  on(
    name: "tools/pre-execute",
    fn: (input: PreExecuteInput) => PreExecuteResult | Promise<PreExecuteResult>,
  ): () => void;
  on(
    name: "tools/post-execute",
    fn: (input: PostExecuteInput) => PostExecuteResult | Promise<PostExecuteResult>,
  ): () => void;
}

export interface HookRunner extends AgentHooks {
  runPreStep(input: PreStepInput): Promise<{ wire: HookWireMessage[] } | { rejected: string }>;
  runToolsPreExecute(input: PreExecuteInput): Promise<PreExecuteResult>;
  /** Runs all post-execute hooks; returns their notes in order. */
  runToolsPostExecute(input: PostExecuteInput): Promise<{ notes: string[] }>;
}

export function createAgentHooks(): HookRunner {
  const handlers = new Map<HookName, HookFn[]>();
  const get = (n: HookName): HookFn[] => {
    let list = handlers.get(n);
    if (!list) {
      list = [];
      handlers.set(n, list);
    }
    return list;
  };

  function on(name: HookName, fn: HookFn): () => void {
    const list = get(name);
    list.push(fn);
    return () => {
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }

  /**
   * pre-step: first reject wins; rewrites compose in registration order.
   * A throwing hook fails the step closed (reject) — a broken hook must
   * never silently let a step through.
   */
  async function runPreStep(
    input: PreStepInput,
  ): Promise<{ wire: HookWireMessage[] } | { rejected: string }> {
    let wire = input.wire;
    for (const fn of get("pre-step")) {
      let r: PreStepResult;
      try {
        r = await (fn as (i: PreStepInput) => PreStepResult | Promise<PreStepResult>)(input);
      } catch (e) {
        return {
          rejected: `A pre-step hook failed: ${e instanceof Error ? e.message : String(e)}.`,
        };
      }
      if (r && typeof r === "object") {
        if ("reject" in r && typeof r.reject === "string") return { rejected: r.reject };
        if ("rewriteWire" in r && Array.isArray(r.rewriteWire)) wire = r.rewriteWire;
      }
    }
    return { wire };
  }

  /**
   * tools/pre-execute: first deny wins (fail closed). A throwing hook
   * denies — a broken approval hook must never silently allow a call.
   */
  async function runToolsPreExecute(input: PreExecuteInput): Promise<PreExecuteResult> {
    for (const fn of get("tools/pre-execute")) {
      let r: PreExecuteResult;
      try {
        r = await (fn as (i: PreExecuteInput) => PreExecuteResult | Promise<PreExecuteResult>)(
          input,
        );
      } catch (e) {
        return {
          allow: false,
          reason: `A pre-execute hook failed: ${e instanceof Error ? e.message : String(e)}.`,
        };
      }
      if (r?.allow !== true) {
        return {
          allow: false,
          reason:
            r && typeof r.reason === "string" && r.reason
              ? r.reason
              : `Tool "${input.tool.name}" was blocked by policy.`,
        };
      }
    }
    return { allow: true };
  }

  /**
   * tools/post-execute: every hook runs; one throwing hook must not kill
   * the others or the loop (same isolation rule as the agent's emit()).
   * Notes returned by hooks are collected in registration order.
   */
  async function runToolsPostExecute(input: PostExecuteInput): Promise<{ notes: string[] }> {
    const notes: string[] = [];
    for (const fn of get("tools/post-execute")) {
      try {
        const r = await (
          fn as (i: PostExecuteInput) => PostExecuteResult | Promise<PostExecuteResult>
        )(input);
        if (r && typeof r === "object" && typeof r.note === "string" && r.note) {
          notes.push(r.note);
        }
      } catch {
        // A broken post-execute hook must never break the turn.
      }
    }
    return { notes };
  }

  return { on: on as AgentHooks["on"], runPreStep, runToolsPreExecute, runToolsPostExecute };
}
