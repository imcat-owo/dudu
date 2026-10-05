/**
 * dudu-exchange v1 — the versioned envelope for "带着历史搬家" (carrying
 * history across apps). Inspired by Aru's aru-collaborator-format v1.
 *
 * Two ways into Dudu:
 *  1. A dudu-backup file (kind "dudu-backup") — the full-fidelity path,
 *     restored by applyBackup in backup.ts.
 *  2. A dudu-exchange file (kind "dudu-exchange") — the portable path.
 *     A foreign app's export is converted (by an ExchangeAdapter) into this
 *     envelope first, then imported as NEW threads (never overwriting).
 *
 * Envelope shape:
 *   {
 *     "kind": "dudu-exchange",
 *     "version": 1,
 *     "source": { "app": "Cherry Studio", "appVersion": "…", "exportedAt": 123 },
 *     "personas": [ { "id", "name", "description?", "avatarUrl?" } ],
 *     "conversations": [ { "id", "name", "personaId?", "messages": [
 *        { "role": "user"|"assistant"|"system", "name?", "content", "createdAt" } ] } ],
 *     "memories": [ { "text", "createdAt?" } ]
 *   }
 *
 * Phase 1 scope: conversations are imported as new Dudu threads.
 * personas[] and memories[] are PARSED AND VALIDATED but not yet applied —
 * the envelope carries them so future versions can wire them up without
 * breaking the format. The manual says this honestly.
 *
 * PURE module — no RN imports.
 */

export const EXCHANGE_KIND = "dudu-exchange";
export const EXCHANGE_VERSION = 1;

export type ExchangeRole = "user" | "assistant" | "system";

export interface ExchangeMessage {
  role: ExchangeRole;
  /** Speaker display name (SillyTavern character name, group-chat speaker…). */
  name?: string;
  content: string;
  createdAt: number;
}

export interface ExchangeConversation {
  /** Original id in the source app (used for dedup). */
  id: string;
  name: string;
  personaId?: string;
  messages: ExchangeMessage[];
}

export interface ExchangePersona {
  id: string;
  name: string;
  description?: string;
  avatarUrl?: string;
}

export interface ExchangeMemory {
  text: string;
  createdAt?: number;
}

export interface ExchangeSource {
  app: string;
  appVersion?: string;
  exportedAt: number;
}

export interface DuduExchange {
  kind: typeof EXCHANGE_KIND;
  version: typeof EXCHANGE_VERSION;
  source: ExchangeSource;
  personas: ExchangePersona[];
  conversations: ExchangeConversation[];
  memories: ExchangeMemory[];
}

export type ExchangeParseError =
  | "empty"
  | "not-json"
  | "bad-kind"
  | "unsupported-version"
  | "invalid-shape";

export type ExchangeParseResult =
  | { ok: true; exchange: DuduExchange }
  | { ok: false; code: ExchangeParseError; detail?: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isRole(v: unknown): v is ExchangeRole {
  return v === "user" || v === "assistant" || v === "system";
}

function isMessage(v: unknown): v is ExchangeMessage {
  if (!isRecord(v)) return false;
  if (!isRole(v.role)) return false;
  if (typeof v.content !== "string" || !v.content.trim()) return false;
  if (typeof v.createdAt !== "number" || !Number.isFinite(v.createdAt)) return false;
  if (v.name !== undefined && typeof v.name !== "string") return false;
  return true;
}

function isConversation(v: unknown): v is ExchangeConversation {
  if (!isRecord(v)) return false;
  if (typeof v.id !== "string" || !v.id) return false;
  if (typeof v.name !== "string") return false;
  if (v.personaId !== undefined && typeof v.personaId !== "string") return false;
  if (!Array.isArray(v.messages) || !v.messages.every(isMessage)) return false;
  return true;
}

function isPersona(v: unknown): v is ExchangePersona {
  if (!isRecord(v)) return false;
  if (typeof v.id !== "string" || !v.id) return false;
  if (typeof v.name !== "string" || !v.name) return false;
  if (v.description !== undefined && typeof v.description !== "string") return false;
  if (v.avatarUrl !== undefined && typeof v.avatarUrl !== "string") return false;
  return true;
}

function isMemory(v: unknown): v is ExchangeMemory {
  if (!isRecord(v)) return false;
  if (typeof v.text !== "string" || !v.text.trim()) return false;
  if (v.createdAt !== undefined && typeof v.createdAt !== "number") return false;
  return true;
}

/**
 * Parse + validate an exchange file. Fails loudly with a machine-readable
 * code — a file from a NEWER dudu-exchange version is rejected cleanly
 * (never half-parsed).
 */
export function parseExchange(text: string): ExchangeParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, code: "empty" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch (e) {
    return {
      ok: false,
      code: "not-json",
      detail: e instanceof Error ? e.message : undefined,
    };
  }
  if (!isRecord(parsed)) return { ok: false, code: "invalid-shape" };
  if (parsed.kind !== EXCHANGE_KIND) {
    return { ok: false, code: "bad-kind", detail: `kind=${JSON.stringify(parsed.kind)}` };
  }
  if (typeof parsed.version !== "number" || parsed.version > EXCHANGE_VERSION) {
    return {
      ok: false,
      code: "unsupported-version",
      detail: `version=${JSON.stringify(parsed.version)}`,
    };
  }
  if (parsed.version < 1) return { ok: false, code: "invalid-shape" };
  const src = parsed.source;
  if (
    !isRecord(src) ||
    typeof src.app !== "string" ||
    !src.app ||
    typeof src.exportedAt !== "number"
  ) {
    return { ok: false, code: "invalid-shape" };
  }
  if (src.appVersion !== undefined && typeof src.appVersion !== "string") {
    return { ok: false, code: "invalid-shape" };
  }
  if (!Array.isArray(parsed.conversations) || !parsed.conversations.every(isConversation)) {
    return { ok: false, code: "invalid-shape" };
  }
  if (!Array.isArray(parsed.personas) || !parsed.personas.every(isPersona)) {
    return { ok: false, code: "invalid-shape" };
  }
  if (!Array.isArray(parsed.memories) || !parsed.memories.every(isMemory)) {
    return { ok: false, code: "invalid-shape" };
  }
  return { ok: true, exchange: parsed as unknown as DuduExchange };
}

/** Build a v1 envelope from adapter output (single source app). */
export function buildExchange(
  source: ExchangeSource,
  conversations: ExchangeConversation[],
  personas: ExchangePersona[] = [],
  memories: ExchangeMemory[] = [],
): DuduExchange {
  return {
    kind: EXCHANGE_KIND,
    version: EXCHANGE_VERSION,
    source,
    personas,
    conversations,
    memories,
  };
}
