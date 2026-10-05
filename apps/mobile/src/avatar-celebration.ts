/**
 * Milestone celebration signal for the animated avatar (A3 wiring).
 *
 * A task card freshly reaching "done", or opening 我们的空间 on an
 * anniversary day, triggers an 8-second `milestone_level_up` clip via
 * triggerMilestoneCelebration(). `useLiveAvatarState` (animated-avatar.tsx)
 * resolves it through resolveAvatarState() and falls back to the live
 * signals (making_something / working / idle) afterwards.
 *
 * PURE module: no React Native / expo imports — safe to import from stores
 * (e.g. our-space/task-progress.ts) and from plain-node tests.
 */
import { MILESTONE_CELEBRATION_MS } from "./avatar-state";

let celebrateUntil = 0;
/** Device-local calendar day of the last anniversary-day celebration. */
let lastAnniversaryDay = "";
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of Array.from(listeners)) {
    try {
      fn();
    } catch {
      /* subscriber errors must not break the store */
    }
  }
}

/**
 * Celebrate a milestone now: the avatar plays `milestone_level_up` for
 * MILESTONE_CELEBRATION_MS, then falls back to the live signals.
 */
export function triggerMilestoneCelebration(now: number = Date.now()): void {
  celebrateUntil = now + MILESTONE_CELEBRATION_MS;
  emit();
}

/**
 * Anniversary-day celebration, at most once per calendar day.
 * `dayKey` should identify the device-local day (e.g. Date#toDateString).
 * Returns true when a celebration was triggered.
 */
export function triggerAnniversaryCelebration(dayKey: string, now: number = Date.now()): boolean {
  if (lastAnniversaryDay === dayKey) return false;
  lastAnniversaryDay = dayKey;
  triggerMilestoneCelebration(now);
  return true;
}

/** Test-only reset of module state. */
export function resetCelebrationForTests(): void {
  celebrateUntil = 0;
  lastAnniversaryDay = "";
}

export function getCelebrateUntil(): number {
  return celebrateUntil;
}

export function subscribeCelebration(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
