/**
 * ask_env_form tool — PURE module (no React Native imports).
 *
 * D15: `ask_user` can only do multiple-choice. When the AI needs a secret
 * (an API key, an account password) it can't ask for it with buttons — it
 * needs a FORM card: variable name / account / secret / note (required),
 * URL (optional). The tool pauses the agent loop until she submits the
 * form in the UI; on submit the secret is written straight into envStore
 * (SecureStore) — the model NEVER sees the secret value, only the fact
 * that it was stored.
 *
 * Companion metadata (account / note / url) is stored alongside as
 * `<NAME>__META` (JSON) so the card can pre-fill on re-ask and nothing is
 * asked twice. `__META` entries are filtered out of the names list in the
 * settings UI; exact-key readers (web-search, ${VAR} expansion) are
 * unaffected.
 *
 * Wiring: the agent loop (local-agent.ts) registers these tools via
 * createEnvFormTools({ threadId }). The UI (chat.tsx) subscribes via
 * subscribeEnvFormRequest(listener, { threadId }) to render the form card,
 * then calls answerEnvFormRequest(id, result).
 *
 * Isolation: same contract as ask_user (D17) — a request raised in dialog A
 * must never surface in dialog B. The 5-minute safety timeout fails closed
 * and reports honestly (D20 pattern). Incognito: this is a persistent
 * write, so the tool is in the incognito blocklist (same as skill_import).
 */

import type { LocalTool } from "../api-groups/local-tools";
import { envStore } from "./env";

export const ENV_META_SUFFIX = "__META";

export interface EnvFormResult {
  /** Normalized env var name (UPPER_SNAKE). */
  name: string;
  /** Account / username she typed. */
  account: string;
  /** The secret — written to SecureStore, never returned to the model. */
  secret: string;
  /** Her note about what this is for. */
  note: string;
  /** Optional URL (docs page, console link, …). */
  url?: string;
}

export interface EnvFormRequest {
  id: string;
  /** Owning dialog. "" = unscoped (legacy/tests) — visible everywhere. */
  threadId: string;
  /** Suggested variable name (she can edit it on the card). */
  varName: string;
  /** Why the AI needs this — shown on the card. */
  reason: string;
  resolve: (result: EnvFormResult) => void;
  reject: (e: Error) => void;
  createdAt: number;
}

export type EnvFormCancelReason = "dismissed" | "timeout";

type Listener = (req: EnvFormRequest | null) => void;

interface ListenerEntry {
  fn: Listener;
  /** Dialog this listener cares about. undefined = unfiltered (legacy). */
  threadId?: string;
}

const pending = new Map<string, EnvFormRequest>();
const listeners = new Set<ListenerEntry>();
let seq = 0;

function visibleTo(req: EnvFormRequest, listenerThreadId: string | undefined): boolean {
  if (!req.threadId) return true;
  if (listenerThreadId === undefined) return true;
  return req.threadId === listenerThreadId;
}

