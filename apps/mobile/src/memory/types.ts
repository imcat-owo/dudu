/**
 * AI memory system — types. PURE module: no React Native / expo imports.
 *
 * The memory system is the backend for 记忆花园 (memory garden) in 我们的空间.
 * Confidence levels map to garden states:
 *   confident -> blooming (开花, 记得牢)
 *   unsure     -> sprouting (发芽, 拿不准, needs her confirmation)
 *   question   -> ask/seed (种子, 想问她的)
 *
 * Temporal discipline (borrowed from Zep/Graphiti): facts are NEVER silently
 * overwritten. When a fact changes, the old record gets valid_to + superseded_by
 * and a new record is created (Mem0-style ADD-only). History stays queryable.
 *
 * Storage note: the approved architecture calls for SQLite 3 tables. This
 * device build has no expo-sqlite linked, so the store below implements the
 * exact same logical schema (3 tables, FTS-style ranked search) on the
 * already-present AsyncStorage backend. The MemoryStore interface is
 * storage-agnostic — swapping in expo-sqlite later is a drop-in.
 */

/** Confidence of a memory card. */
export type MemoryConfidence = "confident" | "unsure" | "question";

/** Category of a memory card. */
export type MemoryCategory = "preference" | "fact" | "relationship" | "goal" | "habit" | "other";

/** One memory card (the unit the garden renders). */
export interface MemoryRecord {
  id: string;
  /** The fact, human-readable, one crisp sentence when possible. */
  content: string;
  category: MemoryCategory;
  confidence: MemoryConfidence;
  /** When this became true (unix ms). */
  validFrom: number;
  /** Null = currently true. Set when superseded (never deleted silently). */
  validTo: number | null;
  /** Id of the newer record that replaced this one, if any. */
  supersededBy: string | null;
  /**
   * Reinforcement count (design doc §8): +1 every time she confirms it
   * (memory_confirm) or he naturally re-mentions it in conversation and
   * she engages (memory_reinforce). Repeatedly surfaced memories are
   * remembered better — this is the retrieval weight for that.
   * Old records without the field normalize to 0 on load.
   */
  reinforcedCount: number;
  /** Where it came from: short chat excerpt, "user-told", "imported". */
  source: string;
  createdAt: number;
  updatedAt: number;
}

/** One user-profile entry — the always-in-context core (~20 lines). */
export interface ProfileEntry {
  key: string;
  value: string;
  updatedAt: number;
}

/** Audit log entry: every memory write, for transparency. */
export interface MemoryEvent {
  id: string;
  memoryId: string | null;
  op: "add" | "update" | "supersede" | "delete" | "confirm" | "reinforce" | "profile_set";
  at: number;
  /** Who did it: "ai" (tool/extraction) or "user" (she said so in dialog). */
  actor: "ai" | "user";
  note?: string;
}

/** Garden-facing view: what 记忆花园 renders. */
export type GardenState = "blooming" | "sprouting" | "ask" | "wilted";

/** Map a memory record to its garden state. */
export function gardenStateOf(m: MemoryRecord): GardenState {
  if (m.validTo !== null) return "wilted";
  switch (m.confidence) {
    case "confident":
      return "blooming";
    case "unsure":
      return "sprouting";
    case "question":
      return "ask";
  }
}

/** Categories the AI is allowed to use (validated on write). */
export const MEMORY_CATEGORIES: MemoryCategory[] = [
  "preference",
  "fact",
  "relationship",
  "goal",
  "habit",
  "other",
];

export function isMemoryCategory(v: unknown): v is MemoryCategory {
  return typeof v === "string" && (MEMORY_CATEGORIES as string[]).includes(v);
}

export function isMemoryConfidence(v: unknown): v is MemoryConfidence {
  return v === "confident" || v === "unsure" || v === "question";
}
