/**
 * Memory-driven next-day follow-up （次日跟进） — item store.
 * AsyncStorage-backed, write-serialized, injectable storage for tests.
 *
 * A follow-up item is the memory of a promise: she mentioned a
 * future-dated event, and he will ask about it the day after, once.
 * The actual scheduling/delivery rides on the initiative engine
 * (one_time rule) — this store holds the follow-up metadata the
 * initiative rule doesn't know: what, when the event was, keywords
 * for the auto-cancel check, and lifecycle status.
 */

export type FollowupStatus = "active" | "done" | "cancelled";

export interface FollowupItem {
  id: string;
  /** The backing one_time initiative rule. */
  ruleId: string;
  personaId: string;
  /** The event, e.g. "面试". */
  what: string;
  /** Her date phrase, e.g. "明天", "下周三". */
  eventLabel: string;
  /** Shanghai day start (ms) of the event date. */
  eventDateMs: number;
  /** When the follow-up fires (event day + 1, 17:00 Shanghai). */
  followUpAtMs: number;
  /** Keywords for the "already discussed" auto-cancel check. */
  keywords: string[];
  status: FollowupStatus;
  createdAt: number;
  /**
   * threadId -> message count at creation. The auto-cancel check only
   * looks at messages NEWER than this baseline, so her original
   * "我明天有个面试" never counts as "already discussed".
   */
  baselineCounts: Record<string, number>;
}

const KEYS = {
  items: "dudu.followup.v1.items",
  enabled: "dudu.followup.v1.enabled",
} as const;

const ITEMS_CAP = 500;

export interface FollowupStorage {
  getItem(k: string): Promise<string | null>;
  setItem(k: string, v: string): Promise<void>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function sanitizeItem(v: unknown): FollowupItem | null {
  if (!isRecord(v)) return null;
  const {
    id,
    ruleId,
    personaId,
    what,
    eventLabel,
    eventDateMs,
    followUpAtMs,
    keywords,
    status,
    createdAt,
    baselineCounts,
  } = v;
  if (typeof id !== "string" || !id) return null;
  if (typeof ruleId !== "string" || !ruleId) return null;
  if (typeof personaId !== "string" || !personaId) return null;
  if (typeof what !== "string" || !what) return null;
  if (typeof eventDateMs !== "number" || typeof followUpAtMs !== "number") return null;
  const st: FollowupStatus =
    status === "done" ? "done" : status === "cancelled" ? "cancelled" : "active";
  return {
    id,
    ruleId,
    personaId,
    what,
    eventLabel: typeof eventLabel === "string" ? eventLabel : "",
    eventDateMs,
    followUpAtMs,
    keywords: Array.isArray(keywords)
      ? keywords.filter((k): k is string => typeof k === "string")
      : [],
    status: st,
    createdAt: typeof createdAt === "number" ? createdAt : 0,
    baselineCounts: isRecord(baselineCounts)
      ? (() => {
          const out: Record<string, number> = {};
          for (const [k, n] of Object.entries(baselineCounts)) {
            if (typeof n === "number") out[k] = n;
          }
          return out;
        })()
      : {},
  };
}

export function newFollowupId(nowMs: number = Date.now()): string {
  return `fu_${nowMs.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export class FollowupStore {
  private writeChain: Promise<void> = Promise.resolve();
  private readonly nowMs: () => number;

  constructor(
    private storage: FollowupStorage,
    opts?: { nowMs?: () => number },
  ) {
    this.nowMs = opts?.nowMs ?? (() => Date.now());
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.writeChain;
    const cur = (async () => {
      await prev;
      return fn();
    })();
    this.writeChain = cur.then(
      () => {},
      () => {},
    );
    return cur;
  }

  private async loadItems(): Promise<FollowupItem[]> {
    try {
      const raw = await this.storage.getItem(KEYS.items);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(sanitizeItem).filter((r): r is FollowupItem => r !== null);
    } catch {
      return [];
    }
  }

  private async saveItems(items: FollowupItem[]): Promise<void> {
    const capped = items.length > ITEMS_CAP ? items.slice(items.length - ITEMS_CAP) : items;
    await this.storage.setItem(KEYS.items, JSON.stringify(capped));
  }

  async list(includeDone = true): Promise<FollowupItem[]> {
    const items = await this.loadItems();
    const filtered = includeDone ? items : items.filter((i) => i.status === "active");
    return [...filtered].sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Active items due at or before nowMs, oldest first. */
  async listDue(nowMs: number): Promise<FollowupItem[]> {
    const items = await this.loadItems();
    return items
      .filter((i) => i.status === "active" && i.followUpAtMs <= nowMs)
      .sort((a, b) => a.followUpAtMs - b.followUpAtMs);
  }

  async get(id: string): Promise<FollowupItem | null> {
    const items = await this.loadItems();
    return items.find((i) => i.id === id) ?? null;
  }

  /** An active item for the same persona + same event (dedup). */
  async findActive(personaId: string, what: string): Promise<FollowupItem | null> {
    const items = await this.loadItems();
    const norm = what.trim();
    return (
      items.find((i) => i.status === "active" && i.personaId === personaId && i.what === norm) ??
      null
    );
  }

  async create(input: {
    ruleId: string;
    personaId: string;
    what: string;
    eventLabel: string;
    eventDateMs: number;
    followUpAtMs: number;
    keywords: string[];
    baselineCounts: Record<string, number>;
  }): Promise<FollowupItem> {
    return this.exclusive(async () => {
      const items = await this.loadItems();
      const now = this.nowMs();
      const item: FollowupItem = {
        id: newFollowupId(now),
        ruleId: input.ruleId,
        personaId: input.personaId,
        what: input.what.trim(),
        eventLabel: input.eventLabel,
        eventDateMs: input.eventDateMs,
        followUpAtMs: input.followUpAtMs,
        keywords: [
          ...new Set(input.keywords.filter((k) => typeof k === "string" && k.length >= 2)),
        ],
        status: "active",
        createdAt: now,
        baselineCounts: { ...input.baselineCounts },
      };
      await this.saveItems([...items, item]);
      return item;
    });
  }

  /** Mark done or cancelled. Returns false when the id is unknown. */
  async setStatus(id: string, status: FollowupStatus): Promise<boolean> {
    return this.exclusive(async () => {
      const items = await this.loadItems();
      const idx = items.findIndex((i) => i.id === id);
      if (idx < 0) return false;
      items[idx] = { ...items[idx], status };
      await this.saveItems(items);
      return true;
    });
  }

  /** Permanently remove an item. Returns false when unknown. */
  async remove(id: string): Promise<boolean> {
    return this.exclusive(async () => {
      const items = await this.loadItems();
      if (!items.some((i) => i.id === id)) return false;
      await this.saveItems(items.filter((i) => i.id !== id));
      return true;
    });
  }

  /** Master toggle. Default ON. */
  async isEnabled(): Promise<boolean> {
    try {
      const raw = await this.storage.getItem(KEYS.enabled);
      if (raw === null) return true;
      return raw !== "0" && raw.toLowerCase() !== "false";
    } catch {
      return true;
    }
  }

  async setEnabled(on: boolean): Promise<void> {
    return this.exclusive(async () => {
      await this.storage.setItem(KEYS.enabled, on ? "1" : "0");
    });
  }

  /** Test hook. */
  async __resetForTests(): Promise<void> {
    await this.exclusive(async () => {
      await this.storage.setItem(KEYS.items, "[]");
      await this.storage.setItem(KEYS.enabled, "1");
    });
  }
}
