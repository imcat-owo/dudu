/**
 * AI memory system — write path. PURE module: no React Native / expo imports.
 *
 * Async extraction, OFF the critical path: after the AI replies, candidate
 * facts are distilled from the turn and written with confidence=unsure
 * (inferred) — never blocking the reply.
 *
 * Rules:
 * - Incognito turns NEVER enter this pipeline (gated by the caller via
 *   shouldExtract(); defense in depth — the store never sees them).
 * - User-told memories ("记住 X") always win: confidence=confident, actor=user.
 * - Dedup: check similar existing memories before adding (Mem0 step 2).
 * - Sensitive topics (IDs, credentials, health-adjacent PII) are NEVER
 *   auto-stored — they become `question` cards for her, or are skipped
 *   when clearly sensitive. When in doubt, mark unsure and let her decide.
 *
 * The LLM completion function is injected (the agent wires its own
 * transport), so this module stays testable without network.
 */

import { searchMemories } from "./search.js";
import type { MemoryStore } from "./store.js";
import type { MemoryCategory } from "./types.js";

/** A turn of conversation, for extraction. */
export interface MemoryTurn {
  userText: string;
  assistantText: string;
}

/** What the extractor decided about one candidate fact. */
export interface MemoryCandidate {
  content: string;
  category: MemoryCategory;
  /** Why this is worth remembering (for the audit log). */
  reason: string;
}

/**
 * Gate: should this turn go through extraction at all?
 * Incognito, empty, or tool-only turns are skipped.
 */
export function shouldExtract(turn: MemoryTurn, isIncognito: boolean): boolean {
  if (isIncognito) return false;
  const text = `${turn.userText} ${turn.assistantText}`.trim();
  if (text.length < 20) return false;
  return true;
}

/** Patterns that must NEVER be auto-stored (Claude-style sensitive handling). */
const SENSITIVE_PATTERNS: RegExp[] = [
  /\b\d{15,19}\b/, // card-like number runs
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, // email
  /密码|passwd|密钥|\bpassword\b|\bsecret\b|\btokens?\b|\b(api|secret)\s+keys?\b|\bkeys?\s*[:=]/i,
  /身份证|护照|社保|驾照/,
];

/** True when the text looks sensitive — do not auto-store as a fact. */
export function looksSensitive(text: string): boolean {
  return SENSITIVE_PATTERNS.some((re) => re.test(text));
}

/**
 * Extraction prompt: tiny, strict. The model returns one JSON array of
 * candidates, or []. Durable + personal + actionable only — chit-chat dropped.
 */
export function buildExtractionPrompt(turn: MemoryTurn): string {
  return [
    "You are a memory extractor for a personal AI companion. Read this conversation turn and extract durable facts worth remembering about the user.",
    "Rules:",
    "- Only extract facts that are durable (still true next month), personal (about her, her preferences, relationships, goals, habits), or actionable (change how you behave).",
    "- Drop ephemeral chit-chat, greetings, and one-off questions.",
    "- NEVER extract credentials, IDs, card numbers, passwords, or health details.",
    '- Output ONLY a JSON array, no other text. Each item: {"content": "one crisp sentence", "category": "preference|fact|relationship|goal|habit|other", "reason": "why this matters"}.',
    "- Empty array [] when nothing is worth remembering.",
    "",
    `User: ${turn.userText.slice(0, 2000)}`,
    `Assistant: ${turn.assistantText.slice(0, 2000)}`,
  ].join("\n");
}

/** Parse the extractor's JSON. Never throws — garbage yields []. */
export function parseExtractionResult(raw: string): MemoryCandidate[] {
  try {
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start) return [];
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    const out: MemoryCandidate[] = [];
    for (const item of parsed) {
      if (typeof item !== "object" || item === null) continue;
      const c = item as Record<string, unknown>;
      const content = typeof c.content === "string" ? c.content.trim() : "";
      if (!content || content.length > 500) continue;
      const category =
        typeof c.category === "string" &&
        ["preference", "fact", "relationship", "goal", "habit", "other"].includes(c.category)
          ? (c.category as MemoryCategory)
          : "other";
      out.push({
        content,
        category,
        reason: typeof c.reason === "string" ? c.reason.slice(0, 200) : "",
      });
    }
    return out.slice(0, 10);
  } catch {
    return [];
  }
}

/**
 * Run one async extraction pass over a turn. Never throws — extraction is
 * best-effort and must never break the chat.
 *
 * @param store    memory store
 * @param turn     the just-finished turn
 * @param complete injected LLM completion: (prompt) => Promise<string>
 */
export async function extractMemories(
  store: MemoryStore,
  turn: MemoryTurn,
  complete: (prompt: string) => Promise<string>,
): Promise<number> {
  try {
    const prompt = buildExtractionPrompt(turn);
    const raw = await complete(prompt);
    const candidates = parseExtractionResult(raw);
    if (candidates.length === 0) return 0;

    // Dedup: skip candidates that closely match an existing current memory.
    // The read+dedup+write happens inside the store's serialized write
    // (addMemoryIfNew) so two overlapping extraction passes can't both
    // read the same list and both write the same candidate (TOCTOU).
    let added = 0;
    for (const c of candidates) {
      if (looksSensitive(c.content)) continue;
      const normContent = c.content.replace(/\s+/g, "");
      const rec = await store.addMemoryIfNew(
        c.content,
        {
          category: c.category,
          confidence: "unsure",
          source: c.reason || "auto-extracted",
          actor: "ai",
        },
        (existing) => {
          // Exact (whitespace-normalized) match is always a dupe.
          if (existing.some((m) => m.content.replace(/\s+/g, "") === normContent)) return true;
          const similar = searchMemories(existing, c.content, { limit: 3 });
          return similar.some((s) => s.score > 2);
        },
      );
      if (rec) added++;
    }
    return added;
  } catch {
    return 0;
  }
}
