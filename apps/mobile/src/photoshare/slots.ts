/**
 * AI photo share （主动发照片） — quiet-slot computation. PURE.
 *
 * Same idea as the self-post trigger's quiet moments: a few times a day,
 * on HER clock (Asia/Shanghai, night owl — she sleeps roughly
 * 06:00–16:00), the app asks the model once whether it has a genuine
 * photo moment worth sharing. The model decides; silence is fine.
 *
 * Fewer moments than self-posts: a surprise photo is more intrusive than
 * a quiet feed post, so the default is 2/day and the master toggle
 * defaults to OFF (opt-in — she decides if the AI may surprise her).
 */

interface ShanghaiParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
}

function shanghaiParts(ms: number): ShanghaiParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const get = (type: string) =>
    Number(fmt.formatToParts(new Date(ms)).find((p) => p.type === type)?.value ?? "0");
  return {
    y: get("year"),
    mo: get("month"),
    d: get("day"),
    h: get("hour") % 24,
    mi: get("minute"),
  };
}

/** Shanghai wall-clock → epoch ms. Shanghai has no DST: one pass is exact. */
function shanghaiWallToMs(p: ShanghaiParts): number {
  const guess = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
  const w = shanghaiParts(guess);
  const wallAsUTC = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);
  return guess - (wallAsUTC - guess);
}

/**
 * Candidate quiet moments, spread across her active hours, in spread-first
 * order: taking the first N gives good coverage for any N in 1..4.
 * All on the Shanghai wall clock, all outside her 06:00–16:00 sleep.
 */
export const PHOTOSHARE_SLOT_CANDIDATES: ReadonlyArray<{ h: number; mi: number; label: string }> = [
  { h: 20, mi: 0, label: "evening" }, // 20:00 — her evening, settled in
  { h: 0, mi: 30, label: "late-night" }, // 00:30 — late night, winding down
  { h: 17, mi: 0, label: "waking" }, // 17:00 — around wake-up
  { h: 22, mi: 30, label: "evening" }, // 22:30 — before the late stretch
];

export const PHOTOSHARE_SLOT_COUNT_MIN = 1;
export const PHOTOSHARE_SLOT_COUNT_MAX = 4;
export const PHOTOSHARE_SLOT_COUNT_DEFAULT = 2;

export function clampSlotCount(n: unknown): number {
  const v =
    typeof n === "number" && Number.isFinite(n) ? Math.round(n) : PHOTOSHARE_SLOT_COUNT_DEFAULT;
  return Math.min(PHOTOSHARE_SLOT_COUNT_MAX, Math.max(PHOTOSHARE_SLOT_COUNT_MIN, v));
}

export interface PhotoshareSlot {
  index: number;
  atMs: number;
  label: string;
}

/**
 * Today's slot times for the first `slotCount` candidates.
 * Pure — inject nowMs for tests.
 */
export function photoshareSlotsToday(slotCount: number, nowMs: number): PhotoshareSlot[] {
  const n = clampSlotCount(slotCount);
  const p = shanghaiParts(nowMs);
  return PHOTOSHARE_SLOT_CANDIDATES.slice(0, n).map((c, index) => ({
    index,
    atMs: shanghaiWallToMs({ ...p, h: c.h, mi: c.mi }),
    label: c.label,
  }));
}

/** Ledger id for one slot: stable per Shanghai day + slot index. */
export function photoshareSlotId(dayStartMs: number, index: number): string {
  return `photoshare:${dayStartMs}:${index}`;
}

/**
 * The most recent slot at or before nowMs that hasn't fired yet.
 * Returns null when nothing is due.
 */
export function dueSlot(
  slots: PhotoshareSlot[],
  firedSlotIds: ReadonlySet<string>,
  dayStartMs: number,
  nowMs: number,
): PhotoshareSlot | null {
  let best: PhotoshareSlot | null = null;
  for (const s of slots) {
    if (s.atMs > nowMs) continue;
    if (firedSlotIds.has(photoshareSlotId(dayStartMs, s.index))) continue;
    if (!best || s.atMs > best.atMs) best = s;
  }
  return best;
}

/**
 * Foreground-tick grace window (same anti-disturbance rule as initiative):
 * a slot only delivers when it fired no more than this long ago. Older =
 * consumed silently, never backfilled. Interrupted execution is never
 * retried — her hard constraint.
 */
export const PHOTOSHARE_TICK_GRACE_MS = 15 * 60_000;

/** True when a slot is too old for the foreground tick to act on. */
export function isSlotExpired(slotTime: number, nowMs: number): boolean {
  return nowMs - slotTime > PHOTOSHARE_TICK_GRACE_MS;
}
