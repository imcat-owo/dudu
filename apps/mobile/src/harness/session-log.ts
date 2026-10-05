/**
 * Harness Phase 1 — append-only session log (the single source of truth).
 *
 * 抄思路不抄代码: DeepSeek Harness's core idea — every event the model can
 * see is logged first ("model-visible means logged"), and memory, resume,
 * fork, replay, and audit all derive from the SAME log. No second copy of
 * history.
 *
 * PURE module: no React Native / expo imports, so the log core stays
 * unit-testable in plain node. The SQLite backend lives in
 * session-log-sqlite.ts; tests inject MemorySessionLogBackend.
 *
 * Event types (one turn = one or more steps; one step = one model request
 * plus the tools it called):
 *   turn/start, turn/end
 *   step/start, step/end
 *   user/message, assistant/message
 *   tool/call, tool/result
 *   request/header  (what the model request looked like: model, backend,
 *                    tool count — NEVER secrets)
 *
 * Iron rules:
 * - append-only: no updates, no deletes of events (use deleteSession for
 *   whole-session hygiene only).
 * - model-visible means logged: the agent loop logs each piece of content
 *   at the moment it becomes model-visible (user message at turn start,
 *   tool call/result around execution, assistant reply at completion).
 * - incognito sessions never touch the log — enforced at the call site
 *   (local-agent.ts), fail-closed like persist().
 * - secrets NEVER enter the log: request/header carries model + endpoint
 *   only; tool args/results are logged as-is because tool results are
 *   already model-visible, but callers must redact before logging if a
 *   tool deals in secrets (the env-form tool returns {stored: name}).
 */

export type SessionEventType =
  | "turn/start"
  | "turn/end"
  | "step/start"
  | "step/end"
  | "user/message"
  | "assistant/message"
  | "tool/call"
  | "tool/result"
  | "request/header";

export interface NewSessionEvent {
  sessionId: string;
  turnId?: string;
  stepId?: string;
  type: SessionEventType;
  /** JSON string. Keep small; large blobs (images) are referenced, not embedded. */
  payload: string;
  createdAt?: number;
}

export interface SessionEvent extends NewSessionEvent {
  seq: number;
  createdAt: number;
}

/** Storage backend. SQLite in the app, memory in tests. */
export interface SessionLogBackend {
  /** Append one event. Returns its sequence number. */
  append(e: NewSessionEvent): Promise<number>;
  /** All events for a session, in seq order, optionally from a seq. */
  read(sessionId: string, fromSeq?: number): Promise<SessionEvent[]>;
  /** Highest seq for a session (0 when empty). */
  latestSeq(sessionId: string): Promise<number>;
  /** Whole-session hygiene (user-initiated delete). The only delete path. */
  deleteSession(sessionId: string): Promise<void>;
}

/** In-memory backend for tests. Append-only in behavior. */
export function createMemorySessionLogBackend(): SessionLogBackend {
  const bySession = new Map<string, SessionEvent[]>();
  let seq = 0;
  return {
    async append(e: NewSessionEvent): Promise<number> {
      seq += 1;
      const full: SessionEvent = { ...e, seq, createdAt: e.createdAt ?? Date.now() };
      const list = bySession.get(e.sessionId) ?? [];
      list.push(full);
      bySession.set(e.sessionId, list);
      return full.seq;
    },
    async read(sessionId: string, fromSeq = 0): Promise<SessionEvent[]> {
      return (bySession.get(sessionId) ?? []).filter((e) => e.seq >= fromSeq);
    },
    async latestSeq(sessionId: string): Promise<number> {
      const list = bySession.get(sessionId) ?? [];
      return list.length > 0 ? list[list.length - 1].seq : 0;
    },
    async deleteSession(sessionId: string): Promise<void> {
      bySession.delete(sessionId);
    },
  };
}

/** A model-visible chat message derived from the log (for resume/replay). */
export interface DerivedMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: Array<{ id: string; name: string; args: string }>;
  toolCallId?: string;
}

export interface SessionLog {
  readonly backend: SessionLogBackend;
  append(e: NewSessionEvent): Promise<number>;
  readSession(sessionId: string, fromSeq?: number): Promise<SessionEvent[]>;
  /**
   * Fork: new session id whose log starts as a copy of `fromSessionId`
   * events up to and including `atSeq`. The source log is untouched.
   */
  fork(fromSessionId: string, atSeq: number, newSessionId: string): Promise<string>;
  /**
   * Derive model-visible messages from the log — resume, replay, and
   * audit all use this. One derivation, no second copy of history.
   */
  deriveMessages(events: SessionEvent[]): DerivedMessage[];
  /**
   * Usage stats derived from the log itself (no separate counter to
   * drift): turns, model steps, tool calls (+ per-tool), messages.
   */
  getUsageStats(sessionId: string): Promise<{
    turns: number;
    steps: number;
    toolCalls: number;
    byTool: Record<string, number>;
    userMessages: number;
    assistantMessages: number;
  }>;
}

