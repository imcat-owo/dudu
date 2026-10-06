/**
 * AI photo share （主动发照片） — config + ledger store.
 * AsyncStorage-backed, write-serialized. Storage + clock injectable so
 * tests don't need React Native. Mirrors selfpost/store.ts patterns.
 *
 * - config: enabled (DEFAULT OFF — opt-in) / slotCount / dailyCap /
 *   personaId (which persona shares; resolved once, then stable)
 * - fired: slot ledger — a slot fires at most once, ever. Failed fires
 *   still consume the slot: interrupted execution is never retried.
 * - sends: timestamps of AI photo shares (for the daily cap + the shared
 *   proactive cap — a photo is an "AI reaches her" send like any other)
 * - log: lightweight decision log — what he shared and when, visible to her
 */

import { shanghaiDayStart } from "../initiative/rules";
import {
  clampSlotCount,
  PHOTOSHARE_SLOT_COUNT_DEFAULT,
  type PhotoshareSlot,
  photoshareSlotId,
} from "./slots";

const KEYS = {
  config: "dudu.photoshare.v1.config",
  fired: "dudu.photoshare.v1.fired",
  sends: "dudu.photoshare.v1.sends",
  log: "dudu.photoshare.v1.log",
} as const;

/** Cap the fired-slot ledger so it can't grow without bound. */
const FIRED_LEDGER_CAP = 2000;
/** Cap the sends ledger. */
const SENDS_LEDGER_CAP = 500;
/** Cap the decision log — stays lightweight. */
const LOG_CAP = 100;

export const PHOTOSHARE_DAILY_CAP_DEFAULT = 1;
export const PHOTOSHARE_DAILY_CAP_MIN = 0;
export const PHOTOSHARE_DAILY_CAP_MAX = 2;

export function clampDailyCap(n: unknown): number {
  const v =
    typeof n === "number" && Number.isFinite(n) ? Math.round(n) : PHOTOSHARE_DAILY_CAP_DEFAULT;
  return Math.min(PHOTOSHARE_DAILY_CAP_MAX, Math.max(PHOTOSHARE_DAILY_CAP_MIN, v));
}

export interface PhotoshareConfig {
  /** Master toggle. DEFAULT OFF — surprising her with photos is opt-in. */
  enabled: boolean;
  slotCount: number;
  dailyCap: number;
  /** Which persona shares photos. "" = resolve on first tick. */
  personaId: string;
}

export const DEFAULT_PHOTOSHARE_CONFIG: PhotoshareConfig = {
  enabled: false,
  slotCount: PHOTOSHARE_SLOT_COUNT_DEFAULT,
  dailyCap: PHOTOSHARE_DAILY_CAP_DEFAULT,
  personaId: "",
};

export type PhotoshareOutcome = "shared" | "skipped";

export interface PhotoshareLogEntry {
  at: number;
  slotIndex: number;
  slotAt: number;
  outcome: PhotoshareOutcome;
  /** Machine-readable reason: capped | quiet-hours | disabled | incognito | collision | no-api-group | model-skip | shared | generate-failed | deliver-failed | ... */
  reason: string;
  /** Caption preview of a shared photo (for her view). Never on skips. */
  captionPreview?: string;
  /** True when this share was her explicit request ("发张照片给我"). */
  manual?: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function sanitizeConfig(v: unknown): PhotoshareConfig {
  if (!isRecord(v)) return { ...DEFAULT_PHOTOSHARE_CONFIG };
  return {
    // Default OFF is the product decision — a stored `enabled: true`
    // survives, but anything ambiguous stays off.
    enabled: v.enabled === true,
    slotCount: clampSlotCount(v.slotCount),
    dailyCap: clampDailyCap(v.dailyCap),
    personaId: typeof v.personaId === "string" ? v.personaId : "",
  };
}

export class PhotoshareStore {
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

  async getConfig(): Promise<PhotoshareConfig> {
    try {
      const raw = await this.storage.getItem(KEYS.config);
      if (!raw) return { ...DEFAULT_PHOTOSHARE_CONFIG };
      return sanitizeConfig(JSON.parse(raw));
    } catch {
      return { ...DEFAULT_PHOTOSHARE_CONFIG };
    }
  }

  async setConfig(patch: Partial<PhotoshareConfig>): Promise<PhotoshareConfig> {
    return this.exclusive(async () => {
      const cur = await this.getConfig();
      const next: PhotoshareConfig = {
        enabled: typeof patch.enabled === "boolean" ? patch.enabled : cur.enabled,
        slotCount: patch.slotCount !== undefined ? clampSlotCount(patch.slotCount) : cur.slotCount,
        dailyCap: patch.dailyCap !== undefined ? clampDailyCap(patch.dailyCap) : cur.dailyCap,
        personaId: typeof patch.personaId === "string" ? patch.personaId.trim() : cur.personaId,
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

  async wasSlotFired(slot: PhotoshareSlot, nowMs: number = this.nowMs()): Promise<boolean> {
    const ids = await this.firedSlotIds();
    return ids.has(photoshareSlotId(shanghaiDayStart(nowMs), slot.index));
  }

  /** Mark a slot fired. Failed fires call this too — never retried. */
  async markSlotFired(slot: PhotoshareSlot, nowMs: number = this.nowMs()): Promise<void> {
    return this.exclusive(async () => {
      const id = photoshareSlotId(shanghaiDayStart(nowMs), slot.index);
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

  /** AI photo shares today (Shanghai day), for the daily cap. */
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

  /** Last photo share (own ledger only — the executor combines this with the other channels for the collision check). */
  async lastActivityAt(): Promise<number> {
    const sends = await this.loadSends();
    let last = 0;
    for (const t of sends) if (t > last) last = t;
    return last;
  }

  async appendLog(entry: PhotoshareLogEntry): Promise<void> {
    return this.exclusive(async () => {
      let list: PhotoshareLogEntry[] = [];
      try {
        const raw = await this.storage.getItem(KEYS.log);
        const arr: unknown = raw ? JSON.parse(raw) : [];
        if (Array.isArray(arr)) list = arr.filter(isRecord) as unknown as PhotoshareLogEntry[];
      } catch {
        list = [];
      }
      list.push(entry);
      await this.storage.setItem(KEYS.log, JSON.stringify(list.slice(-LOG_CAP)));
    });
  }

  async listLog(limit = 30): Promise<PhotoshareLogEntry[]> {
    try {
      const raw = await this.storage.getItem(KEYS.log);
      const arr: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return [];
      return (arr.filter(isRecord) as unknown as PhotoshareLogEntry[])
        .slice(-Math.max(1, limit))
        .reverse();
    } catch {
      return [];
    }
  }
}

export const PHOTOSHARE_STORE_KEYS = KEYS;
