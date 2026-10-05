/**
 * Import from Cherry Studio / ChatBox backups. PURE module.
 *
 * Learned from Kelivo's cherry_importer.dart + chatbox_importer.dart.
 *
 * Cherry Studio backup: a ZIP containing JSON files. Topics have `messages`
 * arrays; messages have `role`, `content`, `createdAt`. We extract topics as
 * Dudu threads.
 *
 * ChatBox backup: a JSON file with `conversations` array. Each conversation
 * has `messages` with `role`, `content`, `createdAt`.
 *
 * Both import as NEW threads (never overwriting). Returns counts for the UI.
 */

/** One imported message (normalized). */
export interface ImportedMessage {
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
}

/** One imported conversation. */
export interface ImportedConversation {
  /** Original ID from the source app (for dedup). */
  sourceId: string;
  name: string;
  messages: ImportedMessage[];
}

import { defaultThreadMeta } from "../chat/thread-versions.js";

/** Result of an import. */
export interface ImportResult {
  conversations: number;
  messages: number;
  skipped: number;
}

function normalizeRole(role: unknown): ImportedMessage["role"] {
  const r = String(role ?? "").toLowerCase();
  if (r === "user" || r === "human") return "user";
  if (r === "assistant" || r === "ai" || r === "bot") return "assistant";
  return "system";
}

function toText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    // OpenAI-style content parts.
    return content
      .map((p) => {
        if (typeof p === "string") return p;
        if (p && typeof p === "object") {
          const o = p as Record<string, unknown>;
          if (typeof o.text === "string") return o.text;
          if (o.type === "text" && typeof o.text === "string") return o.text;
        }
        return "";
      })
      .join("");
  }
  return String(content ?? "");
}

function toTime(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? Date.now() : t;
  }
  return Date.now();
}

/**
 * Parse a Cherry Studio backup JSON.
 * Cherry exports topics; each topic has id, name, messages[].
 * Accepts the raw JSON text (the data.json inside the ZIP, or a .json export).
 */
export function parseCherryBackup(jsonText: string): ImportedConversation[] {
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error("import-invalid-json");
  }
  const root = data as Record<string, unknown>;
  // Cherry nests under various keys depending on version.
  const topicsRaw =
    (Array.isArray(root.topics) ? root.topics : null) ??
    (Array.isArray((root.data as Record<string, unknown> | undefined)?.topics)
      ? (root.data as Record<string, unknown>).topics
      : null) ??
    [];
  const conversations: ImportedConversation[] = [];
  for (const t of topicsRaw as Record<string, unknown>[]) {
    if (!t || typeof t !== "object") continue;
    const id = String(t.id ?? t.topicId ?? "");
    if (!id) continue;
    const messages: ImportedMessage[] = [];
    const msgsRaw = Array.isArray(t.messages) ? t.messages : [];
    for (const m of msgsRaw as Record<string, unknown>[]) {
      if (!m || typeof m !== "object") continue;
      const content = toText(m.content ?? m.text);
      if (!content.trim()) continue;
      messages.push({
        role: normalizeRole(m.role),
        content,
        createdAt: toTime(m.createdAt ?? m.created_at ?? m.timestamp),
      });
    }
    if (messages.length === 0) continue;
    messages.sort((a, b) => a.createdAt - b.createdAt);
    conversations.push({
      sourceId: `cherry:${id}`,
      name: String(t.name ?? t.title ?? "导入的对话").slice(0, 100),
      messages,
    });
  }
  return conversations;
}

/**
 * Parse a ChatBox backup JSON.
 * ChatBox exports { conversations: [{ id, name, messages: [{ role, content }] }] }.
 */
export function parseChatBoxBackup(jsonText: string): ImportedConversation[] {
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error("import-invalid-json");
  }
  const root = data as Record<string, unknown>;
  const convsRaw = Array.isArray(root.conversations) ? root.conversations : [];
  const conversations: ImportedConversation[] = [];
  for (const c of convsRaw as Record<string, unknown>[]) {
    if (!c || typeof c !== "object") continue;
    const id = String(c.id ?? "");
    if (!id) continue;
    const messages: ImportedMessage[] = [];
    const msgsRaw = Array.isArray(c.messages) ? c.messages : [];
    for (const m of msgsRaw as Record<string, unknown>[]) {
      if (!m || typeof m !== "object") continue;
      const content = toText(m.content ?? m.text);
      if (!content.trim()) continue;
      messages.push({
        role: normalizeRole(m.role),
        content,
        createdAt: toTime(m.createdAt ?? m.created_at ?? m.timestamp),
      });
    }
    if (messages.length === 0) continue;
    messages.sort((a, b) => a.createdAt - b.createdAt);
    conversations.push({
      sourceId: `chatbox:${id}`,
      name: String(c.name ?? c.title ?? "导入的对话").slice(0, 100),
      messages,
    });
  }
  return conversations;
}

/**
 * Convert imported conversations to Dudu thread payloads.
 * Returns the number imported and skipped (already imported).
 */
export async function importConversations(
  conversations: ImportedConversation[],
  kv: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    getAllKeys(): Promise<readonly string[]>;
  },
  chatPrefix: string = "dudu.local-chat.",
  chatSuffix: string = ".v1",
): Promise<ImportResult> {
  let imported = 0;
  let messageCount = 0;
  let skipped = 0;

  // Find already-imported source IDs to avoid duplicates.
  const existingKeys = await kv.getAllKeys();
  const importedSources = new Set<string>();
  for (const key of existingKeys) {
    if (!key.startsWith(chatPrefix) || !key.endsWith(chatSuffix)) continue;
    try {
      const raw = await kv.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const src = parsed?.importedFrom;
      if (typeof src === "string") importedSources.add(src);
    } catch {
      // ignore corrupt
    }
  }

  for (const conv of conversations) {
    if (importedSources.has(conv.sourceId)) {
      skipped++;
      continue;
    }
    const threadId = `import_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    // Dudu thread format: the v2 envelope { v: 2, messages, meta } — the same
    // shape saveThreadData writes. Every reader requires it:
    // - chat screen / local-agent load via loadThreadData (needs v === 2)
    // - dialog list, cross-dialog AI tools, search read .messages and need
    //   id: string on every message (isVersionedMessage / isMessage).
    // Without the envelope and ids, imported threads read back EMPTY.
    const now = Date.now();
    const payload = {
      v: 2,
      importedFrom: conv.sourceId,
      importedName: conv.name,
      messages: conv.messages.map((m, i) => ({
        id: `import_${threadId}_${i}`,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })),
      meta: defaultThreadMeta(now),
    };
    await kv.setItem(`${chatPrefix}${threadId}${chatSuffix}`, JSON.stringify(payload));
    imported++;
    messageCount += conv.messages.length;
  }

  return { conversations: imported, messages: messageCount, skipped };
}
