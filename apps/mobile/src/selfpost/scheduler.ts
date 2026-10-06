/**
 * AI self-post trigger （自发帖触发器） — scheduling.
 *
 * Foreground tick: compute today's quiet slots, find the most recent due
 * & unfired slot, and fire it. Fire-and-forget, never throws.
 *
 * Unlike initiative there is no pre-scheduled notification: a feed post
 * is quiet by design — she finds it when she opens Our Space. No ping.
 *
 * SEAM FOR HARNESS PHASE 2: the background half only needs "wake up and
 * call checkDueSelfpostSlots(deps)". The keep-alive layer (not built yet)
 * can call that from a background task; nothing else changes.
 */

import { shanghaiDayStart } from "../initiative/rules";
import { fireSelfpostSlot, type SelfpostExecutorDeps } from "./executor";
import { dueSlot, isSlotExpired, selfpostSlotId, selfpostSlotsToday } from "./slots";

export interface SelfpostSchedulerDeps extends SelfpostExecutorDeps {}

/** Foreground tick cadence. Slots are daily; 60s is plenty. */
export const SELFPOST_TICK_MS = 60_000;

/**
 * Check today's slots and fire the most recent due one. Expired slots
 * (older than the 15-min grace) are consumed silently — never backfilled.
 * Never throws.
 */
export async function checkDueSelfpostSlots(deps: SelfpostSchedulerDeps): Promise<void> {
  try {
    const now = deps.nowMs();
    const config = await deps.selfpostStore.getConfig().catch(() => null);
    if (!config?.enabled) return;
    const dayStart = shanghaiDayStart(now);
    const slots = selfpostSlotsToday(config.slotCount, now);
    const fired = await deps.selfpostStore.firedSlotIds().catch(() => new Set<string>());

    // Consume expired slots first (silent — the executor would do it on
    // fire anyway, but doing it here keeps the ledger tidy even when the
    // gate would veto).
    for (const s of slots) {
      const id = selfpostSlotId(dayStart, s.index);
      if (s.atMs <= now && !fired.has(id) && isSlotExpired(s.atMs, now)) {
        await deps.selfpostStore.markSlotFired(s, now).catch(() => {});
        fired.add(id);
      }
    }

    const due = dueSlot(slots, fired, dayStart, now);
    if (!due) return;
    // Fire-and-forget: the executor is fail-closed and never throws, but
    // one slow decision call must never block the tick.
    void fireSelfpostSlot(deps, due).catch(() => {});
  } catch {
    // Scheduling bookkeeping must never break the app.
  }
}
