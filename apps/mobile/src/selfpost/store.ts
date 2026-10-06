/**
 * AI self-post trigger （自发帖触发器） — config + ledger store.
 * AsyncStorage-backed, write-serialized. Storage + clock injectable so
 * tests don't need React Native. Mirrors initiative/store.ts patterns.
 *
 * - config: enabled / slotCount / dailyCap (her settings)
 * - fired: slot ledger — a slot fires at most once, ever. Failed fires
 *   still consume the slot: interrupted execution is never retried.
 * - sends: timestamps of AI self-posts (for the daily cap)
 * - log: lightweight decision log — "AI 今天想发没发" lives here
 */

import { shanghaiDayStart } from "../initiative/rules";
import {
  clampSlotCount,
  SELFPOST_SLOT_COUNT_DEFAULT,
  type SelfpostSlot,
  selfpostSlotId,
} from "./slots";

const KEYS = {
  config: "dudu.selfpost.v1.config",
  fired: "dudu.selfpost.v1.fired",
  sends: "dudu.selfpost.v1.sends",
  log: "dudu.selfpost.v1.log",
} as const;

/** Cap the fired-slot ledger so it can't grow without bound. */
const FIRED_LEDGER_CAP = 2000;
/** Cap the sends ledger. */
const SENDS_LEDGER_CAP = 500;
/** Cap the decision log — "AI 今天想发没发" stays lightweight. */
const LOG_CAP = 100;

export const SELFPOST_DAILY_CAP_DEFAULT = 1;
export const SELFPOST_DAILY_CAP_MIN = 0;
export const SELFPOST_DAILY_CAP_MAX = 3;

export function clampDailyCap(n: unknown): number {
  const v =
    typeof n === "number" && Number.isFinite(n) ? Math.round(n) : SELFPOST_DAILY_CAP_DEFAULT;
  return Math.min(SELFPOST_DAILY_CAP_MAX, Math.max(SELFPOST_DAILY_CAP_MIN, v));
}

export interface SelfpostConfig {
  enabled: boolean;
  slotCount: number;
  dailyCap: number;
}

export const DEFAULT_SELFPOST_CONFIG: SelfpostConfig = {
  enabled: true,
  slotCount: SELFPOST_SLOT_COUNT_DEFAULT,
  dailyCap: SELFPOST_DAILY_CAP_DEFAULT,
};

export type SelfpostOutcome = "posted" | "skipped";

export interface SelfpostLogEntry {
  at: number;
  slotIndex: number;
  slotAt: number;
  outcome: SelfpostOutcome;
  /** Machine-readable reason: capped | quiet-hours | disabled | incognito | collision | no-api-group | model-skip | posted | ... */
  reason: string;
  /** First 120 chars of a posted text (for her "想发没发" view). Never on skips. */
  textPreview?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function sanitizeConfig(v: unknown): SelfpostConfig {
  if (!isRecord(v)) return { ...DEFAULT_SELFPOST_CONFIG };
  return {
    enabled: v.enabled !== false,
    slotCount: clampSlotCount(v.slotCount),
    dailyCap: clampDailyCap(v.dailyCap),
  };
}

export class SelfpostStore {
  private writeChain: Promise<void> = Promise.resolve();
  private readonly nowMs: () => number;

  constructor(
    private storage: {
      getItem(k: string): Promise<string | null>;
      setItem(k: string, v: string): Promise<void>;
    },
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

  async getConfig(): Promise<SelfpostConfig> {
    try {
      const raw = await this.storage.getItem(KEYS.config);
      if (!raw) return { ...DEFAULT_SELFPOST_CONFIG };
      return sanitizeConfig(JSON.parse(raw));
    } catch {
      return { ...DEFAULT_SELFPOST_CONFIG };
    }
  }

  async setConfig(patch: Partial<SelfpostConfig>): Promise<SelfpostConfig> {
    return this.exclusive(async () => {
      const cur = await this.getConfig();
      const next: SelfpostConfig = {
        enabled: typeof patch.enabled === "boolean" ? patch.enabled : cur.enabled,
        slotCount: patch.slotCount !== undefined ? clampSlotCount(patch.slotCount) : cur.slotCount,
        dailyCap: patch.dailyCap !== undefined ? clampDailyCap(patch.dailyCap) : cur.dailyCap,
      };
      await this.storage.setItem(KEYS.config, JSON.stringify(next));
      return next;
    });
  }

  private async loadFired(): Promise<string[]> {
    try {
      const raw = await this.storage.getItem(KEYS.fired);
      const arr: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  }

  async firedSlotIds(): Promise<Set<string>> {
    return new Set(await this.loadFired());
  }

  async wasSlotFired(slot: SelfpostSlot, nowMs: number = this.nowMs()): Promise<boolean> {
    const ids = await this.firedSlotIds();
    return ids.has(selfpostSlotId(shanghaiDayStart(nowMs), slot.index));
  }

  /** Mark a slot fired. Failed fires call this too — never retried. */
  async markSlotFired(slot: SelfpostSlot, nowMs: number = this.nowMs()): Promise<void> {
    return this.exclusive(async () => {
      const id = selfpostSlotId(shanghaiDayStart(nowMs), slot.index);
      const list = await this.loadFired();
      if (!list.includes(id)) {
        list.push(id);
        await this.storage.setItem(KEYS.fired, JSON.stringify(list.slice(-FIRED_LEDGER_CAP)));
      }
    });
  }

  private async loadSends(): Promise<number[]> {
    try {
      const raw = await this.storage.getItem(KEYS.sends);
      const arr: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter((x): x is number => typeof x === "number") : [];
    } catch {
      return [];
    }
  }

  /** AI self-posts today (Shanghai day), for the daily cap. */
  async countSendsToday(nowMs: number = this.nowMs()): Promise<number> {
    const dayStart = shanghaiDayStart(nowMs);
    const sends = await this.loadSends();
    return sends.filter((t) => t >= dayStart).length;
  }

  async recordSend(nowMs: number = this.nowMs()): Promise<void> {
    return this.exclusive(async () => {
      const sends = await this.loadSends();
      sends.push(nowMs);
      await this.storage.setItem(KEYS.sends, JSON.stringify(sends.slice(-SENDS_LEDGER_CAP)));
    });
  }

  /** Last proactive send of ANY kind — for the 60-min collision check. */
  async lastActivityAt(): Promise<number> {
    const sends = await this.loadSends();
    let last = 0;
    for (const t of sends) if (t > last) last = t;
    return last;
  }

  async appendLog(entry: SelfpostLogEntry): Promise<void> {
    return this.exclusive(async () => {
      let list: SelfpostLogEntry[] = [];
      try {
        const raw = await this.storage.getItem(KEYS.log);
        const arr: unknown = raw ? JSON.parse(raw) : [];
        if (Array.isArray(arr)) list = arr.filter(isRecord) as unknown as SelfpostLogEntry[];
      } catch {
        list = [];
      }
      list.push(entry);
      await this.storage.setItem(KEYS.log, JSON.stringify(list.slice(-LOG_CAP)));
    });
  }

  async listLog(limit = 30): Promise<SelfpostLogEntry[]> {
    try {
      const raw = await this.storage.getItem(KEYS.log);
      const arr: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return [];
      return (arr.filter(isRecord) as unknown as SelfpostLogEntry[])
        .slice(-Math.max(1, limit))
        .reverse();
    } catch {
      return [];
    }
  }
}

export const SELFPOST_STORE_KEYS = KEYS;
