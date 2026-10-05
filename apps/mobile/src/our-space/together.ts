/**
 * 在一起 N 天 — "days together" counter. PURE module.
 *
 * Resolves the together-since date and counts full days:
 * 1. Explicit `togetherSince` on the couple profile (she told him the date).
 * 2. Fallback: the earliest anniversary date (best guess when she never
 *    said it outright — e.g. the day they met is usually an anniversary).
 * 3. Nothing set and no anniversaries → null (stay silent, don't invent).
 *
 * Day 1 = the together day itself (Chinese romantic convention:
 * "在一起的第一天").
 */

import type { Anniversary, CoupleProfile } from "./store";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDateStr(s: string): Date | null {
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // Reject overflow dates like 2026-02-30 (JS rolls them into March).
  if (
    d.getFullYear() !== Number(m[1]) ||
    d.getMonth() !== Number(m[2]) - 1 ||
    d.getDate() !== Number(m[3])
  ) {
    return null;
  }
  return d;
}

function midnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Resolve the together-since date string (YYYY-MM-DD), or null.
 * Explicit profile date wins; otherwise the earliest anniversary.
 */
export function resolveTogetherSince(
  profile: CoupleProfile | null,
  anniversaries: Anniversary[],
): string | null {
  if (profile?.togetherSince && parseDateStr(profile.togetherSince)) {
    return profile.togetherSince;
  }
  let earliest: string | null = null;
  for (const a of anniversaries) {
    if (!parseDateStr(a.date)) continue;
    if (earliest === null || a.date < earliest) earliest = a.date;
  }
  return earliest;
}

/**
 * Full days together: 1 on the together day itself. Null when no date.
 */
export function daysTogether(since: string | null, now: Date = new Date()): number | null {
  if (!since) return null;
  const start = parseDateStr(since);
  if (!start) return null;
  const diffMs = midnight(now).getTime() - midnight(start).getTime();
  if (diffMs < 0) return null; // date is in the future — don't invent
  return Math.floor(diffMs / 86400000) + 1;
}

/** Validate a YYYY-MM-DD date string for setTogetherSince. */
export function isValidTogetherDate(s: string): boolean {
  return parseDateStr(s) !== null;
}
