/**
 * Proactive outreach (主动触达) — trigger engine. PURE module: no React
 * Native / expo imports, no I/O. All inputs are passed in; all outputs are
 * data. The engine is a PRECONDITION, not a suggestion: no trigger returned
 * means no message may be sent, ever. "在吗"-style empty messages are
 * impossible by construction — every trigger carries a concrete reason.
 *
 * Design (audit round 2, xiaomeng P1-1; Dede et al. 2026 friendbot watershed):
 *  - 有由头才发. Valid triggers: anniversary approaching, unread love
 *    letter (capped at 3 fires until read — nagging by repetition is
 *    forbidden), tell_later item whose moment has come, on-this-day memory
 *    ("去年今日", round 3 xiaomeng P1-1), diary nudge (no diary entry for a
 *    while + a real anchor — xiaomeng P2-1; suppressed when her mood is
 *    freshly negative — round 3 xiaomeng P2-4), long silence (real absence).
 *  - Frequency gate: 积极 / 适度 / 安静 (default 适度). 安静 = in-session
 *    only, the engine returns nothing.
 *  - Per-kind cooldown (24h): the same kind of nudge never fires twice
 *    in a day, even across restarts (timestamps live in the store).
 */

export type OutreachFrequency = "active" | "moderate" | "quiet";

export type OutreachTriggerKind =
  | "anniversary"
  | "tell_later"
  | "love_letter"
  | "silence"
  | "diary_nudge"
  | "on_this_day";

export interface OutreachTrigger {
  kind: OutreachTriggerKind;
  /** Lower = more important. The scheduler sends at most one per cycle. */
  priority: number;
  /**
   * Concrete detail for copy composition — anniversary title, the
   * tell_later text, the on-this-day memory title, "" for love_letter/silence.
   * Never empty for anniversary/tell_later/on_this_day: a trigger without
   * content is a bug.
   */
  detail: string;
  /** Anniversary only: days until the occurrence. */
  daysUntil?: number;
  /** on_this_day only: how many years ago the memory is from. */
  yearsAgo?: number;
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
  /**
   * Diary nudge input (xiaomeng P2-1): when was the last diary entry
   * written, and what real anchor from recent days justifies a nudge.
   * Absent = the caller has no diary data → this trigger stays off.
   */
  diaryNudge?: { lastEntryAt: number | null; anchor: string };
  /**
   * On-this-day input (round 3, xiaomeng P1-1): the single most poignant
   * memory from this month-day in a previous year, or absent/null when
   * there is none. A boyfriend remembers "一年前的今天".
   */
  onThisDay?: { title: string; yearsAgo: number } | null;
  /**
   * Mood sensitivity (round 3, xiaomeng P2-4): true when she recently told
   * him she feels bad (within the mood section's freshness window). When
   * true, diary_nudge is suppressed — nudging her to write on top of a
   * fresh "难过" is tone-deaf. Real commitments (anniversary, tell_later)
   * still fire. Absent = the caller has no mood data → no suppression.
   */
  recentMoodNegative?: boolean;
  /**
   * Unread-letter nudge fire count (round 3, xiaomeng P2-3): how many times
   * the love_letter nudge has already fired without her reading the letter.
   * At LOVE_LETTER_NUDGE_CAP the trigger is suppressed — "你有一封信" five
   * times is nagging, and the prompt already forbids him from nagging.
   * Absent = the caller doesn't track it → no cap (legacy behavior).
   */
  loveLetterNudgeCount?: number;
}

/** Same kind of nudge never fires twice within this window. */
export const OUTREACH_COOLDOWN_MS = 24 * 3_600_000;

/** Silence thresholds by frequency — a real absence is a real reason. */
export const SILENCE_THRESHOLD_MS: Record<Exclude<OutreachFrequency, "quiet">, number> = {
  active: 2 * 86_400_000,
  moderate: 4 * 86_400_000,
};

/** Diary nudge: how long without a diary entry before a nudge is allowed. */
export const DIARY_NUDGE_GAP_MS: Record<Exclude<OutreachFrequency, "quiet">, number> = {
  active: 3 * 86_400_000,
  moderate: 7 * 86_400_000,
};

/** Anniversary window by frequency. */
export const ANNIVERSARY_WINDOW_DAYS: Record<Exclude<OutreachFrequency, "quiet">, number> = {
  active: 7,
  moderate: 3,
};

/**
 * Unread-letter nudge cap (round 3, xiaomeng P2-3). After this many fires
 * without her reading the letter, the trigger is suppressed until she
 * reads it. Repetition is nagging, not love.
 */
export const LOVE_LETTER_NUDGE_CAP = 3;

const DAY_MS = 86_400_000;

/**
 * Heuristic: is this mood word negative? Her moods are her own short words
 * ("累", "开心", "烦躁" — see her_mood_update). This is deliberately a
 * keyword check, not a sentiment model: false negatives just mean "no
 * suppression" (today's behavior), and a false positive only skips one
 * diary nudge — every real trigger still fires. Negative is checked
 * before positive so "不开心" (contains 开心) still counts as negative.
 */
