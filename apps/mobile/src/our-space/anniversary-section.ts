/**
 * Anniversary awareness for the system prompt — PURE module.
 *
 * When a 纪念日 is today or coming up within 7 days, returns a subtle note
 * so the AI knows and can prepare or mention it naturally — the
 * quiet-reminder pattern. Empty string otherwise: no noise, no spam.
 *
 * Anniversaries are treated as recurring by month-day (birthdays, yearly
 * milestones): a date stored as "2020-10-09" still triggers every October 9th.
 * The next upcoming occurrence (this year, or next year if this year's has
 * passed) is what gets compared against today.
 */

import type { Anniversary } from "./store.js";

/** How many days ahead counts as "upcoming". */
export const ANNIVERSARY_WARNING_DAYS = 7;

function atMidnight(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

/** YYYY-MM-DD for display of the upcoming occurrence. */
function fmt(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Next upcoming occurrence of a month-day anniversary.
 * This year's occurrence if it hasn't passed yet, otherwise next year's.
 */
function nextOccurrence(month: number, day: number, now: Date): Date {
  const n = atMidnight(now);
  let occ = atMidnight(new Date(n.getFullYear(), month - 1, day));
  if (occ.getTime() < n.getTime()) {
    occ = atMidnight(new Date(n.getFullYear() + 1, month - 1, day));
  }
  return occ;
}

export interface UpcomingAnniversary {
  title: string;
  /** Days until the occurrence: 0 means today. */
  daysUntil: number;
  /** YYYY-MM-DD of the upcoming occurrence (not the stored year). */
  occurrence: string;
}

/**
 * Anniversaries due today or within the warning window, soonest first.
 * PURE — shared by the system-prompt injection and the "Today" card.
 */
export function getUpcomingAnniversaries(
  anniversaries: Anniversary[],
  now: Date = new Date(),
  windowDays: number = ANNIVERSARY_WARNING_DAYS,
): UpcomingAnniversary[] {
  const today = atMidnight(now);
  const out: UpcomingAnniversary[] = [];
  for (const a of anniversaries) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(a.date);
    if (!m) continue;
    const occ = nextOccurrence(Number(m[2]), Number(m[3]), now);
    const daysUntil = Math.round((occ.getTime() - today.getTime()) / 86400000);
    if (daysUntil >= 0 && daysUntil <= windowDays) {
      out.push({ title: a.title, daysUntil, occurrence: fmt(occ) });
    }
  }
  out.sort((x, y) => x.daysUntil - y.daysUntil);
  return out;
}

/**
 * Build the anniversary awareness section for the system prompt.
 * One subtle line per relevant anniversary; "" when nothing is near.
 */
export function buildAnniversarySection(
  anniversaries: Anniversary[],
  now: Date = new Date(),
): string {
  const lines: string[] = [];
  for (const a of getUpcomingAnniversaries(anniversaries, now)) {
    if (a.daysUntil === 0) {
      lines.push(
        `今天是「${a.title}」。她可能记得也可能没提——你先别声张，找个自然的时机提起，轻松一点。`,
      );
    } else {
      lines.push(
        `「${a.title}」还有 ${a.daysUntil} 天（${a.occurrence}）。可以悄悄准备个小惊喜，别提前说漏嘴。`,
      );
    }
  }
  return lines.join("\n");
}
