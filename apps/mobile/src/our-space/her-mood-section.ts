/**
 * Her-mood awareness for the system prompt — PURE module.
 *
 * When she has told him how she is feeling, one subtle line so he remembers
 * and doesn't ask the same question twice — the petTouchNote pattern.
 * Empty string when nothing recorded: no noise, no spam.
 */

import type { HerMood } from "./store.js";

/** How long a recorded mood stays relevant for injection. */
export const HER_MOOD_FRESH_DAYS = 3;

/**
 * Build the her-mood awareness section for the system prompt.
 * One subtle line; "" when no mood recorded or it is stale.
 */
export function buildHerMoodSection(mood: HerMood | null, now: Date = new Date()): string {
  if (!mood?.mood) return "";
  const ageDays = (now.getTime() - mood.updatedAt) / 86400000;
  if (ageDays > HER_MOOD_FRESH_DAYS) return "";
  const note = mood.note ? `（她说：${mood.note}）` : "";
  return `她最近的心情是「${mood.mood}」${note}。记得她提过，别明知故问，顺着她一点。`;
}
