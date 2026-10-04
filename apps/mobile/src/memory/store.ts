/**
 * AI memory system — store. PURE module: no React Native / expo imports.
 *
 * Implements the approved 3-table logical schema on the injectable KV backend
 * (AsyncStorage in production, Map-backed fake in tests):
 *
 *   user_profile  -> KV "dudu.memory.v1.profile"  (JSON: Record<key, ProfileEntry>)
 *   memories      -> KV "dudu.memory.v1.memories" (JSON: MemoryRecord[])
 *   memory_events -> KV "dudu.memory.v1.events"   (JSON: MemoryEvent[], capped)
 *
 * The MemoryStore interface is storage-agnostic: replacing the KV backend
 * with expo-sqlite later changes only the two private load/save helpers.
 *
 * Privacy rules enforced here:
 * - delete() really deletes (plus an audit event with null memoryId).
 * - Nothing here ever reads incognito content — the write path (write-path.ts)
 *   is gated before it ever reaches the store.
 */

import {
  isMemoryCategory,
  isMemoryConfidence,
  type MemoryCategory,
  type MemoryConfidence,
  type MemoryEvent,
  type MemoryRecord,
  type ProfileEntry,
} from "./types.js";
import { createWriteChain } from "../util/write-chain";

/** Minimal storage surface. AsyncStorage satisfies this in production. */
export interface MemoryStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem?: (key: string) => Promise<void>;
}

const KEYS = {
  profile: "dudu.memory.v1.profile",
  memories: "dudu.memory.v1.memories",
  events: "dudu.memory.v1.events",
} as const;

/** Cap the audit log so it can't grow storage unbounded. */
export const MAX_EVENTS = 500;
/** Cap memories so one runaway can't fill the disk. */
export const MAX_MEMORIES = 2000;

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function isRecord(v: unknown): v is MemoryRecord {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.content === "string" &&
    isMemoryCategory(r.category) &&
    isMemoryConfidence(r.confidence) &&
    typeof r.validFrom === "number" &&
    (r.validTo === null || typeof r.validTo === "number") &&
    (r.supersededBy === null || typeof r.supersededBy === "string") &&
    // reinforcedCount is optional for records written before the field
    // existed — they normalize to 0 on load (see normalizeRecord).
    (r.reinforcedCount === undefined || typeof r.reinforcedCount === "number")
  );
}

/** Backfill reinforcedCount for records written before the field existed. */
function normalizeRecord(r: MemoryRecord): MemoryRecord {
  if (typeof r.reinforcedCount !== "number" || r.reinforcedCount < 0) {
    r.reinforcedCount = 0;
  }
  return r;
}

export class MemoryStore {
  constructor(private storage: MemoryStorage) {}

  // ---------- reactivity ----------
  private listeners = new Set<() => void>();

  /** Subscribe to any mutation. Returns unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch {
        // A broken listener must never break the store.
      }
    }
  }

  /**
   * Refresh after an out-of-band write (e.g. backup restore wrote
   * directly to storage). Re-emits so subscribers re-read from storage.
   */
  refresh(): void {
    this.emit();
  }

  // ---------- write serialization ----------
  // Mutations are read-modify-write on full JSON; serialize them so
  // concurrent writes (extract task + tool call) can't lose one.
  private exclusive = createWriteChain();