export function createSessionLog(backend: SessionLogBackend): SessionLog {
  async function append(e: NewSessionEvent): Promise<number> {
    return backend.append(e);
  }

  async function readSession(sessionId: string, fromSeq?: number): Promise<SessionEvent[]> {
    return backend.read(sessionId, fromSeq);
  }

  async function fork(fromSessionId: string, atSeq: number, newSessionId: string): Promise<string> {
    const events = await backend.read(fromSessionId);
    for (const e of events) {
      if (e.seq > atSeq) break;
      await backend.append({
        sessionId: newSessionId,
        turnId: e.turnId,
        stepId: e.stepId,
        type: e.type,
        payload: e.payload,
        createdAt: e.createdAt,
      });
    }
    return newSessionId;
  }

  function deriveMessages(events: SessionEvent[]): DerivedMessage[] {
    const out: DerivedMessage[] = [];
    // tool/call events accumulate until their results arrive; results are
    // matched by toolCallId so out-of-order completion still replays right.
    const pendingCalls = new Map<string, { id: string; name: string; args: string }>();
    for (const e of events) {
      let p: Record<string, unknown>;
      try {
        p = JSON.parse(e.payload) as Record<string, unknown>;
      } catch {
        continue; // A corrupt payload must never break replay.
      }
      switch (e.type) {
        case "user/message":
          if (typeof p.text === "string") out.push({ role: "user", content: p.text });
          break;
        case "assistant/message": {
          const msg: DerivedMessage = {
            role: "assistant",
            content: typeof p.text === "string" ? p.text : "",
          };
          if (Array.isArray(p.toolCalls) && p.toolCalls.length > 0) {
            msg.toolCalls = (p.toolCalls as Array<Record<string, string>>).map((c) => ({
              id: String(c.id ?? ""),
              name: String(c.name ?? ""),
              args: String(c.args ?? "{}"),
            }));
          }
          out.push(msg);
          break;
        }
        case "tool/call":
          if (typeof p.toolCallId === "string") {
            pendingCalls.set(p.toolCallId, {
              id: p.toolCallId,
              name: typeof p.name === "string" ? p.name : "unknown",
              args: typeof p.args === "string" ? p.args : "{}",
            });
          }
          break;
        case "tool/result":
          if (typeof p.toolCallId === "string") {
            const call = pendingCalls.get(p.toolCallId);
            if (call) {
              // Attach the call to the most recent assistant message that
              // doesn't have tool calls yet (the one that issued it).
              for (let i = out.length - 1; i >= 0; i--) {
                if (out[i].role === "assistant" && !out[i].toolCalls) {
                  out[i].toolCalls = [call];
                  break;
                }
              }
              pendingCalls.delete(p.toolCallId);
            }
            out.push({
              role: "tool",
              content: typeof p.result === "string" ? p.result : "",
              toolCallId: p.toolCallId,
            });
          }
          break;
        default:
          break; // turn/step/request markers carry no message content.
      }
    }
    return out;
  }

  async function getUsageStats(sessionId: string) {
    const events = await backend.read(sessionId);
    const byTool: Record<string, number> = {};
    let turns = 0;
    let steps = 0;
    let toolCalls = 0;
    let userMessages = 0;
    let assistantMessages = 0;
    for (const e of events) {
      switch (e.type) {
        case "turn/start":
          turns += 1;
          break;
        case "step/start":
          steps += 1;
          break;
        case "tool/call": {
          toolCalls += 1;
          try {
            const p = JSON.parse(e.payload) as { name?: string };
            if (p.name) byTool[p.name] = (byTool[p.name] ?? 0) + 1;
          } catch {
            // ignore
          }
          break;
        }
        case "user/message":
          userMessages += 1;
          break;
        case "assistant/message":
          assistantMessages += 1;
          break;
        default:
          break;
      }
    }
    return { turns, steps, toolCalls, byTool, userMessages, assistantMessages };
  }

  return { backend, append, readSession, fork, deriveMessages, getUsageStats };
}

/** Typed payload builders — keeps producers honest about shape. */
export const logPayload = {
  turnStart(info: { model: string; backend: string }): string {
    return JSON.stringify({ model: info.model, backend: info.backend });
  },
  userMessage(text: string): string {
    return JSON.stringify({ text });
  },
  stepStart(info: { iteration: number }): string {
    return JSON.stringify({ iteration: info.iteration });
  },
  requestHeader(info: {
    model: string;
    /** Endpoint host only — never api keys, never full headers. */
    endpoint: string;
    toolCount: number;
    wireMessages: number;
  }): string {
    return JSON.stringify(info);
  },
  toolCall(info: { toolCallId: string; name: string; args: string }): string {
    return JSON.stringify(info);
  },
  toolResult(info: { toolCallId: string; result: string; isError: boolean }): string {
    return JSON.stringify(info);
  },
  assistantMessage(info: {
    text: string;
    toolCalls?: Array<{ id: string; name: string; args: string }>;
  }): string {
    return JSON.stringify(info);
  },
};
