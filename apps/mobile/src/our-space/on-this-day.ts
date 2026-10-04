/**
 * 去年今日 — "On this day" in previous years. PURE module.
 *
 * Automatically surfaces what happened on this month-day in past years:
 * diary entries, timeline moments, and anniversaries. No manual work —
 * the system remembers so he doesn't have to.
 */

import type { Anniversary, DiaryEntry, TimelineEvent } from "./store.js";

export type OnThisDayKind = "diary" | "timeline" | "anniversary";

export interface OnThisDayItem {
  /** How many years ago, e.g. 1 = last year. */
  yearsAgo: number;
  kind: OnThisDayKind;
  title: string;
  /** Extra context: diary content snippet, timeline description, anniversary date. */
  subtitle: string;
  /** Original full date for display, e.g. "2025-10-04". */
  originalDate: string;
}

function monthDay(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${m}-${day}`;
}

function parseDateStr(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Find everything from previous years that happened on today's month-day.
 * Sorted by yearsAgo ascending (most recent first).
 */
export function getOnThisDay(
  diary: DiaryEntry[],
  timeline: TimelineEvent[],
  anniversaries: Anniversary[],
  now: Date = new Date(),
): OnThisDayItem[] {
  const target = monthDay(now);
  const thisYear = now.getFullYear();
  const items: OnThisDayItem[] = [];

  for (const e of diary) {
    const d = parseDateStr(e.date);
    if (!d) continue;
    if (monthDay(d) !== target) continue;
    if (d.getFullYear() >= thisYear) continue;
    items.push({
      yearsAgo: thisYear - d.getFullYear(),
      kind: "diary",
      title: e.title,
      subtitle: e.content.length > 60 ? `${e.content.slice(0, 60)}…` : e.content,
      originalDate: e.date,
    });
  }

  for (const e of timeline) {
    const d = new Date(e.timestamp);
    if (monthDay(d) !== target) continue;
    if (d.getFullYear() >= thisYear) continue;
    items.push({
      yearsAgo: thisYear - d.getFullYear(),
      kind: "timeline",
      title: e.title,
      subtitle: e.description,
      originalDate: `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`,
    });
  }

  for (const a of anniversaries) {
    const d = parseDateStr(a.date);
    if (!d) continue;
    if (monthDay(d) !== target) continue;
    if (d.getFullYear() >= thisYear) continue;
    items.push({
      yearsAgo: thisYear - d.getFullYear(),
      kind: "anniversary",
      title: a.title,
      subtitle: a.description,
      originalDate: a.date,
    });
  }

  items.sort((x, y) => x.yearsAgo - y.yearsAgo);
  return items;
}