  private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    // The shared chain never breaks on a failed write; the caller still
    // sees the real error. Emit on success so the UI refreshes live.
    return this.exclusive(fn).then((v) => {
      this.emit();
      return v;
    });
  }

  // ---------- auto-extract preference ----------

  /** User-facing kill switch for background memory extraction (default on). */
  async getAutoExtract(): Promise<boolean> {
    try {
      const raw = await this.storage.getItem("dudu.memory.v1.autoExtract");
      return raw !== "0";
    } catch {
      return true;
    }
  }

  async setAutoExtract(on: boolean): Promise<void> {
    await this.storage.setItem("dudu.memory.v1.autoExtract", on ? "1" : "0");
    this.emit();
  }

  // ---------- low-level ----------

  private async loadMemories(): Promise<MemoryRecord[]> {
    try {
      const raw = await this.storage.getItem(KEYS.memories);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isRecord).map(normalizeRecord);
    } catch {
      return [];
    }
  }

  private async saveMemories(list: MemoryRecord[]): Promise<void> {
    // Oldest superseded records fall off first when capped — current
    // (validTo === null) records are never evicted by the cap.
    let capped = list;
    if (capped.length > MAX_MEMORIES) {
      const current = capped.filter((m) => m.validTo === null);
      const old = capped
        .filter((m) => m.validTo !== null)
        .sort((a, b) => (a.validTo ?? 0) - (b.validTo ?? 0));
      const keepOld = Math.max(0, MAX_MEMORIES - current.length);
      capped = [...current, ...old.slice(-keepOld)];
    }
    await this.storage.setItem(KEYS.memories, JSON.stringify(capped));
  }

  private async loadEvents(): Promise<MemoryEvent[]> {
    try {
      const raw = await this.storage.getItem(KEYS.events);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as MemoryEvent[]) : [];
    } catch {
      return [];
    }
  }

  private async logEvent(
    memoryId: string | null,
    op: MemoryEvent["op"],
    actor: "ai" | "user",
    note?: string,
  ): Promise<void> {
    const events = await this.loadEvents();
    events.push({ id: newId("evt"), memoryId, op, at: Date.now(), actor, note });
    await this.storage.setItem(KEYS.events, JSON.stringify(events.slice(-MAX_EVENTS)));
  }

  // ---------- user_profile ----------

  async getProfile(): Promise<ProfileEntry[]> {
    try {
      const raw = await this.storage.getItem(KEYS.profile);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return [];
      return Object.values(parsed as Record<string, ProfileEntry>).filter(
        (e): e is ProfileEntry => typeof e?.key === "string" && typeof e?.value === "string",
      );
    } catch {
      return [];
    }
  }

  async setProfile(key: string, value: string, actor: "ai" | "user" = "ai"): Promise<ProfileEntry> {
    return this.enqueueWrite(async () => {
      const k = key.trim();
      if (!k) throw new Error("Profile key must not be empty.");
      const v = value.trim();
      if (!v) throw new Error("Profile value must not be empty.");
      let raw: Record<string, ProfileEntry> = {};
      try {
        const existing = await this.storage.getItem(KEYS.profile);
        if (existing) {
          const parsed: unknown = JSON.parse(existing);
          if (typeof parsed === "object" && parsed !== null)
            raw = parsed as Record<string, ProfileEntry>;
        }
      } catch {
        raw = {};
      }
      const entry: ProfileEntry = { key: k, value: v, updatedAt: Date.now() };
      raw[k] = entry;
      await this.storage.setItem(KEYS.profile, JSON.stringify(raw));
      await this.logEvent(null, "profile_set", actor, k);
      return entry;
    });
  }

  async deleteProfile(key: string): Promise<boolean> {
    return this.enqueueWrite(async () => {
      let raw: Record<string, ProfileEntry> = {};
      try {
        const existing = await this.storage.getItem(KEYS.profile);
        if (existing) {
          const parsed: unknown = JSON.parse(existing);
          if (typeof parsed === "object" && parsed !== null)
            raw = parsed as Record<string, ProfileEntry>;
        }
      } catch {
        return false;
      }
      if (!(key in raw)) return false;
      delete raw[key];
      await this.storage.setItem(KEYS.profile, JSON.stringify(raw));
      return true;
    });
  }

  // ---------- memories ----------

  /** All memories, newest first. Includes superseded (wilted) ones. */
  async listMemories(): Promise<MemoryRecord[]> {
    const list = await this.loadMemories();
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Only currently-true memories (validTo === null). */
  async listCurrent(): Promise<MemoryRecord[]> {
    return (await this.loadMemories()).filter((m) => m.validTo === null);
  }

  async getMemory(id: string): Promise<MemoryRecord | null> {
    const list = await this.loadMemories();
    return list.find((m) => m.id === id) ?? null;
  }

  async addMemory(
    content: string,
    opts: {
      category?: MemoryCategory;
      confidence?: MemoryConfidence;
      source?: string;
      actor?: "ai" | "user";
    } = {},
  ): Promise<MemoryRecord> {
    return this.enqueueWrite(async () => {
      const list = await this.loadMemories();
      const rec = this.buildMemoryRecord(content, opts);
      list.push(rec);
      await this.saveMemories(list);
      await this.logEvent(rec.id, "add", opts.actor ?? "ai");
      return rec;
    });
  }

  /**
   * Add a memory only if `isDupe` (checked against the CURRENT list,
   * inside the same serialized write) says it isn't a duplicate.
   * Fixes the dedup TOCTOU: two overlapping extraction passes used to
   * read the same list outside the chain and both write the same
   * candidate. Returns null when skipped as a duplicate.
   */
  async addMemoryIfNew(
    content: string,
    opts: {
      category?: MemoryCategory;
      confidence?: MemoryConfidence;
      source?: string;
      actor?: "ai" | "user";
    } = {},
    isDupe?: (existingCurrent: MemoryRecord[]) => boolean,
  ): Promise<MemoryRecord | null> {
    return this.enqueueWrite(async () => {
      const list = await this.loadMemories();
      if (isDupe && isDupe(list.filter((m) => m.validTo === null))) return null;
      const rec = this.buildMemoryRecord(content, opts);
      list.push(rec);
      await this.saveMemories(list);
      await this.logEvent(rec.id, "add", opts.actor ?? "ai");
      return rec;
    });
  }

  private buildMemoryRecord(
    content: string,
    opts: {
      category?: MemoryCategory;
      confidence?: MemoryConfidence;
      source?: string;
      actor?: "ai" | "user";
    },
  ): MemoryRecord {
    const text = content.trim();
    if (!text) throw new Error("Memory content must not be empty.");
    if (text.length > 2000) throw new Error("Memory content too long (max 2000 chars).");
    const now = Date.now();
    return {
      id: newId("mem"),
      content: text,
      category: opts.category && isMemoryCategory(opts.category) ? opts.category : "other",
      confidence:
        opts.confidence && isMemoryConfidence(opts.confidence) ? opts.confidence : "unsure",
      validFrom: now,
      validTo: null,
      supersededBy: null,
      reinforcedCount: 0,
      source: (opts.source ?? "").slice(0, 300),
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Correct a memory. Temporal discipline: the old record is NOT overwritten —
   * it gets validTo + supersededBy, and a NEW record carries the correction.
   * History stays queryable ("以前是这样的").
   */
  async supersedeMemory(
    id: string,
    newContent: string,
    opts: { actor?: "ai" | "user"; source?: string } = {},
  ): Promise<MemoryRecord> {
    return this.enqueueWrite(async () => {
      const text = newContent.trim();
      if (!text) throw new Error("Memory content must not be empty.");
      const list = await this.loadMemories();
      const old = list.find((m) => m.id === id);
      if (!old) throw new Error(`Memory not found: ${id}.`);
      if (old.validTo !== null)
        throw new Error("That memory is already superseded; add a new one instead.");
      const now = Date.now();
      const next: MemoryRecord = {
        id: newId("mem"),
        content: text,
        category: old.category,
        confidence: old.confidence,
        validFrom: now,
        validTo: null,
        supersededBy: null,
        // A correction carries the reinforcement forward — she cared
        // enough to correct it, so it matters.
        reinforcedCount: old.reinforcedCount,
        source: (opts.source ?? old.source).slice(0, 300),
        createdAt: now,
        updatedAt: now,
      };
      old.validTo = now;
      old.supersededBy = next.id;
      old.updatedAt = now;
      list.push(next);
      await this.saveMemories(list);
      await this.logEvent(next.id, "supersede", opts.actor ?? "ai", `replaces ${old.id}`);
      return next;
    });
  }

  /**
   * Promote an unsure/question memory to confident — she confirmed it
   * in dialog (memory_confirm). Only the confidence changes.
   * Confirmation is also a reinforcement (design doc §8): reinforcedCount +1.
   */
  async confirmMemory(id: string, actor: "ai" | "user" = "user"): Promise<MemoryRecord> {
    return this.enqueueWrite(async () => {
      const list = await this.loadMemories();
      const rec = list.find((m) => m.id === id);
      if (!rec) throw new Error(`Memory not found: ${id}.`);
      if (rec.validTo !== null)
        throw new Error("That memory is superseded; confirm the current one instead.");
      rec.confidence = "confident";
      rec.reinforcedCount += 1;
      rec.updatedAt = Date.now();
      await this.saveMemories(list);
      await this.logEvent(rec.id, "confirm", actor);
      return rec;
    });
  }

  /**
   * Reinforcement (design doc §8): he naturally re-mentioned this memory
   * in conversation and she engaged with it ("对", elaborated, laughed —
   * anything that shows it landed). +1. Never throws for unknown ids —
   * reinforcement is a hint, not a command; the tool reports it.
   */
  async reinforceMemory(id: string, actor: "ai" | "user" = "ai"): Promise<MemoryRecord> {
    return this.enqueueWrite(async () => {
      const list = await this.loadMemories();
      const rec = list.find((m) => m.id === id);
      if (!rec) throw new Error(`Memory not found: ${id}.`);
      if (rec.validTo !== null)
        throw new Error("That memory is superseded; reinforce the current one instead.");
      rec.reinforcedCount += 1;
      rec.updatedAt = Date.now();
      await this.saveMemories(list);
      await this.logEvent(rec.id, "reinforce", actor);
      return rec;
    });
  }

  /**
   * Delete a memory — really deletes (her right). The audit log keeps
   * only the fact that a delete happened, not the content.
   */
  async deleteMemory(id: string, actor: "ai" | "user" = "user"): Promise<boolean> {
    return this.enqueueWrite(async () => {
      const list = await this.loadMemories();
      const idx = list.findIndex((m) => m.id === id);
      if (idx === -1) return false;
      list.splice(idx, 1);
      await this.saveMemories(list);
      await this.logEvent(null, "delete", actor, `deleted ${id}`);
      return true;
    });
  }

  /** Wipe everything (hers to decide). Returns counts. */
  async wipeAll(): Promise<{ memories: number; events: number }> {
    const mems = await this.loadMemories();
    const events = await this.loadEvents();
    await this.storage.setItem(KEYS.memories, "[]");
    await this.storage.setItem(KEYS.profile, "{}");
    // Keep one audit event so the wipe itself is on record.
    await this.storage.setItem(
      KEYS.events,
      JSON.stringify([
        {
          id: newId("evt"),
          memoryId: null,
          op: "delete",
          at: Date.now(),
          actor: "user" as const,
          note: "wipeAll",
        },
      ]),
    );
    return { memories: mems.length, events: events.length };
  }

  async listEvents(limit = 100): Promise<MemoryEvent[]> {
    const events = await this.loadEvents();
    return events.slice(-limit).reverse();
  }
}
