/**
 * World books (lorebooks) — types + activation. PURE module.
 *
 * Learned from Kelivo's world_book.dart + world_book_activation.dart:
 * - A WorldBook holds ordered entries; each entry has keywords (or regex),
 *   priority, and injection position.
 * - Activation scans the recent chat context; matching entries are injected
 *   into the prompt by priority.
 * - Supports constant-active entries, sticky/cooldown timing, and scan depth.
 *
 * Simplified for Dudu: injection positions are before/after system prompt.
 * The local-agent wires the activated entries into the system prompt.
 */

/** Where an activated entry is injected. */
export type WorldBookPosition = "beforeSystem" | "afterSystem";

/** Where in the message the entry lands (role for the injected block). */
export type WorldBookRole = "system" | "user" | "assistant";

export interface WorldBookEntry {
  id: string;
  /** Display name. */
  name: string;
  enabled: boolean;
  /** Higher = injected first. */
  priority: number;
  position: WorldBookPosition;
  role: WorldBookRole;
  /** The lore text injected when triggered. */
  content: string;
  /** Keywords that trigger this entry (empty = only constantActive triggers). */
  keywords: string[];
  /** Treat keywords as RegExp. */
  useRegex: boolean;
  caseSensitive: boolean;
  /** How many recent messages to scan for keywords. */
  scanDepth: number;
  /** Always inject, no keyword needed. */
  constantActive: boolean;
  /** Keep active for N more messages after trigger. */
  sticky: number;
  /** Skip re-trigger for N messages after active. */
  cooldown: number;
  /** Don't trigger before N messages exist. */
  delay: number;
}

export interface WorldBook {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  entries: WorldBookEntry[];
  createdAt: number;
  updatedAt: number;
}

export function newWorldBookId(): string {
  return `wb_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function newWorldBookEntryId(): string {
  return `wbe_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function blankWorldBook(): WorldBook {
  const now = Date.now();
  return {
    id: newWorldBookId(),
    name: "",
    description: "",
    enabled: true,
    entries: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function blankWorldBookEntry(): WorldBookEntry {
  return {
    id: newWorldBookEntryId(),
    name: "",
    enabled: true,
    priority: 0,
    position: "afterSystem",
    role: "system",
    content: "",
    keywords: [],
    useRegex: false,
    caseSensitive: false,
    scanDepth: 5,
    constantActive: false,
    sticky: 0,
    cooldown: 0,
    delay: 0,
  };
}

/** One chat message for scanning (role + text). */
export interface ScanMessage {
  role: string;
  content: string;
}

/** Persistent activation state (sticky/cooldown) across calls. */
export interface WorldBookState {
  messageCount: number;
  /** entryKey -> { activatedAt: number } */
  effects: Record<string, { activatedAt: number }>;
}

export function blankWorldBookState(): WorldBookState {
  return { messageCount: 0, effects: {} };
}

function entryKey(bookId: string, entryId: string): string {
  return `${bookId}:${entryId}`;
}

/** Check if an entry matches the context text. */
export function worldBookMatches(entry: WorldBookEntry, context: string): boolean {
  if (!entry.enabled) return false;
  if (entry.constantActive) return true;
  for (const raw of entry.keywords) {
    const keyword = raw.trim();
    if (!keyword) continue;
    if (entry.useRegex) {
      try {
        const re = new RegExp(keyword, entry.caseSensitive ? "" : "i");
        if (re.test(context)) return true;
      } catch {
        // One bad pattern must not suppress the other keywords.
        continue;
      }
    } else if (
      entry.caseSensitive ? context.includes(keyword) : context.toLowerCase().includes(keyword.toLowerCase())
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Evaluate which entries activate given the recent messages.
 * Returns the activated entries (sorted by priority desc) and the new state.
 * Mirrors Kelivo's WorldBookActivation.evaluate.
 */
export function evaluateWorldBooks(
  books: WorldBook[],
  scanMessages: ScanMessage[],
  previous: WorldBookState = blankWorldBookState(),
): { entries: WorldBookEntry[]; state: WorldBookState } {
  const count = scanMessages.length;
  const effects: WorldBookState["effects"] = {};
  const triggered: { entry: WorldBookEntry; seq: number }[] = [];
  let seq = 0;

  // Build scan context once per depth needed.
  const contextCache = new Map<number, string>();
  function contextFor(depth: number): string {
    const d = Math.max(1, Math.min(200, depth));
    const hit = contextCache.get(d);
    if (hit !== undefined) return hit;
    const parts = scanMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => (m.content ?? "").trim())
      .filter((t) => t.length > 0)
      .slice(-d);
    const ctx = parts.join("\n");
    contextCache.set(d, ctx);
    return ctx;
  }

  for (const book of books) {
    if (!book.enabled) continue;
    for (const entry of book.entries) {
      const order = seq++;
      if (!entry.enabled || !entry.content.trim()) continue;
      const key = entryKey(book.id, entry.id);
      const prev = previous.effects[key];
      let active = false;
      if (prev && prev.activatedAt <= count) {
        const elapsed = count - prev.activatedAt;
        if (elapsed <= entry.sticky) {
          active = true;
          effects[key] = prev;
        } else if (elapsed <= entry.sticky + entry.cooldown) {
          effects[key] = prev;
          continue;
        }
      }
      if (!active) {
        if (count < entry.delay) continue;
        active = worldBookMatches(entry, contextFor(entry.scanDepth));
        if (active && (entry.sticky > 0 || entry.cooldown > 0)) {
          effects[key] = { activatedAt: count };
        }
      }
      if (active) triggered.push({ entry, seq: order });
    }
  }

  triggered.sort((a, b) => b.entry.priority - a.entry.priority || a.seq - b.seq);
  return {
    entries: triggered.map((t) => t.entry),
    state: { messageCount: count, effects },
  };
}

/** Group activated entries by injection position for prompt building. */
export function groupWorldBookEntries(entries: WorldBookEntry[]): {
  beforeSystem: WorldBookEntry[];
  afterSystem: WorldBookEntry[];
} {
  const beforeSystem: WorldBookEntry[] = [];
  const afterSystem: WorldBookEntry[] = [];
  for (const e of entries) {
    if (e.position === "beforeSystem") beforeSystem.push(e);
    else afterSystem.push(e);
  }
  return { beforeSystem, afterSystem };
}

/** Render activated entries as a prompt block. */
export function renderWorldBookBlock(entries: WorldBookEntry[]): string {
  if (entries.length === 0) return "";
  return entries.map((e) => e.content.trim()).filter(Boolean).join("\n\n");
}
