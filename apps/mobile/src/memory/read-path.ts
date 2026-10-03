/**
 * AI memory system — read path. PURE module: no React Native / expo imports.
 *
 * Per turn, inject into the system prompt:
 *   1. user_profile (always — the Letta-style core, ~20 lines, tiny)
 *   2. top-k memories relevant to this turn's user text (a few hundred
 *      tokens max — the Mem0-style token saving)
 *
 * The section is clearly labeled so the model knows what is certain
 * (confident) vs what needs confirmation (unsure) vs what is an open
 * question. The AI must NEVER present an unsure memory as confident.
 */

import { searchMemories } from "./search.js";
import type { MemoryStore } from "./store.js";

/** Hard token-ish budget for the memory section (chars ≈ tokens for CJK). */
export const MEMORY_SECTION_BUDGET = 1200;
/** Max memories injected per turn. */
export const MEMORY_TOP_K = 5;

function fmtConfidence(c: string): string {
  switch (c) {
    case "confident":
      return "certain";
    case "unsure":
      return "unsure — confirm with her before acting on this";
    case "question":
      return "open question for her";
    default:
      return c;
  }
}

/**
 * Build the memory section for the system prompt. Never throws — an empty
 * memory store yields an empty string (honest empty state, no filler).
 *
 * @param store  the memory store
 * @param userText  the current turn's user message (for relevance ranking)
 */
export async function buildMemorySection(store: MemoryStore, userText: string): Promise<string> {
  const lines: string[] = [];

  // 1. Core profile — always in context.
  try {
    const profile = await store.getProfile();
    if (profile.length > 0) {
      lines.push("About her (your core profile — always true):");
      for (const p of profile.slice(0, 25)) {
        lines.push(`- ${p.key}: ${p.value}`);
      }
    }
  } catch {
    // Profile read failure: skip silently, never break the prompt.
  }

  // 2. Top-k relevant memories.
  try {
    const all = await store.listCurrent();
    const hits = searchMemories(all, userText, { limit: MEMORY_TOP_K });
    if (hits.length > 0) {
      lines.push("Relevant memories (use naturally; unsure ones need her confirmation first):");
      for (const h of hits) {
        const m = h.record;
        lines.push(`- [${fmtConfidence(m.confidence)}] ${m.content} (id: ${m.id})`);
      }
    }
  } catch {
    // Search failure: skip silently, never break the prompt.
  }

  if (lines.length === 0) return "";
  let section = `Your memory of her:\n${lines.join("\n")}`;
  // Hard budget — cut from the end (memories go before profile would be
  // wrong; profile is more important, so trim memory lines first).
  if (section.length > MEMORY_SECTION_BUDGET) {
    section = `${section.slice(0, MEMORY_SECTION_BUDGET - 3)}...`;
  }
  return section;
}
