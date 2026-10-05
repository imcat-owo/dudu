/**
 * MCP tool approval card — PURE module (no React Native imports).
 *
 * D13: When the AI wants to call an MCP server tool whose per-tool approval
 * is "ask", the client (mcp/client.ts) pauses the call and the agent loop
 * (local-agent.ts) raises one of these requests. chat.tsx subscribes with
 * its dialog's threadId and renders a real in-session approval card
 * (mcp-approval-card.tsx): Allow / Deny / Remember-my-choice. Her choice
 * takes real effect:
 *   - allow  → the tool call proceeds,
 *   - deny   → the tool is blocked and the model gets honest feedback
 *              ("she declined the approval request"),
 *   - remember → her choice is persisted into the server's `toolApprovals`
 *              (mcp/types.ts) via mcpStore.upsert, so it sticks for
 *              subsequent calls.
 *
 * Pending requests are scoped to the dialog (threadId) that asked — same
 * isolation contract as ask_user (D17): a request raised in dialog A must
 * never surface in dialog B. A 5-minute safety timeout fails closed and
 * reports honestly instead of claiming she dismissed it (D20 pattern).
 */

export interface McpApprovalOutcome {
  /** True = run the tool, false = block it. */
  allowed: boolean;
  /** True = persist her choice into the server's toolApprovals. */
  remember: boolean;
}

export interface McpApprovalRequest {
  id: string;
  /** Owning dialog. "" = unscoped (legacy/tests) — visible everywhere. */
  threadId: string;
  /** Server + tool being asked about. */
  serverId: string;
  serverName: string;
  toolName: string;
  /** Short human-readable summary of the arguments (truncated). */
  argsSummary: string;
  resolve: (outcome: McpApprovalOutcome) => void;
  reject: (e: Error) => void;
  createdAt: number;
}

type Listener = (req: McpApprovalRequest | null) => void;

interface ListenerEntry {
  fn: Listener;
  /** Dialog this listener cares about. undefined = unfiltered (legacy). */
  threadId?: string;
}

const pending = new Map<string, McpApprovalRequest>();
const listeners = new Set<ListenerEntry>();
let seq = 0;

/**
 * A request is visible to a listener when it belongs to the listener's
 * dialog. Unscoped requests and unfiltered listeners keep the legacy
 * see-everything behavior.
 */
function visibleTo(req: McpApprovalRequest, listenerThreadId: string | undefined): boolean {
  if (!req.threadId) return true;
  if (listenerThreadId === undefined) return true;
  return req.threadId === listenerThreadId;
}

export function subscribeMcpApprovalRequest(
  listener: Listener,
  opts?: { threadId?: string },
): () => void {
  const entry: ListenerEntry = { fn: listener, threadId: opts?.threadId };
  listeners.add(entry);
  // Replay the first pending request for this dialog (e.g. UI remounted
  // mid-decision, or she switched back to this dialog).
  for (const req of pending.values()) {
    if (visibleTo(req, entry.threadId)) {
      listener(req);
      break;
    }
  }
  return () => {
    listeners.delete(entry);
  };
}

function emit(req: McpApprovalRequest | null, scopeThreadId?: string) {
  for (const e of listeners) {
    if (req) {
      if (!visibleTo(req, e.threadId)) continue;
    } else if (
      scopeThreadId !== undefined &&
      scopeThreadId !== "" &&
      e.threadId !== undefined &&
      e.threadId !== scopeThreadId
    ) {
      // A clear for another dialog: don't wipe this listener's card.
      continue;
    }
    e.fn(req);
  }
}

/**
 * Answer her decision. allowed=false fails closed: the tool is blocked and
 * the model is told she declined. remember=true persists into
 * toolApprovals (the caller wires that part via mcpStore).
 */
export function answerMcpApprovalRequest(id: string, outcome: McpApprovalOutcome): boolean {
  const req = pending.get(id);
  if (!req) return false;
  pending.delete(id);
  emit(null, req.threadId);
  req.resolve(outcome);
  return true;
}

/** Fail closed on dismiss/timeout — the model is told what actually happened. */
export function cancelMcpApprovalRequest(
  id: string,
  reason: "dismissed" | "timeout" = "dismissed",
): boolean {
  const req = pending.get(id);
  if (!req) return false;
  pending.delete(id);
  emit(null, req.threadId);
  req.reject(
    new Error(
      reason === "timeout"
        ? `Approval for MCP tool "${req.toolName}" timed out (she may not have seen it). Failing closed.`
        : `She dismissed the approval request for MCP tool "${req.toolName}". Failing closed.`,
    ),
  );
  return true;
}

/** For tests: how many requests are waiting. */
export function __pendingMcpApprovalCount(): number {
  return pending.size;
}

function summarizeArgs(args: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(args) ?? "";
  } catch {
    text = String(args);
  }
  if (!text || text === "{}" || text === "null") return "";
  const MAX = 300;
  return text.length > MAX ? `${text.slice(0, MAX - 1)}…` : text;
}

/**
 * Raise an approval request from the agent loop and wait for her decision.
 * Rejects (fail closed) after 5 minutes so the loop can't hang forever.
 */
export function requestMcpToolApproval(opts: {
  threadId: string;
  serverId: string;
  serverName: string;
  toolName: string;
  args: unknown;
}): Promise<McpApprovalOutcome> {
  const id = `mcpappr_${Date.now()}_${++seq}`;
  return new Promise<McpApprovalOutcome>((resolve, reject) => {
    const req: McpApprovalRequest = {
      id,
      threadId: opts.threadId,
      serverId: opts.serverId,
      serverName: opts.serverName,
      toolName: opts.toolName,
      argsSummary: summarizeArgs(opts.args),
      resolve,
      reject,
      createdAt: Date.now(),
    };
    pending.set(id, req);
    emit(req);
    const safetyTimer = setTimeout(
      () => {
        if (pending.has(id)) cancelMcpApprovalRequest(id, "timeout");
      },
      5 * 60 * 1000,
    );
    // Don't keep the process alive for this in tests.
    if (typeof safetyTimer === "object" && "unref" in safetyTimer) {
      (safetyTimer as unknown as { unref: () => void }).unref();
    }
  });
}
