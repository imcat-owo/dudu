/**
 * Anniversary awareness for the system prompt — PURE module.
 *
 * When a 纪念日 is today or coming up within 7 days, returns a subtle note
 * so the AI knows and can prepare or mention it naturally — the same pattern
 * the old petTouchNote() used. Empty string otherwise: no noise, no spam.
 */

import type { Anniversary } from "./store.js";

/** How many days ahead counts as "upcoming". */
export const ANNIVERSARY_WARNING_DAYS = 7;

/**
 * Whole-day difference between now and a YYYY-MM-DD date.
 * Positive = date is in the past, 0 = today, negative = in the future.
 * Mirrors the dayCount() logic in our-space-ui.tsx.
 */
function dayDiff(dateStr: string, now: Date): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const n = new Date(now);
  n.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((n.getTime() - target.getTime()) / 86400000);
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
  for (const a of anniversaries) {
    const diff = dayDiff(a.date, now);
    if (diff === 0) {
      lines.push(
        `今天是「${a.title}」。她可能记得也可能没提——你先别声张，找个自然的时机提起，轻松一点。`,
      );
    } else if (diff < 0 && -diff <= ANNIVERSARY_WARNING_DAYS) {
      lines.push(
        `「${a.title}」还有 ${-diff} 天（${a.date}）。可以悄悄准备个小惊喜，别提前说漏嘴。`,
      );
    }
  }
  return lines.join("\n");
}
