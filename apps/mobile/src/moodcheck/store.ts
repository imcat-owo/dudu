/**
 * Daily mood check-in （每日心情 check-in） — store.
 * AsyncStorage-backed, write-serialized, injectable storage for tests.
 *
 * Two things live here:
 * - config: master toggle + the daily hour (Shanghai wall clock, default
 *   20:00 — she is nocturnal, never inside her 06:00–16:00 sleep window).
 * - history: the mood timeline — one entry per persona per Shanghai day.
 *   The latest mood also goes to our-space setHerMood (system-prompt
 *   awareness); this store is the visible history she can browse/delete.
 * - lastCheckinDay / lastOutcome: the fire ledger. One check-in per day,
 *   ever; "pending" (fired, no answer yet) vs "answered" vs "skipped".
 */

import { HER_SLEEP_END_HOUR, HER_SLEEP_START_HOUR } from "../our-space/her-rhythm";
import { shanghaiDayKey } from "./time";

export type MoodSource = "checkin" | "chat";
export type MoodcheckOutcome = "pending" | "answered" | "skipped";

export interface MoodEntry {
  id: string;
  /** Shanghai day key "YYYY-MM-DD". One entry per persona per day. */
  dayKey: string;
  personaId: string;
  /** Her words, short — e.g. "有点累", "挺好的", "很糟". */
  mood: string;
  /** Optional longer note in her words. */
  note: string;
  source: MoodSource;
  createdAt: number;
}

export interface MoodcheckConfig {
  enabled: boolean;
  /** Shanghai wall-clock hour 0-23. Never 6–16 (her sleep window). */
  hour: number;
  /** Which persona asks. "" = not chosen yet (first tick picks one). */
  personaId: string;
}

export const DEFAULT_CHECKIN_HOUR = 20;

const KEYS = {
  config: "dudu.moodcheck.v1.config",
  history: "dudu.moodcheck.v1.history",
  lastCheckinDay: "dudu.moodcheck.v1.lastCheckinDay",
  lastOutcome: "dudu.moodcheck.v1.lastOutcome",
} as const;

export const MOODCHECK_BACKUP_KEYS = [KEYS.config, KEYS.history, KEYS.lastCheckinDay, KEYS.lastOutcome] as const;

const HISTORY_CAP = 730; // two years of days is plenty