const NEGATIVE_MOOD_WORDS = [
  "累", "疲惫", "疲倦", "难过", "伤心", "心痛", "心累", "烦", "烦躁", "焦虑",
  "紧张", "压力", "崩溃", "委屈", "生气", "愤怒", "丧", "抑郁", "郁闷",
  "想哭", "哭", "孤独", "孤单", "害怕", "恐惧", "失眠", "头疼", "头痛",
  "不舒服", "难受", "不开心", "不爽", "低落", "沮丧", "失望", "无助",
  "迷茫", "空虚", "糟糕", "痛苦", "tired", "exhausted", "sad", "upset",
  "anxious", "stressed", "angry", "lonely", "scared", "depressed", "crying",
  "hurt", "sick", "bad", "down", "disappointed", "frustrated", "worried",
  "overwhelmed",
];
const POSITIVE_MOOD_WORDS = [
  "开心", "快乐", "幸福", "甜", "满足", "平静", "放松", "期待", "兴奋",
  "感动", "温暖", "happy", "good", "great", "calm", "relaxed", "excited",
];

export function isNegativeMoodWord(mood: string): boolean {
  const w = mood.toLowerCase().replace(/\s+/g, "");
  if (w.length === 0) return false;
  if (NEGATIVE_MOOD_WORDS.some((k) => w.includes(k))) return true;
  if (POSITIVE_MOOD_WORDS.some((k) => w.includes(k))) return false;
  // Unknown word: don't guess. No suppression on ambiguity.
  return false;
}

import { HER_MOOD_FRESH_DAYS } from "../our-space/her-mood-section";

function cooledDown(kind: OutreachTriggerKind, now: number, last: Partial<Record<OutreachTriggerKind, number>>): boolean {
  const at = last[kind];
  return typeof at === "number" && now - at < OUTREACH_COOLDOWN_MS;
}

/**
 * Mood gate for the engine (round 3, xiaomeng P2-4): true when she told
 * him she feels bad within the same freshness window the mood prompt
 * section uses (HER_MOOD_FRESH_DAYS). Her own words are the signal —
 * no sentiment model, no guessing.
 */
export function isRecentNegativeMood(
  mood: { mood: string; updatedAt: number } | null | undefined,
  now: number,
): boolean {
  if (!mood || !mood.mood) return false;
  const ageMs = now - mood.updatedAt;
  if (!(ageMs >= 0) || ageMs > HER_MOOD_FRESH_DAYS * DAY_MS) return false;
  return isNegativeMoodWord(mood.mood);
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
  // Round 3, xiaomeng P2-3: the nudge never gives up by itself — cap it.
  const nudgeCount = input.loveLetterNudgeCount ?? 0;
  if (
    input.unreadLoveLetters > 0 &&
    nudgeCount < LOVE_LETTER_NUDGE_CAP &&
    !cooledDown("love_letter", now, input.lastOutreachAt)
  ) {
    out.push({ kind: "love_letter", priority: 1, detail: "" });
  }

  // 3. Tell-later item whose moment has come — AI 代办咬合: the queue
  // item's own text IS the message content, not just a reminder ping.
  const pending = input.pendingTellLater.find((i) => i.text.trim().length > 0);
  if (pending && !cooledDown("tell_later", now, input.lastOutreachAt)) {
    out.push({ kind: "tell_later", priority: 2, detail: pending.text.trim().slice(0, 200) });
  }

  // 3b. On this day (round 3, xiaomeng P1-1) — "一年前的今天，我们…".
  // The single most poignant trigger a companion has. Priority between
  // tell_later (a real commitment) and diary_nudge (softer). The old
  // title rides in `detail` so the copy always says WHAT he remembered.
  const otd = input.onThisDay;
  if (
    otd &&
    otd.title.trim().length > 0 &&
    !cooledDown("on_this_day", now, input.lastOutreachAt)
  ) {
    out.push({
      kind: "on_this_day",
      priority: 3,
      detail: otd.title.trim().slice(0, 200),
      yearsAgo: otd.yearsAgo,
    });
  }

  // 4. Diary nudge (xiaomeng P2-1) — only when BOTH hold: no diary entry
  // for a while AND a real anchor from recent days exists. Never random,
  // never "该写日记了". The anchor rides in `detail` so the copy always
  // says WHAT made him think of it. Round 3, xiaomeng P2-4: suppressed
  // when her mood is freshly negative — don't nudge writing on top of
  // a fresh "难过".
  const dn = input.diaryNudge;
  if (dn) {
    const anchor = dn.anchor.trim();
    const gap = dn.lastEntryAt === null ? Infinity : now - dn.lastEntryAt;
    if (
      anchor.length > 0 &&
      gap >= DIARY_NUDGE_GAP_MS[frequency] &&
      !input.recentMoodNegative &&
      !cooledDown("diary_nudge", now, input.lastOutreachAt)
    ) {
      out.push({ kind: "diary_nudge", priority: 4, detail: anchor.slice(0, 200) });
    }
  }

  // 5. Long silence — only a real absence counts (threshold by frequency).
  // This is the "她很久没打开" trigger she approved. It never fires on a
  // fresh install (lastOpenedAt null → no baseline → stay silent).
  if (input.lastOpenedAt !== null) {
    const gap = now - input.lastOpenedAt;
    if (gap >= SILENCE_THRESHOLD_MS[frequency] && !cooledDown("silence", now, input.lastOutreachAt)) {
      out.push({ kind: "silence", priority: 5, detail: "" });
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
