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

import type { NewTraceEntry } from "../chat/cross-dialog-trace";
import {
  OUTREACH_DELAY_SECONDS,
  evaluateOutreachTriggers,
  isRecentNegativeMood,
  type OutreachFrequency,
  type OutreachTrigger,
  type OutreachTriggerKind,
} from "./engine";
import {
  runFeedNudge,
  type FeedNudgeActionPorts,
  type FeedNudgePost,
} from "./feed-nudge";
import { getUpcomingAnniversaries } from "../our-space/anniversary-section";
import {
  HER_SLEEP_END_HOUR,
  isHerSleepTime,
} from "../our-space/her-rhythm";
import type { Anniversary } from "../our-space/store";
import type { OutreachStore } from "./store";

export type { OutreachTriggerKind };

/** Identifier so we can cancel/replace our own scheduled notification. */
export const OUTREACH_NOTIFICATION_ID = "dudu-outreach";

export interface NotificationPort {
  getPermissionsAsync(): Promise<{ status: string }>;
  cancelScheduledNotificationAsync(identifier: string): Promise<void>;
  scheduleNotificationAsync(request: {
    identifier: string;
    content: { title: string; body: string; data?: Record<string, string> };
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
  /**
   * Diary nudge input (xiaomeng P2-1). lastEntryAt null = never written.
   * anchor: a real anchor from recent days (latest timeline event title,
   * on-this-day memory...) — empty string means "no anchor, stay silent".
   */
  getDiaryNudgeInput?(): Promise<{ lastEntryAt: number | null; anchor: string }>;
  /**
   * On-this-day memories (round 3, xiaomeng P1-1): this month-day in
   * previous years, most recent year first. Absent = the caller has no
   * on-this-day data → the trigger stays off. The engine takes the top item.
   */
  listOnThisDay?(): Promise<{ title: string; subtitle: string; yearsAgo: number }[]>;
  /**
   * Her mood as she told him (round 3, xiaomeng P2-4). Null = never
   * recorded. The engine suppresses diary_nudge when the mood is freshly
   * negative — same freshness window the mood prompt section uses.
   */
  getHerMood?(): Promise<{ mood: string; updatedAt: number } | null>;
  /**
   * Feed nudge input (C3): her recent posts with AI-interaction state.
   * Absent = the caller has no feed data → the trigger stays off.
   */
  listFeedForNudge?(): Promise<FeedNudgePost[]>;
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
    case "on_this_day":
      return {
        title: copy("outreach.notif.onThisDay.title"),
        body: copy("outreach.notif.onThisDay.body", {
          title: t.detail,
          years: t.yearsAgo ?? 1,
        }),
      };
    case "silence":
      return {
        title: copy("outreach.notif.silence.title"),
        body: copy("outreach.notif.silence.body"),
      };
    case "diary_nudge":
      return {
        title: copy("outreach.notif.diaryNudge.title"),
        body: copy("outreach.notif.diaryNudge.body", { anchor: t.detail }),
      };
    case "feed_nudge":
      // Unreachable in practice: the scheduler executes feed_nudge
      // directly (like + reply) instead of notifying. Kept for
      // exhaustiveness — the feed itself is the surface.
      return {
        title: copy("outreach.notif.feedNudge.title"),
        body: copy("outreach.notif.feedNudge.body"),
      };
  }
}

export interface ScheduleResult {
  scheduled: boolean;
  /** Machine-readable reason when not scheduled (for tests/logs). */
  reason?: "quiet" | "no-trigger" | "no-permission" | "sleep-window" | "failed";
  trigger?: OutreachTriggerKind;
}

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
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute") };
}

/**
 * Convert a Shanghai wall-clock time to epoch ms. Shanghai has no DST, so
 * one offset-correction pass is exact.
 */
function shanghaiWallToMs(p: ShanghaiParts): number {
  const guess = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
  const w = shanghaiParts(guess);
  const wallAsUTC = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);
  return guess - (wallAsUTC - guess);
}

/**
 * Sleep-window clamp (audit round 3, code P2-1): a notification scheduled
 * now with the frequency's delay may land inside her 06:00–16:00 sleep
 * window (e.g. background at 22:00 + 12h = 10:00 next day). Push the fire
 * time to 16:00 on the fire day instead of waking her. Returns the
 * adjusted delay in seconds. Pure and unit-tested.
 */
