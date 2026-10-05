/**
 * ask_user tool — PURE module (no React Native imports).
 *
 * D3: When the model isn't sure, it calls `ask_user` with questions
 * (single-choice or multi-choice) instead of guessing. The tool pauses
 * the agent loop until she answers in the UI.
 *
 * Wiring: the agent loop (local-agent.ts) registers these tools via
 * createAskUserTools(). The UI (chat.tsx) subscribes via
 * subscribeAskUserRequest() to render the questions, then calls
 * answerAskUserRequest(id, answers).
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
  questions: AskUserQuestion[];
  resolve: (answers: Record<string, string | string[]>) => void;
  reject: (e: Error) => void;
  createdAt: number;
}

type Listener = (req: AskUserRequest | null) => void;

const pending = new Map<string, AskUserRequest>();
const listeners = new Set<Listener>();
let seq = 0;

export function subscribeAskUserRequest(listener: Listener): () => void {
  listeners.add(listener);
  // Replay any pending request (e.g. UI remounted mid-question).
  const first = pending.values().next();
  if (!first.done) listener(first.value);
  return () => {
    listeners.delete(listener);
  };
}

function emit(req: AskUserRequest | null) {
  for (const l of listeners) l(req);
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
  emit(null);
  req.resolve(answers);
  return true;
}

export function cancelAskUserRequest(id: string): boolean {
  const req = pending.get(id);
  if (!req) return false;
  pending.delete(id);
  emit(null);
  req.reject(new Error("She dismissed the question."));
  return true;
}

/** For tests: how many requests are waiting. */
export function __pendingAskUserCount(): number {
  return pending.size;
}

export function createAskUserTools(): LocalTool[] {
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
      run: async (args, _ctx) => {
        const questions = validateQuestions(args.questions);
        const id = `ask_${Date.now()}_${++seq}`;
        const answers = await new Promise<Record<string, string | string[]>>((resolve, reject) => {
          const req: AskUserRequest = {
            id,
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
              if (pending.has(id)) cancelAskUserRequest(id);
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
