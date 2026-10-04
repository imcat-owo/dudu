/**
 * Proactive outreach (主动触达) — settings + bookkeeping store.
 * AsyncStorage-backed, write-serialized. PURE-logic-friendly: the storage
 * surface is injectable so tests don't need React Native.
 *
 * - frequency: 积极 / 适度 / 安静, default 适度 (her decision, 2026-10-05).
 * - lastOpenedAt: last time the app came to foreground (silence trigger).
 * - lastOutreachAt: per-kind timestamps for the 24h cooldown.
 */

import type { OutreachFrequency, OutreachTriggerKind } from "./engine.js";
import { isOutreachFrequency } from "./engine.js";

export interface OutreachStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const KEYS = {
  frequency: "dudu.outreach.v1.frequency",
  lastOpened: "dudu.outreach.v1.lastOpened",
  lastOutreach: "dudu.outreach.v1.lastOutreach",
} as const;

export const DEFAULT_FREQUENCY: OutreachFrequency = "moderate";

export class OutreachStore {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private storage: OutreachStorage) {}

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

  async getFrequency(): Promise<OutreachFrequency> {
    try {
      const raw = await this.storage.getItem(KEYS.frequency);
      return isOutreachFrequency(raw) ? raw : DEFAULT_FREQUENCY;
    } catch {
      return DEFAULT_FREQUENCY;
    }
  }

  async setFrequency(f: OutreachFrequency): Promise<void> {
    return this.exclusive(async () => {
      await this.storage.setItem(KEYS.frequency, f);
    });
  }

  async getLastOpenedAt(): Promise<number | null> {
    try {
      const raw = await this.storage.getItem(KEYS.lastOpened);
      const n = raw === null ? NaN : Number(raw);
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  }

  /** Record a foreground transition. Never throws. */
  async markOpened(now: number = Date.now()): Promise<void> {
    return this.exclusive(async () => {
      try {
        await this.storage.setItem(KEYS.lastOpened, String(now));
      } catch {
        // Bookkeeping must never break the app.
      }
    });
  }

  async getLastOutreachAt(): Promise<Partial<Record<OutreachTriggerKind, number>>> {
    try {
      const raw = await this.storage.getItem(KEYS.lastOutreach);
      if (!raw) return {};
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return {};
      const out: Partial<Record<OutreachTriggerKind, number>> = {};
      for (const k of ["anniversary", "tell_later", "love_letter", "silence", "diary_nudge"] as const) {
        const v = (parsed as Record<string, unknown>)[k];
        if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = v;
      }
      return out;
    } catch {
      return {};
    }
  }

  /** Record that a trigger of this kind fired. Never throws. */
  async markOutreach(kind: OutreachTriggerKind, now: number = Date.now()): Promise<void> {
    return this.exclusive(async () => {
      try {
        const prev = await this.getLastOutreachAt();
        await this.storage.setItem(KEYS.lastOutreach, JSON.stringify({ ...prev, [kind]: now }));
      } catch {
        // Bookkeeping must never break the app.
      }
    });
  }

  /** Test hook. */
  async __resetForTests(): Promise<void> {
    await this.exclusive(async () => {
      await this.storage.setItem(KEYS.frequency, DEFAULT_FREQUENCY);
      await this.storage.setItem(KEYS.lastOpened, "");
      await this.storage.setItem(KEYS.lastOutreach, "{}");
    });
  }
}
