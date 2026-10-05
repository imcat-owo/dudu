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
 *
 * The anniversary once-per-day guard is persisted through an injectable
 * storage (AsyncStorage in production, wired by avatar-celebration-instance.ts;
 * a Map-backed fake in tests — same pattern as our-space/task-progress.ts),
 * so killing and reopening the app on an anniversary day does not replay
 * the celebration.
 */
import { MILESTONE_CELEBRATION_MS } from "./avatar-state";

let celebrateUntil = 0;
/** Device-local calendar day of the last anniversary-day celebration. */
let lastAnniversaryDay = "";

/** Minimal storage surface — AsyncStorage satisfies this. */
export interface CelebrationStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const ANNIVERSARY_DAY_KEY = "dudu.avatar.anniversary-day.v1";

let storage: CelebrationStorage | null = null;

/**
 * Production wiring (call once from avatar-celebration-instance.ts) or
 * tests. Pass null to detach.
 */
export function setCelebrationStorage(s: CelebrationStorage | null): void {
  storage = s;
}

async function readPersistedDay(): Promise<string | null> {
  if (!storage) return null;
  try {
    return await storage.getItem(ANNIVERSARY_DAY_KEY);
  } catch {
    return null;
  }
}

async function writePersistedDay(dayKey: string): Promise<void> {
  if (!storage) return;
  try {
    await storage.setItem(ANNIVERSARY_DAY_KEY, dayKey);
  } catch {
    // Non-fatal: the in-memory guard still holds for this session.
  }
}
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
 * Anniversary-day celebration, at most once per calendar day — persisted,
 * so the guard survives app restarts (kill-and-reopen on the same day does
 * not replay the celebration).
 * `dayKey` should identify the device-local day (e.g. Date#toDateString).
 * Returns true when a celebration was triggered.
 */
export async function triggerAnniversaryCelebration(
  dayKey: string,
  now: number = Date.now(),
): Promise<boolean> {
  if (lastAnniversaryDay === dayKey) return false;
  const persisted = await readPersistedDay();
  if (persisted === dayKey) {
    lastAnniversaryDay = dayKey; // sync the in-memory fast path
    return false;
  }
  // Claim it synchronously so concurrent same-day triggers can't double-fire.
  lastAnniversaryDay = dayKey;
  await writePersistedDay(dayKey);
  triggerMilestoneCelebration(now);
  return true;
}

/**
 * Test-only reset of module state. Clears in-memory state ONLY — persisted
 * storage is intentionally left intact so tests can simulate an app restart.
 */
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