export interface MoodcheckStorage {
  getItem(k: string): Promise<string | null>;
  setItem(k: string, v: string): Promise<void>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function sanitizeEntry(v: unknown): MoodEntry | null {
  if (!isRecord(v)) return null;
  const { id, dayKey, personaId, mood, note, source, createdAt } = v;
  if (typeof id !== "string" || !id) return null;
  if (typeof dayKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return null;
  if (typeof personaId !== "string" || !personaId) return null;
  if (typeof mood !== "string" || !mood.trim()) return null;
  return {
    id,
    dayKey,
    personaId,
    mood: mood.trim(),
    note: typeof note === "string" ? note.trim() : "",
    source: source === "chat" ? "chat" : "checkin",
    createdAt: typeof createdAt === "number" ? createdAt : 0,
  };
}

function sanitizeConfig(v: unknown): MoodcheckConfig {
  const fallback: MoodcheckConfig = { enabled: true, hour: DEFAULT_CHECKIN_HOUR, personaId: "" };
  if (!isRecord(v)) return fallback;
  const hour = typeof v.hour === "number" ? Math.floor(v.hour) : DEFAULT_CHECKIN_HOUR;
  return {
    enabled: v.enabled !== false && v.enabled !== "0",
    hour: hour >= 0 && hour <= 23 ? hour : DEFAULT_CHECKIN_HOUR,
    personaId: typeof v.personaId === "string" ? v.personaId : "",
  };
}

/** True when the hour is inside her 06:00–16:00 sleep window (never allowed). */
export function isSleepHour(hour: number): boolean {
  return hour >= HER_SLEEP_START_HOUR && hour < HER_SLEEP_END_HOUR;
}

export function newMoodEntryId(nowMs: number = Date.now()): string {
  return `mc_${nowMs.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export class MoodcheckStore {
  private writeChain: Promise<void> = Promise.resolve();
  private readonly nowMs: () => number;

  constructor(
    private storage: MoodcheckStorage,
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

  // ---- config ----

  async getConfig(): Promise<MoodcheckConfig> {
    try {
      const raw = await this.storage.getItem(KEYS.config);
      if (!raw) return sanitizeConfig(null);
      return sanitizeConfig(JSON.parse(raw));
    } catch {
      return sanitizeConfig(null);
    }
  }

  async setConfig(patch: Partial<MoodcheckConfig>): Promise<MoodcheckConfig> {
    return this.exclusive(async () => {
      const cur = await this.getConfig();
      const next: MoodcheckConfig = { ...cur, ...patch };
      await this.storage.setItem(KEYS.config, JSON.stringify(next));
      return next;
    });
  }

  // ---- fire ledger ----

  /** Shanghai day key of the last fired check-in ("" = never). */
  async getLastCheckinDay(): Promise<string> {
    try {
      return (await this.storage.getItem(KEYS.lastCheckinDay)) ?? "";
    } catch {
      return "";
    }
  }

  async setLastCheckinDay(dayKey: string): Promise<void> {
    return this.exclusive(async () => {
      await this.storage.setItem(KEYS.lastCheckinDay, dayKey);
    });
  }

  async getLastOutcome(): Promise<MoodcheckOutcome> {
    try {
      const raw = await this.storage.getItem(KEYS.lastOutcome);
      if (raw === "answered" || raw === "skipped") return raw;
      return "pending";
    } catch {
      return "pending";
    }
  }

  async setLastOutcome(outcome: MoodcheckOutcome): Promise<void> {
    return this.exclusive(async () => {
      await this.storage.setItem(KEYS.lastOutcome, outcome);
    });
  }

  // ---- history ----

  private async loadHistory(): Promise<MoodEntry[]> {
    try {
      const raw = await this.storage.getItem(KEYS.history);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(sanitizeEntry).filter((e): e is MoodEntry => e !== null);
    } catch {
      return [];
    }
  }

  private async saveHistory(entries: MoodEntry[]): Promise<void> {
    const capped =
      entries.length > HISTORY_CAP ? entries.slice(entries.length - HISTORY_CAP) : entries;
    await this.storage.setItem(KEYS.history, JSON.stringify(capped));
  }

  /** Newest first. */
  async list(limit = 60): Promise<MoodEntry[]> {
    const all = await this.loadHistory();
    return all
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.max(1, limit));
  }

  async getDay(dayKey: string, personaId: string): Promise<MoodEntry | null> {
    const all = await this.loadHistory();
    return all.find((e) => e.dayKey === dayKey && e.personaId === personaId) ?? null;
  }

  /**
   * Record her mood for a day. One entry per persona per day — a second
   * record the same day UPDATES the entry (latest wins), it never
   * duplicates. Returns the entry.
   */
  async record(input: {
    dayKey?: string;
    personaId: string;
    mood: string;
    note?: string;
    source: MoodSource;
  }): Promise<MoodEntry> {
    const mood = input.mood.trim();
    if (!mood) throw new Error("mood is required.");
    if (!input.personaId) throw new Error("personaId is required.");
    return this.exclusive(async () => {
      const all = await this.loadHistory();
      const dayKey = input.dayKey ?? shanghaiDayKey(this.nowMs());
      const idx = all.findIndex((e) => e.dayKey === dayKey && e.personaId === input.personaId);
      const now = this.nowMs();
      if (idx >= 0) {
        const updated: MoodEntry = {
          ...all[idx],
          mood,
          note: (input.note ?? "").trim(),
          source: input.source,
          createdAt: now,
        };
        all[idx] = updated;
        await this.saveHistory(all);
        return updated;
      }
      const entry: MoodEntry = {
        id: newMoodEntryId(now),
        dayKey,
        personaId: input.personaId,
        mood,
        note: (input.note ?? "").trim(),
        source: input.source,
        createdAt: now,
      };
      await this.saveHistory([...all, entry]);
      return entry;
    });
  }

  /** Permanently remove an entry. Returns false when unknown. */
  async remove(id: string): Promise<boolean> {
    return this.exclusive(async () => {
      const all = await this.loadHistory();
      if (!all.some((e) => e.id === id)) return false;
      await this.saveHistory(all.filter((e) => e.id !== id));
      return true;
    });
  }

  /** Test hook. */
  async __resetForTests(): Promise<void> {
    await this.exclusive(async () => {
      await this.storage.setItem(KEYS.history, "[]");
      await this.storage.setItem(KEYS.config, JSON.stringify(sanitizeConfig(null)));
      await this.storage.setItem(KEYS.lastCheckinDay, "");
      await this.storage.setItem(KEYS.lastOutcome, "answered");
    });
  }
}
