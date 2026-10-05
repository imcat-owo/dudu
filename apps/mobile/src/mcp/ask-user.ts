/**
 * ask_user tool — PURE module (no React Native imports).
 *
 * D3: When the model isn't sure, it calls `ask_user` with questions
 * (single-choice or multi-choice) instead of guessing. The tool pauses
 * the agent loop until she answers in the UI.
 *
 * D17: pending requests are scoped to the dialog (threadId) that asked.
 * A question asked in dialog A must never surface in dialog B — the UI
 * subscribes with its own threadId and only receives matching requests.
 *
 * D20: the 5-minute safety timeout reports honestly ("timed out — she may
 * not have seen it") instead of claiming she dismissed the question.
 *
 * Wiring: the agent loop (local-agent.ts) registers these tools via
 * createAskUserTools({ threadId }). The UI (chat.tsx) subscribes via
 * subscribeAskUserRequest(listener, { threadId }) to render the questions,
 * then calls answerAskUserRequest(id, answers).
 */

import type { LocalTool } from "../api-groups/local-tools";

export type AskUserQuestionKind = "single" | "multi";

export interface AskUserQuestion {
  id: string;
  question: string;
  kind: AskUserQuestionKind;
  options: string[];
}

export interface AskUserRequest {
  id: string;
  /** Owning dialog. "" = unscoped (legacy/tests) — visible everywhere. */
  threadId: string;
  questions: AskUserQuestion[];
  resolve: (answers: Record<string, string | string[]>) => void;
  reject: (e: Error) => void;
  createdAt: number;
}

export type AskUserCancelReason = "dismissed" | "timeout";

type Listener = (req: AskUserRequest | null) => void;

interface ListenerEntry {
  fn: Listener;
  /** Dialog this listener cares about. undefined = unfiltered (legacy). */
  threadId?: string;
}

const pending = new Map<string, AskUserRequest>();
const listeners = new Set<ListenerEntry>();
let seq = 0;

/**
 * A request is visible to a listener when it belongs to the listener's
 * dialog. Unscoped requests and unfiltered listeners keep the legacy
 * see-everything behavior.
 */
function visibleTo(req: AskUserRequest, listenerThreadId: string | undefined): boolean {
  if (!req.threadId) return true;
  if (listenerThreadId === undefined) return true;
  return req.threadId === listenerThreadId;
}

export function subscribeAskUserRequest(
  listener: Listener,
  opts?: { threadId?: string },
): () => void {
  const entry: ListenerEntry = { fn: listener, threadId: opts?.threadId };
  listeners.add(entry);
  // Replay the first pending request for this dialog (e.g. UI remounted
  // mid-question, or user switched back to this dialog).
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

function emit(req: AskUserRequest | null, scopeThreadId?: string) {
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

function validateQuestions(raw: unknown): AskUserQuestion[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("ask_user: 'questions' must be a non-empty array");
  }
  if (raw.length > 4) throw new Error("ask_user: at most 4 questions per call");
  return raw.map((q, i) => {
    const o = q as Record<string, unknown>;
    const question = String(o.question ?? "").trim();
    if (!question) throw new Error(`ask_user: question ${i + 1} has no text`);
    const kind = o.kind === "multi" ? "multi" : "single";
    const options = Array.isArray(o.options)
      ? (o.options as unknown[]).map((x) => String(x)).slice(0, 8)
      : [];
    return {
      id: String(o.id ?? `q${i + 1}`),
      question,
      kind,
      options,
    };
  });
}

export function answerAskUserRequest(
  id: string,
  answers: Record<string, string | string[]>,
): boolean {
  const req = pending.get(id);
  if (!req) return false;
  pending.delete(id);
  emit(null, req.threadId);
  req.resolve(answers);
  return true;
}

export function cancelAskUserRequest(
  id: string,
  reason: AskUserCancelReason = "dismissed",
): boolean {
  const req = pending.get(id);
  if (!req) return false;
  pending.delete(id);
  emit(null, req.threadId);
  req.reject(
    new Error(
      reason === "timeout"
        ? "No answer within 5 minutes (timed out — she may not have seen it)."
        : "She dismissed the question.",
    ),
  );
  return true;
}

/** For tests: how many requests are waiting. */
export function __pendingAskUserCount(): number {
  return pending.size;
}

export function createAskUserTools(opts?: { threadId?: string }): LocalTool[] {
  // The dialog that owns this agent instance. Requests carry it so the UI
  // only ever surfaces them in the dialog that asked (D17).
  const ownerThreadId = opts?.threadId ?? "";
  return [
    {
      name: "ask_user",
      description:
        "Ask her a question when you're not sure — single-choice or multi-choice. Use this instead of guessing when her preference matters. She'll tap her answers and you'll get them back. Don't overuse it; only ask when you genuinely can't decide.",
      parameters: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            description: "1-4 questions to ask.",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Stable id for this question." },
                question: { type: "string", description: "The question text." },
                kind: {
                  type: "string",
                  enum: ["single", "multi"],
                  description: "'single' = pick one, 'multi' = pick any number.",
                },
                options: {
                  type: "array",
                  items: { type: "string" },
                  description: "Up to 8 options. She can also type her own.",
                },
              },
              required: ["question"],
              additionalProperties: false,
            },
          },
        },
        required: ["questions"],
        additionalProperties: false,
      },
      manualId: "mcp-tools",
      run: async (args, _ctx) => {
        const questions = validateQuestions(args.questions);
        const id = `ask_${Date.now()}_${++seq}`;
        const answers = await new Promise<Record<string, string | string[]>>((resolve, reject) => {
          const req: AskUserRequest = {
            id,
            threadId: ownerThreadId,
            questions,
            resolve,
            reject,
            createdAt: Date.now(),
          };
          pending.set(id, req);
          emit(req);
          // Safety: auto-cancel after 5 minutes so the loop can't hang forever.
          const safetyTimer = setTimeout(
            () => {
              if (pending.has(id)) cancelAskUserRequest(id, "timeout");
            },
            5 * 60 * 1000,
          );
          // Don't keep the process alive for this in tests.
          if (typeof safetyTimer === "object" && "unref" in safetyTimer) {
            (safetyTimer as unknown as { unref: () => void }).unref();
          }
        });
        return JSON.stringify({ answers });
      },
    },
  ];
}
