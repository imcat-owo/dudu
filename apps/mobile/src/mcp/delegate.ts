/**
 * Sub-agent delegation tool — PURE module (no React Native imports).
 *
 * D12: When a task is big, the AI breaks it down and hands pieces to
 * sub-agents with isolated context — instead of making her watch it
 * juggle everything in one thread.
 *
 * How it works here: `delegate_task` runs the subtask through the same
 * model with a fresh, isolated context (no access to the parent's
 * history), then returns the result. The parent decides what to do
 * with it. This is different from the group-chat orchestration (which
 * is personas talking to each other) — this is task decomposition.
 *
 * The actual model call is injected (deps.runSubtask) so this stays
 * testable and doesn't couple to the transport.
 */

import type { LocalTool } from "../api-groups/local-tools";

export interface DelegateDeps {
  /**
   * Run a subtask with isolated context. Receives the task prompt and
   * an optional list of tool names the sub-agent may use. Returns the
   * sub-agent's final text.
   */
  runSubtask: (prompt: string, allowedTools?: string[]) => Promise<string>;
  /** Max concurrent subtasks (default 3). */
  maxConcurrent?: number;
}

const running = new Set<string>();
let seq = 0;

/**
 * Tools the sub-agent does NOT get unless explicitly named in allowedTools:
 * - delegate_task: no recursive delegation in the default set (the parent
 *   decomposes; unbounded fan-out is a footgun).
 * - ask_user: dialog-scoped to the parent's thread (D17) — a sub-agent's
 *   question would pop up in her dialog without the parent's context.
 *   Questions ride back through the subtask result instead.
 * - ask_env_form: same as ask_user, plus secrets — a sub-agent must never
 *   pop a secret form in her dialog on its own; the parent asks instead.
 */
const SUBAGENT_DEFAULT_DENYLIST = new Set(["delegate_task", "ask_user", "ask_env_form"]);

/**
 * Resolve which tools a sub-agent actually receives (D25).
 *
 * - allowedTools given: exactly those tools, by name, from the parent's
 *   tool list. Unknown names throw — a misspelled name is a gap, not a
 *   silent drop.
 * - allowedTools omitted: the default set — everything except the denylist.
 */
export function resolveSubagentTools(allTools: LocalTool[], allowedTools?: string[]): LocalTool[] {
  if (allowedTools && allowedTools.length > 0) {
    const byName = new Map(allTools.map((t) => [t.name, t]));
    return allowedTools.map((name) => {
      const tool = byName.get(name);
      if (!tool) {
        throw new Error(
          `delegate_task: unknown tool "${name}" — the sub-agent can't use a tool that doesn't exist. Check the name and try again.`,
        );
      }
      return tool;
    });
  }
  return allTools.filter((t) => !SUBAGENT_DEFAULT_DENYLIST.has(t.name));
}

export function createDelegateTools(deps: DelegateDeps): LocalTool[] {
  const maxConcurrent = deps.maxConcurrent ?? 3;

  return [
    {
      name: "delegate_task",
      description:
        "Hand a self-contained subtask to a sub-agent with isolated context (it can't see this conversation). Use for big tasks: break them down, delegate the independent pieces, then combine the results yourself. The subtask must include ALL context it needs — the sub-agent starts from zero.",
      parameters: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description:
              "The full task prompt for the sub-agent. Self-contained: include every fact, constraint, and format requirement it needs.",
          },
          allowedTools: {
            type: "array",
            items: { type: "string" },
            description:
              "Tool names the sub-agent may use (optional). Omit for the default set: all your tools except delegate_task (no recursive delegation by default), ask_user (its questions would pop up in her dialog without your context — have it return questions in its result instead), and ask_env_form (same — never let a sub-agent pop a secret form on its own).",
          },
        },
        required: ["task"],
        additionalProperties: false,
      },
      manualId: "coordination",
      run: async (args, _ctx) => {
        const task = String(args.task ?? "").trim();
        if (!task) throw new Error("delegate_task: empty task");
        if (running.size >= maxConcurrent) {
          throw new Error(
            `Too many subtasks running (${running.size}). Wait for one to finish first.`,
          );
        }
        const id = `sub_${Date.now()}_${++seq}`;
        running.add(id);
        try {
          const allowedTools = Array.isArray(args.allowedTools)
            ? (args.allowedTools as unknown[]).map(String)
            : undefined;
          const result = await deps.runSubtask(task, allowedTools);
          return result;
        } finally {
          running.delete(id);
        }
      },
    },
  ];
}

/** For tests. */
export function __runningSubtaskCount(): number {
  return running.size;
}
