/**
 * Proactive outreach (主动触达) — delivery scheduler.
 *
 * How it works (local-first, honest about platform limits):
 *  - On app background: evaluate triggers NOW, schedule at most ONE local
 *    notification for the top trigger. It fires after a delay (6h active /
 *    12h moderate) — only if she hasn't come back. No trigger = no message,
 *    ever. Previously scheduled outreach notifications are cancelled first.
 *  - On app foreground: cancel the scheduled notification (she's here now),
 *    record lastOpenedAt, and let the in-session prompt section
 *    (outreach/prompt.ts) carry the trigger into conversation naturally.
 *  - Copy is composed at schedule time from her-tone templates (嘟嘟腔:
 *    "我想起你", never "系统通知你"). Runtime AI generation is impossible
 *    while backgrounded on iOS, so the templates are crafted copy, not
 *    placeholders — documented honestly in the manual.
 *  - Every scheduled outreach is logged to the cross-dialog audit trace
 *    (action "proactive_send") so she can always see what he sent and why.
 *  - 安静档 never schedules. Notification permission denied → skip
 *    silently (never nag for permission from the background).
 */

import type { NewTraceEntry } from "../chat/cross-dialog-trace.js";
import {
  OUTREACH_DELAY_SECONDS,
  evaluateOutreachTriggers,
  type OutreachFrequency,
  type OutreachTrigger,
  type OutreachTriggerKind,
} from "./engine.js";
import { getUpcomingAnniversaries } from "../our-space/anniversary-section.js";
import type { Anniversary } from "../our-space/store.js";
import type { OutreachStore } from "./store.js";

/** Identifier so we can cancel/replace our own scheduled notification. */
export const OUTREACH_NOTIFICATION_ID = "dudu-outreach";

export interface NotificationPort {
  getPermissionsAsync(): Promise<{ status: string }>;
  cancelScheduledNotificationAsync(identifier: string): Promise<void>;
  scheduleNotificationAsync(request: {
    identifier: string;
    content: { title: string; body: string };
    trigger: { seconds: number };
  }): Promise<string>;
}

export interface TracePort {
  append(entry: NewTraceEntry): Promise<unknown>;
}

export interface OutreachDataPorts {
  listAnniversaries(): Promise<{ title: string; date: string }[]>;
  /** Pending (not done) tell-later items, oldest first. */
  listPendingTellLater(): Promise<{ id: string; text: string }[]>;
  countUnreadLoveLetters(): Promise<number>;
}

export type CopyFn = (key: string, params?: Record<string, string | number>) => string;

function notifCopy(t: OutreachTrigger, copy: CopyFn): { title: string; body: string } {
  switch (t.kind) {
    case "anniversary":
      return {
        title: copy("outreach.notif.anniversary.title"),
        body: copy("outreach.notif.anniversary.body", { title: t.detail, days: t.daysUntil ?? 0 }),
      };
    case "love_letter":
      return {
        title: copy("outreach.notif.loveLetter.title"),
        body: copy("outreach.notif.loveLetter.body"),
      };
    case "tell_later":
      return {
        title: copy("outreach.notif.tellLater.title"),
        body: t.detail,
      };
    case "silence":
      return {
        title: copy("outreach.notif.silence.title"),
        body: copy("outreach.notif.silence.body"),
      };
  }
}

export interface ScheduleResult {
  scheduled: boolean;
  /** Machine-readable reason when not scheduled (for tests/logs). */
  reason?: "quiet" | "no-trigger" | "no-permission" | "failed";
  trigger?: OutreachTriggerKind;
}

/**
 * Evaluate triggers and schedule one notification for the top trigger.
 * Never throws — delivery must never break the app lifecycle.
 */
export async function evaluateAndScheduleOutreach(deps: {
  store: OutreachStore;
  notifications: NotificationPort;
  trace: TracePort;
  data: OutreachDataPorts;
  copy: CopyFn;
  now?: number;
}): Promise<ScheduleResult> {
  const now = deps.now ?? Date.now();
  try {
    const frequency: OutreachFrequency = await deps.store.getFrequency();
    if (frequency === "quiet") return { scheduled: false, reason: "quiet" };

    // Gather trigger inputs. Each read is guarded — a failing source
    // degrades to "no data", never to a fabricated trigger.
    let anniversaries: { title: string; daysUntil: number }[] = [];
    try {
      const all = await deps.data.listAnniversaries();
      const full: Anniversary[] = all.map((a) => ({
        id: "",
        title: a.title,
        date: a.date,
        description: "",
        createdAt: 0,
      }));
      anniversaries = getUpcomingAnniversaries(full, new Date(now), 30).map((a) => ({
        title: a.title,
        daysUntil: a.daysUntil,
      }));
    } catch {
      anniversaries = [];
    }
    let pendingTellLater: { id: string; text: string }[] = [];
    try {
      pendingTellLater = await deps.data.listPendingTellLater();
    } catch {
      pendingTellLater = [];
    }
    let unreadLoveLetters = 0;
    try {
      unreadLoveLetters = await deps.data.countUnreadLoveLetters();
    } catch {
      unreadLoveLetters = 0;
    }
    const lastOpenedAt = await deps.store.getLastOpenedAt().catch(() => null);
    const lastOutreachAt = await deps.store.getLastOutreachAt().catch(() => ({}));

    const triggers = evaluateOutreachTriggers({
      frequency,
      now,
      anniversaries,
      pendingTellLater,
      unreadLoveLetters,
      lastOpenedAt,
      lastOutreachAt,
    });
    if (triggers.length === 0) return { scheduled: false, reason: "no-trigger" };
    const top = triggers[0];

    // Permission gate: never nag for permission from the background.
    let status = "denied";
    try {
      status = (await deps.notifications.getPermissionsAsync()).status;
    } catch {
      status = "denied";
    }
    if (status !== "granted") return { scheduled: false, reason: "no-permission" };

    // Replace any previously scheduled outreach (one at a time, always).
    try {
      await deps.notifications.cancelScheduledNotificationAsync(OUTREACH_NOTIFICATION_ID);
    } catch {
      // Best effort.
    }
    const { title, body } = notifCopy(top, deps.copy);
    await deps.notifications.scheduleNotificationAsync({
      identifier: OUTREACH_NOTIFICATION_ID,
      content: { title, body },
      trigger: { seconds: OUTREACH_DELAY_SECONDS[frequency] },
    });

    await deps.store.markOutreach(top.kind, now);
    // 留痕: she can always see what he sent and why.
    try {
      await deps.trace.append({
        action: "proactive_send",
        fromThreadId: "proactive",
        fromName: "proactive",
        summary: `${title} — ${body}`.slice(0, 200),
        reason: `outreach trigger: ${top.kind}${top.detail ? ` (${top.detail.slice(0, 60)})` : ""}`,
        personaId: "default",
      });
    } catch {
      // Trace failure must not unschedule a valid outreach; the next
      // evaluation will see the cooldown and stay silent.
    }
    return { scheduled: true, trigger: top.kind };
  } catch {
    return { scheduled: false, reason: "failed" };
  }
}

/** Cancel the scheduled outreach (she came back — no need to nudge). Never throws. */
export async function cancelScheduledOutreach(notifications: NotificationPort): Promise<void> {
  try {
    await notifications.cancelScheduledNotificationAsync(OUTREACH_NOTIFICATION_ID);
  } catch {
    // Best effort.
  }
}
