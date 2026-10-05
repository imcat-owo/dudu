/**
 * Exchange adapters — one per foreign app. Each adapter turns that app's
 * export file into dudu-exchange v1 conversations.
 *
 * Adapter contract:
 *  - detect(text): fast, never-throwing structural check.
 *  - parse(text): full parse; throws Error("import-invalid-json") on bad JSON
 *    and Error("import-no-conversations") when nothing importable is found.
 *  - parse never invents content: empty messages are dropped, never padded.
 *
 * Cherry Studio / ChatBox adapters wrap the battle-tested parsers in
 * backup/import.ts (Kelivo-derived). SillyTavern is a best-effort sketch
 * against the documented JSONL chat format (line 0 optional metadata
 * {user_name, character_name}; one JSON per line with
 * {name, is_user, is_system, mes, send_date, swipes, swipe_id}).
 *
 * PURE module — no RN imports.
 */

import {
  type ImportedConversation,
  parseChatBoxBackup,
  parseCherryBackup,
} from "../backup/import.js";
import type { ExchangeConversation, ExchangeMessage } from "./types.js";

/** A foreign app's import adapter. */
export interface ExchangeAdapter {
  /** Stable id, e.g. "cherry". */
  id: string;
  /** Human display name, e.g. "Cherry Studio". */
  appName: string;
  /** File hint shown in the picker UI. */
  fileHint: string;
  /** Fast structural check — never throws. */
  detect(text: string): boolean;
  /** Full parse — throws on bad JSON or nothing importable. */
  parse(text: string): ExchangeConversation[];
}

function toExchange(conv: ImportedConversation): ExchangeConversation {
  const messages: ExchangeMessage[] = conv.messages.map((m) => ({
    role: m.role,
    content: m.content,
    createdAt: m.createdAt,
  }));
  return { id: conv.sourceId, name: conv.name, messages };
}

function ensureNonEmpty(convs: ExchangeConversation[]): ExchangeConversation[] {
  if (convs.length === 0) {
    throw new Error("import-no-conversations");
  }
  return convs;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("import-invalid-json");
  }
}

const cherryAdapter: ExchangeAdapter = {
  id: "cherry",
  appName: "Cherry Studio",
  fileHint: "data.json / .json",
  detect(text: string): boolean {
    const t = text.trim();
    if (!t.startsWith("{")) return false;
    try {
      const root = JSON.parse(t) as Record<string, unknown>;
      return (
        Array.isArray(root.topics) ||
        (root.data !== null &&
          typeof root.data === "object" &&
          Array.isArray((root.data as Record<string, unknown>).topics))
      );
    } catch {
      return false;
    }
  },
  parse(text: string): ExchangeConversation[] {
    return ensureNonEmpty(parseCherryBackup(text).map(toExchange));
  },
};

const chatboxAdapter: ExchangeAdapter = {
  id: "chatbox",
  appName: "ChatBox",
  fileHint: ".json",
  detect(text: string): boolean {
    const t = text.trim();
    if (!t.startsWith("{")) return false;
    try {
      const root = JSON.parse(t) as Record<string, unknown>;
      return Array.isArray(root.conversations) && !Array.isArray(root.topics);
    } catch {
      return false;
    }
  },
  parse(text: string): ExchangeConversation[] {
    return ensureNonEmpty(parseChatBoxBackup(text).map(toExchange));
  },
};

/** SillyTavern JSONL chat export. Best-effort sketch, documented format. */
const sillytavernAdapter: ExchangeAdapter = {
  id: "sillytavern",
  appName: "SillyTavern",
  fileHint: ".jsonl",
  detect(text: string): boolean {
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return false;
    // Metadata line or a message line with ST's signature fields.
    for (const line of lines.slice(0, 3)) {
      try {
        const o = JSON.parse(line) as Record<string, unknown>;
        if (
          (typeof o.user_name === "string" && typeof o.character_name === "string") ||
          (typeof o.mes === "string" && typeof o.is_user === "boolean")
        ) {
          return true;
        }
      } catch {
        return false;
      }
    }
    return false;
  },
  parse(text: string): ExchangeConversation[] {
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) throw new Error("import-invalid-json");
    let characterName = "";
    let userName = "";
    let startIdx = 0;
    // Line 0 may be metadata: {user_name, character_name, create_date}.
    try {
      const first = JSON.parse(lines[0]) as Record<string, unknown>;
      if (typeof first.character_name === "string" && typeof first.mes !== "string") {
        characterName = first.character_name;
        if (typeof first.user_name === "string") userName = first.user_name;
        startIdx = 1;
      }
    } catch {
      throw new Error("import-invalid-json");
    }
    const messages: ExchangeMessage[] = [];
    for (let i = startIdx; i < lines.length; i++) {
      let o: Record<string, unknown>;
      try {
        o = JSON.parse(lines[i]) as Record<string, unknown>;
      } catch {
        throw new Error("import-invalid-json");
      }
      if (o.is_system === true) continue; // system prompt lines are not chat
      const raw =
        Array.isArray(o.swipes) && typeof o.swipe_id === "number" ? o.swipes[o.swipe_id] : o.mes;
      const content = typeof raw === "string" ? raw.trim() : "";
      if (!content) continue;
      const createdAt =
        typeof o.send_date === "string" && !Number.isNaN(Date.parse(o.send_date))
          ? Date.parse(o.send_date)
          : Date.now();
      messages.push({
        role: o.is_user === true ? "user" : "assistant",
        name: typeof o.name === "string" ? o.name : undefined,
        content,
        createdAt,
      });
    }
    if (messages.length === 0) throw new Error("import-no-conversations");
    messages.sort((a, b) => a.createdAt - b.createdAt);
    // Stable-ish source id: character + first message hash (best effort dedup).
    const seed = `${characterName}|${userName}|${messages[0].content.slice(0, 64)}`;
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
    const name = characterName || "SillyTavern 对话";
    return [
      {
        id: `sillytavern:${(hash >>> 0).toString(36)}`,
        name: name.slice(0, 100),
        messages,
      },
    ];
  },
};

/** All adapters, in detect() try order. */
export const EXCHANGE_ADAPTERS: ExchangeAdapter[] = [
  cherryAdapter,
  chatboxAdapter,
  sillytavernAdapter,
];

/** Pick the first adapter whose detect() matches. Null = unknown file. */
export function detectAdapter(text: string): ExchangeAdapter | null {
  for (const a of EXCHANGE_ADAPTERS) {
    try {
      if (a.detect(text)) return a;
    } catch {
      // detect() must never throw, but stay safe anyway
    }
  }
  return null;
}

/** Look up an adapter by id. */
export function getAdapter(id: string): ExchangeAdapter | null {
  return EXCHANGE_ADAPTERS.find((a) => a.id === id) ?? null;
}

// Re-export for tests/docs that want the raw parsers.
export { safeJsonParse };
