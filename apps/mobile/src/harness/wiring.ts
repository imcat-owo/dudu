/**
 * Harness Phase 1 — default hook mounts + session-log wiring for the agent.
 *
 * This module mounts the agent's EXISTING behavior onto the harness hooks
 * (hooks.ts) without changing what the main loop does:
 *
 *   tools/pre-execute  → incognito backstop (moved verbatim from the
 *                         tool loop in local-agent.ts). The per-turn
 *                         `approvals` cache lives on the hook input.
 *   tools/post-execute → session-log tool/call + tool/result (the
 *                         "model-visible means logged" iron rule) +
 *                         the proactive manual note on failure (moved
 *                         verbatim from the loop; returned as a note so
 *                         the loop appends it exactly like before).
 *   pre-step           → no default hook (extension point, tested).
 *
 * Approval design (honest, no double-prompt):
 * - Out-of-app (capability) tools keep their in-run authorize UI — the
 *   tool knows the specific action ("读取你相册里最新的照片"), a hook
 *   can't prompt with a vaguer copy. The hook carries the per-turn
 *   `approvals` cache; the wrapped execution context consults it first
 *   (cache-first write-through), so a second call of the same tool in
 *   one turn doesn't prompt her twice.
 * - MCP per-server ask/allow/deny stays inside mcp/client.ts untouched.
 *
 * PURE except for the injected SessionLog (SQLite via getSessionLogDb in
 * the app, memory in tests). All logging is fail-closed: incognito never
 * writes, storage errors never break a turn.
 */

import type { ToolContext } from "../api-groups/local-tools";
import { createAgentHooks, type HookRunner } from "./hooks";
import type { SessionEventType, SessionLog } from "./session-log";
import { logPayload } from "./session-log";

export interface HarnessWiringDeps {
  /** Session id. The thread IS the session (opts.threadId). */
  sessionId: string;
  isIncognito: () => boolean;
  isToolBlocked: (name: string) => boolean;
  incognitoRefusal: (name: string) => string;
  /** Proactive note system (纸条機制): manual note text by manual id. */
  getManualNote: (manualId: string) => string | null;
  /** Injected log (tests). When omitted, resolved lazily per turn. */
  getLog?: () => Promise<SessionLog | null>;
}

export interface BeginTurnOpts {
  /** Manuals read this turn (so error notes don't repeat). */
  readManuals: Set<string>;
  /** Find a tool's manifest by name (for the failure manual-note lookup). */
  findTool: (name: string) => { manualId?: string } | undefined;
}

export interface TurnHarness {
  readonly turnId: string;
  readonly approvals: Map<string, boolean>;
  /** Fire-and-forget event log. No-op on incognito or log failure. */
  logEvent(type: SessionEventType, payload: string, stepId?: string): void;
  /**
   * Execution context for one tool call: authorize is cache-first
   * write-through, keyed by tool name — a second call of the same tool
   * in one turn doesn't prompt her twice.
   */
  wrapContext(ctx: ToolContext, toolName: string): ToolContext;
  setStepId(stepId: string | undefined): void;
  setToolCallId(toolCallId: string | undefined): void;
}

export interface AgentHarness {
  readonly hooks: HookRunner;
  beginTurn(opts: BeginTurnOpts): TurnHarness;
}

const MAX_PAYLOAD_CHARS = 4000;
function cap(s: string): string {
  return s.length > MAX_PAYLOAD_CHARS ? `${s.slice(0, MAX_PAYLOAD_CHARS)}…` : s;
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createAgentHarness(deps: HarnessWiringDeps): AgentHarness {
  const hooks = createAgentHooks();

  // The turn in flight (runTurn guards `running`, so at most one).
  let turn: TurnHarness | null = null;
  let turnOpts: BeginTurnOpts | null = null;
  let stepId: string | undefined;
  let toolCallId: string | undefined;

  // tools/pre-execute — the approval checkpoint. Default policy is the
  // agent's current behavior, made explicit: incognito backstop first
  // (verbatim from the tool loop), then allow. Capability tools prompt
  // inside their own run() with the specific action; the hook must not
  // pre-prompt with a vaguer copy.
  hooks.on("tools/pre-execute", ({ tool }) => {
    if (deps.isIncognito() && deps.isToolBlocked(tool.name)) {
      return { allow: false, reason: deps.incognitoRefusal(tool.name) };
    }
    return { allow: true };
  });

  // tools/post-execute — session log + proactive manual note, both moved
  // verbatim from the tool loop. The note is returned (not appended here)
  // so the loop keeps its exact "result += \n${note}" behavior.
  hooks.on("tools/post-execute", (input) => {
    const t = turn;
    if (t && !deps.isIncognito() && toolCallId) {
      const argsJson = cap(JSON.stringify(input.args));
      t.logEvent(
        "tool/call",
        logPayload.toolCall({ toolCallId, name: input.tool.name, args: argsJson }),
        stepId,
      );
      t.logEvent(
        "tool/result",
        logPayload.toolResult({
          toolCallId,
          result: cap(input.result),
          isError: input.failed,
        }),
        stepId,
      );
    }
    if (input.failed && turnOpts) {
      const manualId = turnOpts.findTool(input.tool.name)?.manualId;
      if (manualId && !turnOpts.readManuals.has(manualId)) {
        const note = deps.getManualNote(manualId);
        if (note) return { note };
      }
    }
    return undefined;
  });

  function beginTurn(opts: BeginTurnOpts): TurnHarness {
    const turnId = newId("turn");
    const approvals = new Map<string, boolean>();
    let log: SessionLog | null = null;
    let logReady: Promise<SessionLog | null> | null = null;

    function getLogLazy(): Promise<SessionLog | null> {
      if (!logReady) {
        logReady = (async () => {
          try {
            if (deps.getLog) return await deps.getLog();
            // expo-sqlite is imported ONLY here (never in the pure core).
            const sqlite = await import("./session-log-sqlite");
            const core = await import("./session-log");
            return core.createSessionLog(
              sqlite.createSqliteSessionLogBackend(await sqlite.getSessionLogDb()),
            );
          } catch {
            return null; // Logging must never break a turn.
          }
        })();
      }
      return logReady;
    }
    // Warm the lazy log in the background (fire-and-forget).
    void getLogLazy().then((l) => {
      log = l;
    });

    function logEvent(type: SessionEventType, payload: string, sid?: string): void {
      if (deps.isIncognito()) return; // fail-closed: zero trace, incl. the log.
      const attempt = async () => {
        const l = log ?? (await getLogLazy());
        if (!l) return;
        await l.append({ sessionId: deps.sessionId, turnId, stepId: sid, type, payload });
      };
      // Fire-and-forget: storage latency never blocks the turn; a failure
      // only means this event is missing, never a broken reply.
      void attempt().catch(() => {});
    }

    function wrapContext(ctx: ToolContext, toolName: string): ToolContext {
      return {
        authorize: async (req) => {
          const cached = approvals.get(toolName);
          if (cached !== undefined) return cached;
          const ok = await ctx.authorize(req);
          approvals.set(toolName, ok);
          return ok;
        },
      };
    }

    const t: TurnHarness = {
      turnId,
      approvals,
      logEvent,
      wrapContext,
      setStepId: (s) => {
        stepId = s;
      },
      setToolCallId: (c) => {
        toolCallId = c;
      },
    };
    turn = t;
    turnOpts = opts;
    stepId = undefined;
    toolCallId = undefined;
    return t;
  }

  return { hooks, beginTurn };
}
