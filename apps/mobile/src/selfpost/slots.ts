/**
 * AI self-post trigger （自发帖触发器） — quiet-slot computation. PURE.
 *
 * Her 10-05 口径: "每天几个安静时刻问模型一次、由 AI 自决".
 * Slots live on HER clock (Asia/Shanghai, night owl): she sleeps roughly
 * 06:00–16:00, so all candidate moments sit inside her active window
 * 16:00–06:00. Never in her sleep window — that is a hard block, not a
 * preference.
 *
 * GitHub patterns borrowed (see report): purriatecat/ai-chatbot's
 * quiet-scan + hold (no churn); proactive-gate's quiet-hours-as-data.
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
 * order: taking the first N gives good coverage for any N in 1..5.
 * All on the Shanghai wall clock, all outside her 06:00–16:00 sleep.
 */
export const SELFPOST_SLOT_CANDIDATES: ReadonlyArray<{ h: number; mi: number; label: string }> = [
  { h: 17, mi: 30, label: "waking" }, // 17:30 — around wake-up, quiet start
  { h: 21, mi: 0, label: "evening" }, // 21:00 — her evening, settled in
  { h: 1, mi: 0, label: "late-night" }, // 01:00 — late night, winding down
  { h: 19, mi: 30, label: "evening" }, // 19:30 — evening, second chance
  { h: 23, mi: 30, label: "evening" }, // 23:30 — before the late stretch
];

export const SELFPOST_SLOT_COUNT_MIN = 1;
export const SELFPOST_SLOT_COUNT_MAX = 5;
export const SELFPOST_SLOT_COUNT_DEFAULT = 3;

export function clampSlotCount(n: unknown): number {
  const v =
    typeof n === "number" && Number.isFinite(n) ? Math.round(n) : SELFPOST_SLOT_COUNT_DEFAULT;
  return Math.min(SELFPOST_SLOT_COUNT_MAX, Math.max(SELFPOST_SLOT_COUNT_MIN, v));
}

export interface SelfpostSlot {
  index: number;
  atMs: number;
  label: string;
}

/**
 * Today's slot times for the first `slotCount` candidates.
 * Pure — inject nowMs for tests.
 */
export function selfpostSlotsToday(slotCount: number, nowMs: number): SelfpostSlot[] {
  const n = clampSlotCount(slotCount);
  const p = shanghaiParts(nowMs);
  return SELFPOST_SLOT_CANDIDATES.slice(0, n).map((c, index) => ({
    index,
    atMs: shanghaiWallToMs({ ...p, h: c.h, mi: c.mi }),
    label: c.label,
  }));
}

/** Ledger id for one slot: stable per Shanghai day + slot index. */
export function selfpostSlotId(dayStartMs: number, index: number): string {
  return `selfpost:${dayStartMs}:${index}`;
}

/**
 * The most recent slot at or before nowMs that hasn't fired yet.
 * Returns null when nothing is due.
 */
export function dueSlot(
  slots: SelfpostSlot[],
  firedSlotIds: ReadonlySet<string>,
  dayStartMs: number,
  nowMs: number,
): SelfpostSlot | null {
  let best: SelfpostSlot | null = null;
  for (const s of slots) {
    if (s.atMs > nowMs) continue;
    if (firedSlotIds.has(selfpostSlotId(dayStartMs, s.index))) continue;
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
export const SELFPOST_TICK_GRACE_MS = 15 * 60_000;

/** True when a slot is too old for the foreground tick to act on. */
export function isSlotExpired(slotTime: number, nowMs: number): boolean {
  return nowMs - slotTime > SELFPOST_TICK_GRACE_MS;
}
