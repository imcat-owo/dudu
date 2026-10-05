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
              "Tool names the sub-agent may use (optional). Omit to allow the default set.",
          },
        },
        required: ["task"],
        additionalProperties: false,
      },
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
