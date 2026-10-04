/**
 * Her rhythm (她的作息) — PURE module, no React Native imports.
 *
 * She sleeps days and lives nights (昼伏夜出 — a durable fact from memory).
 * Everything time-sensitive must run on HER clock, not the wall clock:
 *  - greetings (a 4am "night" bucket is wrong — for her that's bedtime),
 *  - the outreach silence trigger,
 *  - quiet hours: never schedule a proactive notification while she's
 *    asleep (06:00–16:00 Asia/Shanghai), unless it's an anniversary.
 *
 * V1 is a fixed window, not a learned profile (audit round 2, xiaomeng
 * P2-3). If she ever says her schedule changed, these constants are the
 * single place to update.
 */

/** She sleeps roughly 06:00–16:00 (Asia/Shanghai). */
export const HER_SLEEP_START_HOUR = 6;
export const HER_SLEEP_END_HOUR = 16;

/** Her moment of day, on her clock. */
export type HerMoment =
  | "deep-sleep" // 06:00–14:00 — almost certainly asleep
  | "waking" // 14:00–18:00 — around wake-up time
  | "evening" // 18:00–24:00 — her active hours
  | "late-night" // 00:00–03:00 — still up, winding down soon
  | "pre-dawn"; // 03:00–06:00 — about to sleep

function shanghaiHour(nowMs: number): number {
  // Hour of day in Asia/Shanghai, 0–23. String round-trip is the
  // timezone-safe way without pulling in a date library.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date(nowMs));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  return h;
}

/** True when she's almost certainly asleep. Proactive outreach stays silent. */
export function isHerSleepTime(nowMs: number = Date.now()): boolean {
  const h = shanghaiHour(nowMs);
  return h >= HER_SLEEP_START_HOUR && h < HER_SLEEP_END_HOUR;
}

/** Where she is in her day, on her clock. */
export function describeHerMoment(nowMs: number = Date.now()): HerMoment {
  const h = shanghaiHour(nowMs);
  if (h >= HER_SLEEP_START_HOUR && h < 14) return "deep-sleep";
  if (h >= 14 && h < 18) return "waking";
  if (h >= 18 && h < 24) return "evening";
  if (h >= 0 && h < 3) return "late-night";
  return "pre-dawn";
}

/**
 * One line for the system prompt: her rhythm, what "now" means for her,
 * and the quiet-hours rule. Empty guidance is never returned — the line
 * is always true, because the window is a fixed fact.
 */
export function buildHerRhythmSection(nowMs: number = Date.now()): string {
  const moment = describeHerMoment(nowMs);
  const state: Record<HerMoment, string> = {
    "deep-sleep": "she is almost certainly asleep",
    waking: "she is around her wake-up time",
    evening: "she is awake — these are her active hours",
    "late-night": "she is still up, likely winding down",
    "pre-dawn": "she is about to sleep",
  };
  return (
    `Her rhythm (she is a night owl — this is a fixed fact about her): she sleeps roughly ` +
    `06:00–16:00 Asia/Shanghai (this window is fixed to her home timezone, ` +
    `not the device timezone — she travels, the window does not move) ` +
    `and lives at night. Right now, ${state[moment]}. ` +
    `Never treat 06:00–16:00 as "daytime she is available", and never schedule ` +
    `anything noisy in that window unless it is an anniversary.`
  );
}
