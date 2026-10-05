/**
 * Proactive outreach (主动触达) — settings + bookkeeping store.
 * AsyncStorage-backed, write-serialized. PURE-logic-friendly: the storage
 * surface is injectable so tests don't need React Native.
 *
 * - frequency: 积极 / 适度 / 安静, default 适度 (her decision, 2026-10-05).
 * - lastOpenedAt: last time the app came to foreground (silence trigger).
 * - lastOutreachAt: per-kind timestamps for the 24h cooldown.
 */

import type { OutreachFrequency, OutreachTriggerKind } from "./engine";
import { isOutreachFrequency } from "./engine";

export interface OutreachStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const KEYS = {
  frequency: "dudu.outreach.v1.frequency",
  lastOpened: "dudu.outreach.v1.lastOpened",
  lastOutreach: "dudu.outreach.v1.lastOutreach",
  /**
   * Unread-letter nudge fire count (round 3, xiaomeng P2-3). JSON:
   * { count: number }. Reset when she reads the letter (unread count
   * drops to 0) — the cap is per unread-letter episode, not forever.
   */
  loveLetterNudges: "dudu.outreach.v1.loveLetterNudges",
  /**
   * Feed nudge (C3): post ids already nudged. JSON: string[].
   * Exactly-once per post — a post in this set is never nudged again.
   */
  feedNudges: "dudu.outreach.v1.feedNudges",
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
      for (const k of [
        "anniversary",
        "tell_later",
        "love_letter",
        "silence",
        "diary_nudge",
        "on_this_day",
        "feed_nudge",
      ] as const) {
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
      await this.storage.setItem(KEYS.loveLetterNudges, JSON.stringify({ count: 0 }));
      await this.storage.setItem(KEYS.feedNudges, JSON.stringify([]));
    });
  }

  /**
   * How many times the unread-letter nudge has fired in the current
   * episode (round 3, xiaomeng P2-3). Never throws; junk → 0.
   */
  async getLoveLetterNudgeCount(): Promise<number> {
    try {
      const raw = await this.storage.getItem(KEYS.loveLetterNudges);
      if (!raw) return 0;
      const parsed: unknown = JSON.parse(raw);
      const n = (parsed as { count?: unknown } | null)?.count;
      return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
    } catch {
      return 0;
    }
  }

  /** Record that one unread-letter nudge was actually scheduled. Never throws. */
  async recordLoveLetterNudge(): Promise<void> {
    return this.exclusive(async () => {
      try {
        const count = await this.getLoveLetterNudgeCount();
        await this.storage.setItem(KEYS.loveLetterNudges, JSON.stringify({ count: count + 1 }));
      } catch {
        // Bookkeeping must never break the app.
      }
    });
  }

  /** She read the letter — the episode is over, the counter restarts. Never throws. */
  async resetLoveLetterNudgeCount(): Promise<void> {
    return this.exclusive(async () => {
      try {
        await this.storage.setItem(KEYS.loveLetterNudges, JSON.stringify({ count: 0 }));
      } catch {
        // Bookkeeping must never break the app.
      }
    });
  }

  /**
   * Feed nudge (C3): post ids already nudged. Never throws; junk → [].
   */
  async getNudgedFeedPostIds(): Promise<string[]> {
    try {
      const raw = await this.storage.getItem(KEYS.feedNudges);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((v): v is string => typeof v === "string" && v.length > 0);
    } catch {
      return [];
    }
  }

  /**
   * Record that a feed post was nudged (exactly-once). Serialized and
   * deduplicated; capped so the set can't grow without bound. Never throws.
   */
  async recordFeedNudge(postId: string): Promise<void> {
    if (!postId) return;
    return this.exclusive(async () => {
      try {
        const prev = await this.getNudgedFeedPostIds();
        if (prev.includes(postId)) return;
        const next = [...prev, postId];
        // Cap: a feed won't meaningfully exceed this; oldest drops first.
        const capped = next.length > 1000 ? next.slice(next.length - 1000) : next;
        await this.storage.setItem(KEYS.feedNudges, JSON.stringify(capped));
      } catch {
        // Bookkeeping must never break the app.
      }
    });
  }
}
