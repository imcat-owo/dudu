/**
 * Exchange import engine — foreign app export -> Dudu threads.
 *
 * Flow: detect adapter -> parse to dudu-exchange v1 -> import conversations
 * as NEW threads (never overwriting). Dedup is by source id, so importing
 * the same file twice is a no-op for already-imported conversations.
 *
 * Safety: validation happens BEFORE any write. A file no adapter recognizes,
 * or a corrupt file, fails with a human-readable code and writes nothing.
 *
 * PURE module — storage surface is injected (AsyncStorage in prod).
 */

import {
  type ImportedConversation,
  type ImportResult,
  importConversations,
} from "../backup/import.js";
import { detectAdapter, type ExchangeAdapter, getAdapter } from "./adapters.js";
import {
  buildExchange,
  type DuduExchange,
  type ExchangeConversation,
  type ExchangeParseError,
  parseExchange,
} from "./types.js";

export interface KeyValueLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
}

export type ExchangeImportError =
  | ExchangeParseError
  | "unknown-source"
  | "import-invalid-json"
  | "import-no-conversations";

export interface ExchangeImportOk {
  ok: true;
  /** The adapter that handled the file. */
  adapter: ExchangeAdapter;
  /** The normalized v1 envelope (kept for inspection/debugging). */
  exchange: DuduExchange;
  result: ImportResult;
}

export type ExchangeImportOutcome =
  | ExchangeImportOk
  | { ok: false; code: ExchangeImportError; detail?: string };

/**
 * Import a foreign app's export file. Writes nothing unless the file is
 * fully recognized and parsed. Pass adapterId to force a specific adapter
 * (the UI's per-app buttons); omit it for auto-detect.
 */
export async function importExchange(
  text: string,
  kv: KeyValueLike,
  adapterId?: string,
): Promise<ExchangeImportOutcome> {
  if (!text.trim()) return { ok: false, code: "empty" };
  // A dudu-exchange v1 file goes straight through (no adapter needed).
  // DEFERRED (final audit 2026-10-06): routing sniffs for the literal
  // '"dudu-exchange"' string — a foreign file containing that string would
  // be misrouted (then cleanly rejected by parseExchange). Probability is
  // negligible; a content-type-aware router can replace this later.
  if (text.includes('"dudu-exchange"')) {
    const parsed = parseExchange(text);
    if (!parsed.ok) return { ok: false, code: parsed.code, detail: parsed.detail };
    const convs: ImportedConversation[] = parsed.exchange.conversations.map((c) => ({
      sourceId: `exchange:${c.id}`,
      name: c.name,
      messages: c.messages.map((m) => ({
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })),
    }));
    const result = await importConversations(convs, kv);
    return {
      ok: true,
      adapter: {
        id: "dudu-exchange",
        appName: "Dudu 交换格式",
        fileHint: ".json",
        detect: () => true,
        parse: () => [],
      },
      exchange: parsed.exchange,
      result,
    };
  }
  const adapter = adapterId ? getAdapter(adapterId) : detectAdapter(text);
  if (!adapter) return { ok: false, code: "unknown-source" };
  let convs: ExchangeConversation[];
  try {
    convs = adapter.parse(text);
  } catch (e) {
    const code = e instanceof Error ? e.message : "import-invalid-json";
    if (code === "import-invalid-json" || code === "import-no-conversations") {
      return { ok: false, code };
    }
    return { ok: false, code: "import-invalid-json", detail: code };
  }
  const exchange = buildExchange({ app: adapter.appName, exportedAt: Date.now() }, convs);
  const imported: ImportedConversation[] = convs.map((c) => ({
    sourceId: c.id,
    name: c.name,
    messages: c.messages.map((m) => ({
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
    })),
  }));
  const result = await importConversations(imported, kv);
  return { ok: true, adapter, exchange, result };
}
