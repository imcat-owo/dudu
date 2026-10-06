/**
 * AI photo share （主动发照片） — scheduling.
 *
 * Foreground tick: compute today's quiet slots, find the most recent due
 * & unfired slot, and fire it. Fire-and-forget, never throws.
 *
 * A photo share is quiet-ish by design: it lands in the dialog like any
 * proactive message (no separate ping — same as the mood check-in and
 * follow-up one_time fires). She finds it when she opens the chat.
 *
 * SEAM FOR HARNESS PHASE 2: the background half only needs "wake up and
 * call checkDuePhotoshareSlots(deps)". The keep-alive layer (not built
 * yet) can call that from a background task; nothing else changes.
 */

import { shanghaiDayStart } from "../initiative/rules";
import { firePhotoshareSlot, type PhotoshareExecutorDeps } from "./executor";
import { dueSlot, isSlotExpired, photoshareSlotId, photoshareSlotsToday } from "./slots";

export interface PhotoshareSchedulerDeps extends PhotoshareExecutorDeps {}

/** Foreground tick cadence. Slots are daily; 60s is plenty. */
export const PHOTOSHARE_TICK_MS = 60_000;

/**
 * Check today's slots and fire the most recent due one. Expired slots
 * (older than the 15-min grace) are consumed silently — never backfilled.
 * Never throws.
 */
export async function checkDuePhotoshareSlots(deps: PhotoshareSchedulerDeps): Promise<void> {
  try {
    const now = deps.nowMs();
    const config = await deps.photoshareStore.getConfig().catch(() => null);
    if (!config?.enabled) return;
    const dayStart = shanghaiDayStart(now);
    const slots = photoshareSlotsToday(config.slotCount, now);
    const fired = await deps.photoshareStore.firedSlotIds().catch(() => new Set<string>());

    // Consume expired slots first (silent — the executor would do it on
    // fire anyway, but doing it here keeps the ledger tidy even when the
    // gate would veto).
    for (const s of slots) {
      const id = photoshareSlotId(dayStart, s.index);
      if (s.atMs <= now && !fired.has(id) && isSlotExpired(s.atMs, now)) {
        await deps.photoshareStore.markSlotFired(s, now).catch(() => {});
        fired.add(id);
      }
    }

    const due = dueSlot(slots, fired, dayStart, now);
    if (!due) return;
    // Fire-and-forget: the executor is fail-closed and never throws, but
    // one slow decision+generation must never block the tick.
    void firePhotoshareSlot(deps, due).catch(() => {});
  } catch {
    // Scheduling bookkeeping must never break the app.
  }
}
