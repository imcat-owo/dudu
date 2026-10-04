/**
 * Proactive outreach (主动触达) — trigger engine. PURE module: no React
 * Native / expo imports, no I/O. All inputs are passed in; all outputs are
 * data. The engine is a PRECONDITION, not a suggestion: no trigger returned
 * means no message may be sent, ever. "在吗"-style empty messages are
 * impossible by construction — every trigger carries a concrete reason.
 *
 * Design (audit round 2, xiaomeng P1-1; Dede et al. 2026 friendbot watershed):
 *  - 有由头才发. Valid triggers: anniversary approaching, tell_later item
 *    whose moment has come, unread love letter, long silence (real absence).
 *  - Frequency gate: 积极 / 适度 / 安静 (default 适度). 安静 = in-session
 *    only, the engine returns nothing.
 *  - Per-kind cooldown (24h): the same kind of nudge never fires twice
 *    in a day, even across restarts (timestamps live in the store).
 */

export type OutreachFrequency = "active" | "moderate" | "quiet";

export type OutreachTriggerKind = "anniversary" | "tell_later" | "love_letter" | "silence";

export interface OutreachTrigger {
  kind: OutreachTriggerKind;
  /** Lower = more important. The scheduler sends at most one per cycle. */
  priority: number;
  /**
   * Concrete detail for copy composition — anniversary title, the
   * tell_later text, "" for love_letter/silence. Never empty for
   * anniversary/tell_later: a trigger without content is a bug.
   */
  detail: string;
  /** Anniversary only: days until the occurrence. */
  daysUntil?: number;
}

export interface OutreachEvalInput {
  frequency: OutreachFrequency;
  now: number;
  anniversaries: { title: string; daysUntil: number }[];
  pendingTellLater: { id: string; text: string }[];
  unreadLoveLetters: number;
  /** Last time she brought the app to foreground. Null = never tracked. */
  lastOpenedAt: number | null;
  /** Last time each kind actually fired (for cooldown). */
  lastOutreachAt: Partial<Record<OutreachTriggerKind, number>>;
}

/** Same kind of nudge never fires twice within this window. */
export const OUTREACH_COOLDOWN_MS = 24 * 3_600_000;

/** Silence thresholds by frequency — a real absence is a real reason. */
export const SILENCE_THRESHOLD_MS: Record<Exclude<OutreachFrequency, "quiet">, number> = {
  active: 2 * 86_400_000,
  moderate: 4 * 86_400_000,
};

/** Anniversary window by frequency. */
export const ANNIVERSARY_WINDOW_DAYS: Record<Exclude<OutreachFrequency, "quiet">, number> = {
  active: 7,
  moderate: 3,
};

const DAY_MS = 86_400_000;

function cooledDown(kind: OutreachTriggerKind, now: number, last: Partial<Record<OutreachTriggerKind, number>>): boolean {
  const at = last[kind];
  return typeof at === "number" && now - at < OUTREACH_COOLDOWN_MS;
}

/**
 * Evaluate triggers. Pure: same input → same output. Returns triggers
 * sorted by priority (most important first). Empty array = stay silent.
 */
export function evaluateOutreachTriggers(input: OutreachEvalInput): OutreachTrigger[] {
  const { frequency, now } = input;
  // 安静档: in-session only. The engine stays silent — this is the hard
  // guarantee behind "never send without a reason".
  if (frequency === "quiet") return [];

  const out: OutreachTrigger[] = [];

  // 1. Anniversary approaching — highest priority. She would feel it if
  // he forgot; the design doc calls this out by name.
  const windowDays = ANNIVERSARY_WINDOW_DAYS[frequency];
  const near = input.anniversaries
    .filter((a) => a.daysUntil >= 0 && a.daysUntil <= windowDays && a.title.trim().length > 0)
    .sort((a, b) => a.daysUntil - b.daysUntil)[0];
  if (near && !cooledDown("anniversary", now, input.lastOutreachAt)) {
    out.push({ kind: "anniversary", priority: 0, detail: near.title.trim(), daysUntil: near.daysUntil });
  }

  // 2. Unread love letter — a letter waiting is a reason by itself.
  // (P2-4: "你有一封信" is outreach; "你看了吗" afterwards would be nagging.)
  if (input.unreadLoveLetters > 0 && !cooledDown("love_letter", now, input.lastOutreachAt)) {
    out.push({ kind: "love_letter", priority: 1, detail: "" });
  }

  // 3. Tell-later item whose moment has come — AI 代办咬合: the queue
  // item's own text IS the message content, not just a reminder ping.
  const pending = input.pendingTellLater.find((i) => i.text.trim().length > 0);
  if (pending && !cooledDown("tell_later", now, input.lastOutreachAt)) {
    out.push({ kind: "tell_later", priority: 2, detail: pending.text.trim().slice(0, 200) });
  }

  // 4. Long silence — only a real absence counts (threshold by frequency).
  // This is the "她很久没打开" trigger she approved. It never fires on a
  // fresh install (lastOpenedAt null → no baseline → stay silent).
  if (input.lastOpenedAt !== null) {
    const gap = now - input.lastOpenedAt;
    if (gap >= SILENCE_THRESHOLD_MS[frequency] && !cooledDown("silence", now, input.lastOutreachAt)) {
      out.push({ kind: "silence", priority: 3, detail: "" });
    }
  }

  out.sort((a, b) => a.priority - b.priority);
  return out;
}

/** Notification delay after backgrounding, by frequency. Fires only if she hasn't returned. */
export const OUTREACH_DELAY_SECONDS: Record<Exclude<OutreachFrequency, "quiet">, number> = {
  active: 6 * 3600,
  moderate: 12 * 3600,
};

export function isOutreachFrequency(v: unknown): v is OutreachFrequency {
  return v === "active" || v === "moderate" || v === "quiet";
}
