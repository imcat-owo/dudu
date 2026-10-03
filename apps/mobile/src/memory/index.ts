/**
 * AI memory system — public API. PURE module: no React Native / expo imports.
 *
 * This is the backend for 记忆花园 (memory garden) in 我们的空间.
 * The garden UI (built by a separate worker) consumes this API:
 *
 *   gardenStateOf(record)  -> "blooming" | "sprouting" | "ask" | "wilted"
 *   store.listCurrent()    -> live cards (blooming/sprouting/ask)
 *   store.listMemories()   -> everything incl. wilted history
 *
 * The garden's own our-space memory store remains its UI-local cache; this
 * module is the canonical memory backend. Wiring the garden UI to read from
 * here is a follow-up for the garden worker (the mapping is 1:1).
 *
 * Storage note: AsyncStorage-backed (no expo-sqlite linked in this build).
 * The MemoryStore interface is storage-agnostic — see store.ts.
 */

import { buildMemorySection } from "./read-path.js";
import type { MemoryStore } from "./store.js";
import { createMemoryTools } from "./tools.js";
import { gardenStateOf } from "./types.js";
import { extractMemories, type MemoryTurn, shouldExtract } from "./write-path.js";

export { buildMemorySection } from "./read-path.js";
export { searchMemories, tokenize } from "./search.js";
export type { MemoryStorage } from "./store.js";
export { MemoryStore } from "./store.js";
export { createMemoryTools } from "./tools.js";
export type {
  GardenState,
  MemoryCategory,
  MemoryConfidence,
  MemoryEvent,
  MemoryRecord,
  ProfileEntry,
} from "./types.js";
export { gardenStateOf } from "./types.js";
export type { MemoryTurn } from "./write-path.js";
export {
  buildExtractionPrompt,
  extractMemories,
  looksSensitive,
  parseExtractionResult,
  shouldExtract,
} from "./write-path.js";

/**
 * Build the memory tools bound to a store instance (for local-agent).
 */
export function memoryToolsFor(store: MemoryStore) {
  return createMemoryTools(store);
}

/**
 * Read-path helper: memory section for this turn's prompt.
 * Returns "" when there's nothing to inject (honest empty state).
 */
export function memoryPromptSection(store: MemoryStore, userText: string): Promise<string> {
  return buildMemorySection(store, userText);
}

/**
 * Write-path helper: fire-and-forget async extraction.
 * Never throws, never blocks the reply. Skips incognito turns.
 *
 * @param store    the memory store
 * @param turn     the just-finished turn
 * @param isIncognito  live incognito state
 * @param complete LLM completion for extraction: (prompt) => Promise<string>
 */
export function extractMemoriesAsync(
  store: MemoryStore,
  turn: MemoryTurn,
  isIncognito: boolean,
  complete: (prompt: string) => Promise<string>,
): void {
  if (!shouldExtract(turn, isIncognito)) return;
  // Fire and forget — extraction must never break the chat.
  void extractMemories(store, turn, complete).catch(() => {});
}

export { gardenStateOf as memoryGardenState };