export function clampFireOutOfSleepWindow(nowMs: number, delaySeconds: number): number {
  const fireMs = nowMs + delaySeconds * 1000;
  if (!isHerSleepTime(fireMs)) return delaySeconds;
  const p = shanghaiParts(fireMs);
  const targetMs = shanghaiWallToMs({ ...p, h: HER_SLEEP_END_HOUR, mi: 0 });
  return Math.max(1, Math.round((targetMs - nowMs) / 1000));
}

/**
 * Evaluate triggers and schedule one notification for the top trigger.
 * Never throws — delivery must never break the app lifecycle.
 *
 * feed_nudge is special: instead of a notification, the top feed_nudge
 * trigger executes a like + one reply directly (the feed itself is the
 * surface — a "your AI liked your post" notification would be noise).
 */
export async function evaluateAndScheduleOutreach(deps: {
  store: OutreachStore;
  notifications: NotificationPort;
  trace: TracePort;
  data: OutreachDataPorts;
  copy: CopyFn;
  now?: number;
  /**
   * Feed nudge actions (C3): the EXISTING feed_like / feed_reply tool
   * implementations, invoked — never reimplemented. Absent = feed_nudge
   * can win the trigger evaluation but its execution fails closed.
   */
  feedActions?: FeedNudgeActionPorts;
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
    // Diary nudge input — a failing source degrades to "no nudge", never
    // to a fabricated one.
    let diaryNudge: { lastEntryAt: number | null; anchor: string } | undefined;
    try {
      diaryNudge = (await deps.data.getDiaryNudgeInput?.()) ?? undefined;
    } catch {
      diaryNudge = undefined;
    }
    // On-this-day input (round 3, xiaomeng P1-1) — top item only. A
    // failing source degrades to "no on-this-day trigger".
    let onThisDay: { title: string; yearsAgo: number } | null = null;
    try {
      const items = (await deps.data.listOnThisDay?.()) ?? [];
      const top = items.find((i) => i.title.trim().length > 0);
      onThisDay = top ? { title: top.title.trim(), yearsAgo: top.yearsAgo } : null;
    } catch {
      onThisDay = null;
    }
    // Mood gate (round 3, xiaomeng P2-4) — her own words, freshness from
    // the mood section. A failing source degrades to "no suppression".
    let recentMoodNegative = false;
    try {
      const mood = (await deps.data.getHerMood?.()) ?? null;
      recentMoodNegative = isRecentNegativeMood(mood, now);
    } catch {
      recentMoodNegative = false;
    }
    // Unread-letter nudge counting (round 3, xiaomeng P2-3). The cap is
    // per unread-letter episode: she reads the letter → counter restarts.
    let loveLetterNudgeCount = 0;
    try {
      loveLetterNudgeCount = await deps.store.getLoveLetterNudgeCount();
    } catch {
      loveLetterNudgeCount = 0;
    }
    if (unreadLoveLetters === 0 && loveLetterNudgeCount > 0) {
      try {
        await deps.store.resetLoveLetterNudgeCount();
      } catch {
        // Best effort.
      }
      loveLetterNudgeCount = 0;
    }
    const lastOpenedAt = await deps.store.getLastOpenedAt().catch(() => null);
    const lastOutreachAt = await deps.store.getLastOutreachAt().catch(() => ({}));
    // Feed nudge input (C3): her recent posts + the persisted nudged-set.
    // A failing source degrades to "no feed trigger", never to a fabricated one.
    let feedPosts: FeedNudgePost[] = [];
    try {
      feedPosts = (await deps.data.listFeedForNudge?.()) ?? [];
      if (!Array.isArray(feedPosts)) feedPosts = [];
    } catch {
      feedPosts = [];
    }
    let nudgedFeedPostIds: string[] = [];
    try {
      nudgedFeedPostIds = await deps.store.getNudgedFeedPostIds();
    } catch {
      nudgedFeedPostIds = [];
    }

    const triggers = evaluateOutreachTriggers({
      frequency,
      now,
      anniversaries,
      pendingTellLater,
      unreadLoveLetters,
      lastOpenedAt,
      lastOutreachAt,
      diaryNudge,
      onThisDay,
      recentMoodNegative,
      loveLetterNudgeCount,
      feedNudge: deps.data.listFeedForNudge ? { posts: feedPosts, nudgedPostIds: nudgedFeedPostIds } : undefined,
    });
    if (triggers.length === 0) return { scheduled: false, reason: "no-trigger" };
    const top = triggers[0];

    // Feed nudge (C3): act directly instead of notifying. The like + reply
    // are silent — no push, no wake. Sleep-window and quiet rules still
    // apply (the executor checks the sleep window itself).
    if (top.kind === "feed_nudge") {
      if (!top.postId || !deps.feedActions) {
        return { scheduled: false, reason: "failed", trigger: top.kind };
      }
      const result = await runFeedNudge({
        now,
        posts: feedPosts,
        nudgedPostIds: nudgedFeedPostIds,
        actions: deps.feedActions,
        recordNudged: (id) => deps.store.recordFeedNudge(id),
        trace: async (summary, reason) => {
          await deps.trace.append({
            action: "feed_nudge",
            fromThreadId: "proactive",
            fromName: "proactive",
            summary: summary.slice(0, 200),
            reason,
            personaId: "default",
          });
        },
      });
      if (result.nudged) {
        await deps.store.markOutreach("feed_nudge", now).catch(() => {});
        return { scheduled: true, trigger: "feed_nudge" };
      }
      const reason =
        result.reason === "sleep-window"
          ? ("sleep-window" as const)
          : result.reason === "no-candidate"
            ? ("no-trigger" as const)
            : ("failed" as const);
      return { scheduled: false, reason, trigger: "feed_nudge" };
    }

    // Her clock (xiaomeng P2-3): she sleeps 06:00–16:00. Never wake her
    // with a nudge — an anniversary is the only thing worth it. The
    // in-session prompt path is unaffected: if she's awake and in the
    // app, he can still bring things up naturally.
    if (top.kind !== "anniversary" && isHerSleepTime(now)) {
      return { scheduled: false, reason: "sleep-window", trigger: top.kind };
    }

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
    // Sleep-window clamp (audit round 3, code P2-1): the frequency delay
    // may land the fire time inside her 06:00–16:00 sleep window (e.g.
    // 22:00 + 12h = 10:00 next day). Push it to 16:00 on the fire day —
    // never wake her. Anniversaries keep the raw delay (she approved those).
    const seconds =
      top.kind === "anniversary"
        ? OUTREACH_DELAY_SECONDS[frequency]
        : clampFireOutOfSleepWindow(now, OUTREACH_DELAY_SECONDS[frequency]);
    await deps.notifications.scheduleNotificationAsync({
      identifier: OUTREACH_NOTIFICATION_ID,
      // P2-1: the tap must land somewhere meaningful. The kind travels in
      // data; local-app.tsx routes it to the right screen on tap.
      content: { title, body, data: { kind: top.kind } },
      trigger: { seconds },
    });

    await deps.store.markOutreach(top.kind, now);
    // Unread-letter nudge counting (round 3, xiaomeng P2-3): the cap is
    // enforced by the engine on the next evaluation.
    if (top.kind === "love_letter") {
      try {
        await deps.store.recordLoveLetterNudge();
      } catch {
        // Bookkeeping must never break delivery.
      }
    }
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

export type OutreachDeepLinkPage = "loveLetters" | "diary" | "anniversary" | "tellLater";

/**
 * Where a notification tap should land (user P2-1). PURE — tested.
 * Every proactive kind has a real destination; silence just opens chat.
 */
export function notificationDeepLink(kind: OutreachTriggerKind): {
  section: "chat" | "space";
  page?: OutreachDeepLinkPage;
  /** For diary_nudge: open the composer straight away ("你写" must be real). */
  compose?: boolean;
} {
  switch (kind) {
    case "love_letter":
      return { section: "space", page: "loveLetters" };
    case "diary_nudge":
      return { section: "space", page: "diary", compose: true };
    case "anniversary":
      return { section: "space", page: "anniversary" };
    case "tell_later":
      return { section: "space", page: "tellLater" };
    case "on_this_day":
      // "去年今日" lives on the anniversary page (OnThisDayView) —
      // that's the real destination, not a dead end.
      return { section: "space", page: "anniversary" };
    case "silence":
      return { section: "chat" };
    case "feed_nudge":
      // The feed lives in Our Space; the like + reply are the surface,
      // so a notification is never scheduled for this kind.
      return { section: "space" };
  }
}