export function subscribeEnvFormRequest(
  listener: Listener,
  opts?: { threadId?: string },
): () => void {
  const entry: ListenerEntry = { fn: listener, threadId: opts?.threadId };
  listeners.add(entry);
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

function emit(req: EnvFormRequest | null, scopeThreadId?: string) {
  for (const e of listeners) {
    if (req) {
      if (!visibleTo(req, e.threadId)) continue;
    } else if (
      scopeThreadId !== undefined &&
      scopeThreadId !== "" &&
      e.threadId !== undefined &&
      e.threadId !== scopeThreadId
    ) {
      continue;
    }
    e.fn(req);
  }
}

export function answerEnvFormRequest(id: string, result: EnvFormResult): boolean {
  const req = pending.get(id);
  if (!req) return false;
  pending.delete(id);
  emit(null, req.threadId);
  req.resolve(result);
  return true;
}

export function cancelEnvFormRequest(
  id: string,
  reason: EnvFormCancelReason = "dismissed",
): boolean {
  const req = pending.get(id);
  if (!req) return false;
  pending.delete(id);
  emit(null, req.threadId);
  req.reject(
    new Error(
      reason === "timeout"
        ? "No answer within 5 minutes (timed out — she may not have seen it)."
        : "She dismissed the form.",
    ),
  );
  return true;
}

/** For tests: how many requests are waiting. */
export function __pendingEnvFormCount(): number {
  return pending.size;
}

function normalizeName(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_");
}

function validateResult(raw: unknown): EnvFormResult {
  const o = (raw ?? {}) as Record<string, unknown>;
  const name = normalizeName(String(o.name ?? ""));
  if (!name) throw new Error("ask_env_form: variable name is required");
  const account = String(o.account ?? "").trim();
  if (!account) throw new Error("ask_env_form: account is required");
  const secret = String(o.secret ?? "");
  if (!secret) throw new Error("ask_env_form: secret is required");
  const note = String(o.note ?? "").trim();
  if (!note) throw new Error("ask_env_form: note is required");
  const url = String(o.url ?? "").trim();
  return url ? { name, account, secret, note, url } : { name, account, secret, note };
}

/**
 * Raise a form request from the agent loop and wait for her submission.
 * Rejects (fail closed) after 5 minutes so the loop can't hang forever.
 */
export function requestEnvForm(opts: {
  threadId: string;
  varName: string;
  reason: string;
}): Promise<EnvFormResult> {
  const id = `envform_${Date.now()}_${++seq}`;
  return new Promise<EnvFormResult>((resolve, reject) => {
    const req: EnvFormRequest = {
      id,
      threadId: opts.threadId,
      varName: opts.varName,
      reason: opts.reason,
      resolve,
      reject,
      createdAt: Date.now(),
    };
    pending.set(id, req);
    emit(req);
    const safetyTimer = setTimeout(
      () => {
        if (pending.has(id)) cancelEnvFormRequest(id, "timeout");
      },
      5 * 60 * 1000,
    );
    if (typeof safetyTimer === "object" && "unref" in safetyTimer) {
      (safetyTimer as unknown as { unref: () => void }).unref();
    }
  });
}

export function createEnvFormTools(opts?: { threadId?: string }): LocalTool[] {
  const ownerThreadId = opts?.threadId ?? "";
  return [
    {
      name: "ask_env_form",
      description:
        "Ask her to save a secret (API key, account password) via a form card — use this when you need a key you don't have and she agreed to provide it. She fills variable name / account / secret / note (URL optional) and the secret is stored securely; you never see the value. Only call this when she explicitly wants to save a key, or when a missing key blocks the task and she agreed to add one. Don't use it to fish for secrets she didn't offer.",
      parameters: {
        type: "object",
        properties: {
          varName: {
            type: "string",
            description:
              "Suggested environment variable name, e.g. TAVILY_API_KEY. She can edit it on the card.",
          },
          reason: {
            type: "string",
            description:
              "One sentence explaining what this key is for — shown on the card so she knows why you're asking.",
          },
        },
        required: ["varName", "reason"],
        additionalProperties: false,
      },
      manualId: "mcp-tools",
      run: async (args, _ctx) => {
        const varName = String(args.varName ?? "").trim();
        if (!varName) throw new Error("ask_env_form: 'varName' is required");
        const reason = String(args.reason ?? "").trim();
        if (!reason) throw new Error("ask_env_form: 'reason' is required");
        const result = validateResult(
          await requestEnvForm({ threadId: ownerThreadId, varName, reason }),
        );
        // Persist: secret under the name, companion metadata under <NAME>__META.
        await envStore.set(result.name, result.secret);
        await envStore.set(
          result.name + ENV_META_SUFFIX,
          JSON.stringify({
            account: result.account,
            note: result.note,
            ...(result.url ? { url: result.url } : {}),
            updatedAt: Date.now(),
          }),
        );
        // Never echo the secret back — the model only learns it was stored.
        return JSON.stringify({ stored: result.name });
      },
    },
  ];
}
