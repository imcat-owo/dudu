/**
 * On-this-day data port for the in-session outreach evaluation.
 *
 * The background scheduler (local-app.tsx `listOnThisDay`) feeds
 * `OutreachEvalInput.onThisDay` so the engine can fire the on_this_day
 * trigger. The in-session evaluation in local-agent.ts runTurn() must feed
 * the SAME input — otherwise the on_this_day case in
 * outreach/prompt.ts buildOutreachSection is dead code (round-3 xiaomeng
 * review FAIL, 2026-10-05).
 *
 * PURE + node-safe: no react-native imports, safe under tsx for tests.
 * Never throws — a data failure degrades to "trigger off", never a broken
 * prompt.
 */

import { getOnThisDay } from "../our-space/on-this-day.js";
import type { OurSpaceStore } from "../our-space/store.js";

/** The engine's onThisDay input shape: the single most poignant memory. */
export interface OnThisDayEvalInput {
  title: string;
  yearsAgo: number;
}

/**
 * Fetch the top on-this-day memory (this month-day in a previous year).
 * Returns null when there is none or the data can't be read.
 */
export async function buildOnThisDayInput(
  os: Pick<OurSpaceStore, "listDiary" | "listTimeline" | "listAnniversaries">,
): Promise<OnThisDayEvalInput | null> {
  try {
    const [diary, timeline, anniversaries] = await Promise.all([
      os.listDiary(200).catch(() => []),
      os.listTimeline(200).catch(() => []),
      os.listAnniversaries().catch(() => []),
    ]);
    const items = getOnThisDay(diary, timeline, anniversaries, new Date());
    return items.length > 0 ? { title: items[0].title, yearsAgo: items[0].yearsAgo } : null;
  } catch {
    return null;
  }
}
