/**
 * Proactive initiative （主动约定） — scheduling.
 *
 * Two-sided design (her approved plan):
 * - Foreground tick (30s + every foreground event): if a rule is due,
 *   cancel its pre-scheduled notification and run the AI generation path —
 *   the message lands directly in the dialog (she's looking; no ping).
 * - Background: a pre-scheduled template notification rings first ("点开看看").
 *   Tapping it opens the dialog, and the tap itself triggers ONE AI
 *   generation (not an auto-retry — it's the delivery she asked for).
 *
 * Overdue slots (app was killed): the foreground tick only delivers a
 * slot within the 15-minute grace window (INITIATIVE_TICK_GRACE_MS). An
 * older slot is consumed silently — marked fired, never delivered, never
 * backfilled. Tapping the notification she received is NOT grace-limited:
 * a tap is the delivery she asked for. Interrupted execution is never
 * retried — hard constraint.
 *
 * SEAM FOR HARNESS PHASE 2: the background half only needs "wake up and
 * call checkDueInitiatives(deps)". The keep-alive layer (not built yet)
 * can call that from a background task; nothing else changes.
 */

import { t } from "../i18n";
import type { NotificationPort } from "../outreach/notify";
import {
  dueSlot,
  fireInitiativeRule,
  type InitiativeExecutorDeps,
  initiativeNotificationId,
  isSlotExpired,
} from "./executor";
import { type InitiativeRule, nextFireAt, slotId } from "./rules";

export interface InitiativeSchedulerDeps extends InitiativeExecutorDeps {
  notifications: NotificationPort;
}

/** Foreground tick cadence. */
export const INITIATIVE_TICK_MS = 30_000;

/** Notification ids for initiative rules all share this prefix. */
export function isInitiativeNotificationId(id: string): boolean {
  return id.startsWith("dudu-initiative-");
}

interface NotificationCopy {
  title(rule: InitiativeRule): string;
  body(rule: InitiativeRule): string;
}

const defaultCopy: NotificationCopy = {
  title: (rule) => rule.title,
  body: () => t("initiative.notif.body"),
};

/**
 * Pre-schedule the template notification for a rule's next fire time.
 * At most one per rule; one_time rules with a past time are cancelled.
 */
export async function ensureScheduled(
  deps: InitiativeSchedulerDeps,
  rule: InitiativeRule,
  nowMs: number = Date.now(),
  text: NotificationCopy = defaultCopy,
): Promise<void> {
  const id = initiativeNotificationId(rule.id);
  try {
    if (rule.status !== "active") {
      await deps.notifications.cancelScheduledNotificationAsync(id).catch(() => {});
      return;
    }
    const next = nextFireAt(rule, nowMs);
    if (next === null) {
      await deps.notifications.cancelScheduledNotificationAsync(id).catch(() => {});
      return;
    }
    const seconds = Math.max(1, Math.ceil((next - nowMs) / 1000));
    const granted = await deps.notifications
      .getPermissionsAsync()
      .then((p) => p.status === "granted")
      .catch(() => false);
    if (!granted) return;
    await deps.notifications
      .scheduleNotificationAsync({
        identifier: id,
        content: {
          title: text.title(rule),
          body: text.body(rule),
          data: { kind: "initiative", ruleId: rule.id, slotTime: String(next) },
        },
        trigger: { seconds },
      })
      .catch(() => {});
  } catch {
    // Scheduling bookkeeping must never break the app.
  }
}

/** Cancel a rule's pre-scheduled notification. Idempotent, never throws. */
export async function cancelScheduled(
  notifications: NotificationPort,
  ruleId: string,
): Promise<void> {
  try {
    await notifications
      .cancelScheduledNotificationAsync(initiativeNotificationId(ruleId))
      .catch(() => {});
  } catch {
    // ignore
  }
}

/**
 * Foreground check: for every active rule, if a slot is due, cancel the
 * pre-scheduled notification and run the AI path. Fire-and-forget per
 * rule (one slow rule never blocks the others). Never throws.
 *
 * Grace window (P1-1): a slot older than INITIATIVE_TICK_GRACE_MS is
 * consumed silently — marked fired, never delivered. The tap path is
 * separate and unlimited.
 */
export async function checkDueInitiatives(
  deps: InitiativeSchedulerDeps,
  nowMs: number = Date.now(),
): Promise<void> {
  let rules: InitiativeRule[] = [];
  try {
    rules = await deps.initiativeStore.list(false);
  } catch {
    return;
  }
  await Promise.all(
    rules.map(async (rule) => {
      try {
        const slot = dueSlot(rule, nowMs);
        if (slot === null) return;
        await cancelScheduled(deps.notifications, rule.id);
        if (isSlotExpired(slot, nowMs)) {
          // Missed too long ago: consume, never deliver on the tick.
          await deps.initiativeStore.markSlotFired(slotId(rule.id, slot)).catch(() => {});
          return;
        }
        await fireInitiativeRule(deps, rule.id, slot);
      } catch {
        // One rule's failure never breaks the sweep.
      }
    }),
  );
}

/**
 * Reschedule all active rules (call after create/update/archive/delete).
 * Never throws.
 */
export async function rescheduleAll(
  deps: InitiativeSchedulerDeps,
  nowMs: number = Date.now(),
): Promise<void> {
  let rules: InitiativeRule[] = [];
  try {
    rules = await deps.initiativeStore.list(false);
  } catch {
    return;
  }
  await Promise.all(rules.map((r) => ensureScheduled(deps, r, nowMs)));
}

/**
 * Notification tap handler: she tapped the template notification. Deliver
 * the promised message ONCE (slot ledger dedupes double taps / cold-start
 * replays). Returns the fire outcome, or null when the slot is gone.
 */
export async function handleInitiativeTap(
  deps: InitiativeSchedulerDeps,
  ruleId: string,
  slotTime: number,
): Promise<{ fired: boolean; threadId?: string } | null> {
  try {
    const slot = `${ruleId}:${slotTime}`;
    if (await deps.initiativeStore.wasSlotFired(slot).catch(() => true)) return null;
    const outcome = await fireInitiativeRule(deps, ruleId, slotTime);
    if (outcome.fired) return { fired: true, threadId: outcome.threadId };
    return { fired: false };
  } catch {
    return null;
  }
}
