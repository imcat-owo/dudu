/**
 * Open-app watchdog （看门狗）.
 *
 * The legal return path after the AI opens another app for her (her
 * research, ai-control-phone-ios-20261005, form two):
 * - Before jumping out, the tool schedules ONE delayed local notification
 *   ("玩得怎么样？点我，我带你回来").
 * - Tapping it routes back to 嘟嘟's chat and triggers ONE welcome-back
 *   message in the persona's voice ("回来了？刚才那家怎么样").
 *
 * Honesty (non-negotiable):
 * - Dudu CANNOT see inside the other app. The copy NEVER claims to know
 *   what happened there ("被拒了" is her words to say, not ours to detect).
 * - Dudu CANNOT pull itself to the foreground. The notification is a
 *   reminder she taps — the copy never promises an automatic pull-back.
 * - The tap is idempotent: one tap = one greeting, never two.
 *
 * This module is PURE-ish: RN imports are injected through deps so the
 * logic stays node-testable (same pattern as initiative/scheduler.ts).
 */

import type { ApiGroup } from "../api-groups/types";
import { type CrossDialogStorage, resolveDialog, sendToDialog } from "../chat/cross-dialog";
import { t } from "../i18n";
import type { NotificationPort, TracePort } from "../outreach/notify";
import type { Persona } from "../persona/types";

/** Watchdog notification ids all share this prefix. */
export const OPENAPP_WATCH_PREFIX = "dudu-openapp-";

export function isOpenAppWatchId(id: string): boolean {
  return id.startsWith(OPENAPP_WATCH_PREFIX);
}

/** Default delay before the watchdog rings (minutes). Her research: 5. */
export const OPENAPP_WATCHDOG_DEFAULT_MIN = 5;
/** Clamp: 1 minute – 1 hour. */
export const OPENAPP_WATCHDOG_MIN = 1;
export const OPENAPP_WATCHDOG_MAX = 60;

export function clampWatchdogMinutes(raw: unknown): number {
  const n =
    typeof raw === "number" && Number.isFinite(raw)
      ? Math.round(raw)
      : OPENAPP_WATCHDOG_DEFAULT_MIN;
  return Math.min(OPENAPP_WATCHDOG_MAX, Math.max(OPENAPP_WATCHDOG_MIN, n));
}

export interface OpenAppWatchData {
  kind: "openapp-watch";
  entryId: string;
  app: string;
  personaId: string;
  threadId: string;
  jumpedAt: number;
  /** Unique per jump — makes the tap idempotent. */
  watchId: string;
}

export function parseWatchData(data: unknown): OpenAppWatchData | null {
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.kind !== "openapp-watch") return null;
  if (
    typeof d.entryId !== "string" ||
    typeof d.app !== "string" ||
    typeof d.personaId !== "string" ||
    typeof d.threadId !== "string" ||
    typeof d.watchId !== "string"
  ) {
    return null;
  }
  const jumpedAt = typeof d.jumpedAt === "number" ? d.jumpedAt : 0;
  return {
    kind: "openapp-watch",
    entryId: d.entryId,
    app: d.app,
    personaId: d.personaId,
    threadId: d.threadId,
    jumpedAt,
    watchId: d.watchId,
  };
}

export interface OpenAppWatchDeps {
  storage: CrossDialogStorage;
  trace: TracePort;
  visibility: { isSendTagVisible(threadId: string): Promise<boolean> };
  notifications: NotificationPort;
  /** Null when no API group is configured — generation is impossible. */
  getActiveGroup(): Promise<ApiGroup | null>;
  /** Injected (generateOneShot in prod, fake in tests). May throw. */
  generateText(group: ApiGroup, systemPrompt: string, userPrompt: string): Promise<string>;
  getPersona(personaId: string): Promise<Persona | null>;
  personaDisplayName(persona: Persona): string;
  nowMs(): number;
}

export function buildWatchNotificationId(watchId: string): string {
  return `${OPENAPP_WATCH_PREFIX}${watchId}`;
}

/**
 * Arm the watchdog: one delayed notification that brings her back.
 * Never throws — a scheduling failure is reported, not fatal.
 */
export async function armWatchdog(
  deps: Pick<OpenAppWatchDeps, "notifications">,
  watch: OpenAppWatchData,
  delayMinutes: number,
): Promise<{ armed: boolean; notificationId: string }> {
  const notificationId = buildWatchNotificationId(watch.watchId);
  try {
    await deps.notifications.cancelScheduledNotificationAsync(notificationId).catch(() => {});
    await deps.notifications.scheduleNotificationAsync({
      identifier: notificationId,
      content: {
        title: t("openapp.watch.title"),
        body: t("openapp.watch.body", { app: watch.app }),
        data: {
          kind: watch.kind,
          entryId: watch.entryId,
          app: watch.app,
          personaId: watch.personaId,
          threadId: watch.threadId,
          jumpedAt: String(watch.jumpedAt),
          watchId: watch.watchId,
        },
      },
      trigger: { seconds: Math.round(delayMinutes * 60) },
    });
    return { armed: true, notificationId };
  } catch {
    return { armed: false, notificationId };
  }
}

/** Disarm a watchdog (e.g. entry retired — not used yet, kept for symmetry). */
export async function disarmWatchdog(
  deps: Pick<OpenAppWatchDeps, "notifications">,
  watchId: string,
): Promise<void> {
  await deps.notifications
    .cancelScheduledNotificationAsync(buildWatchNotificationId(watchId))
    .catch(() => {});
}

function buildWelcomeBackPrompt(personaName: string, app: string): string {
  return (
    `You are ${personaName}, her partner. She just tapped the "bring me back" ` +
    `notification — a few minutes ago you opened ${app} for her at her request, and now she's back in 嘟嘟.\n` +
    `Hard rules:\n` +
    `- Greet her back warmly and briefly, 1-2 sentences, in your own cute-but-restrained voice. Zero emoji.\n` +
    `- You CANNOT see inside ${app} (iOS sandbox). NEVER claim to know what happened there — ` +
    `no "看你被拒了", no "玩得不开心吧". Ask how it went, or what she wants next.\n` +
    `- Write ONLY the message text. No preamble, no quotes, no stage directions.`
  );
}

const HANDLED_TAPS_KEY = "dudu.openapp.v1.handledTaps";
const MAX_HANDLED_TAPS = 200;

/**
 * In-process tap claims (P2-1): two near-simultaneous notification taps
 * interleave — the wasTapHandled→markTapHandled check in the ledger is not
 * atomic, so both taps could read "not handled" and both greet. A claimed
 * watchId is processed at most once per process; the loser gets
 * "already-handled" and stays silent. The persistent ledger below remains
 * the cross-restart backstop.
 */
const claimedWatchIds = new Set<string>();

async function wasTapHandled(storage: CrossDialogStorage, watchId: string): Promise<boolean> {
  try {
    const raw = await storage.getItem(HANDLED_TAPS_KEY);
    if (!raw) return false;
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) && list.includes(watchId);
  } catch {
    return false;
  }
}

async function markTapHandled(storage: CrossDialogStorage, watchId: string): Promise<void> {
  try {
    const raw = await storage.getItem(HANDLED_TAPS_KEY);
    const list: string[] = raw ? (JSON.parse(raw) as unknown as string[]) : [];
    const next = [watchId, ...list.filter((x) => x !== watchId)].slice(0, MAX_HANDLED_TAPS);
    await storage.setItem(HANDLED_TAPS_KEY, JSON.stringify(next));
  } catch {
    // Idempotency is best-effort; a lost mark only risks a duplicate greeting.
  }
}

export type WatchTapOutcome =
  | { greeted: true; threadId: string; text: string }
  | { greeted: false; reason: string };

/**
 * Handle the watchdog tap: one welcome-back message in the persona's voice,
 * delivered to the dialog she jumped from. Persona isolation is structural:
 * resolveDialog filters by persona and fails closed — a threadId from
 * another persona (or a forged one) never receives the greeting.
 * Idempotent: a double tap greets once — the in-process claim below guards
 * the race before the first await, and the persistent ledger guards
 * everything after.
 * Never throws.
 */
export async function handleOpenAppTap(
  deps: OpenAppWatchDeps,
  data: unknown,
): Promise<WatchTapOutcome> {
  const watch = parseWatchData(data);
  if (!watch) return { greeted: false, reason: "bad-data" };
  // Synchronous claim BEFORE the first await — concurrent taps race here,
  // not at the ledger. Released in finally; the ledger is the backstop.
  if (claimedWatchIds.has(watch.watchId)) return { greeted: false, reason: "already-handled" };
  claimedWatchIds.add(watch.watchId);
  try {
    return await handleOpenAppTapInner(deps, watch);
  } finally {
    claimedWatchIds.delete(watch.watchId);
  }
}

async function handleOpenAppTapInner(
  deps: OpenAppWatchDeps,
  watch: OpenAppWatchData,
): Promise<WatchTapOutcome> {
  if (await wasTapHandled(deps.storage, watch.watchId)) {
    return { greeted: false, reason: "already-handled" };
  }
  // Claim the tap before any await that could interleave a double-tap.
  await markTapHandled(deps.storage, watch.watchId);

  const persona = await deps.getPersona(watch.personaId).catch(() => null);
  if (!persona) return { greeted: false, reason: "persona-missing" };
  const group = await deps.getActiveGroup().catch(() => null);
  if (!group) return { greeted: false, reason: "no-api-group" };

  let text: string;
  try {
    const raw = await deps.generateText(
      group,
      buildWelcomeBackPrompt(deps.personaDisplayName(persona), watch.app),
      `She tapped the notification to come back from ${watch.app}. Greet her.`,
    );
    text = raw.trim();
    if (!text) return { greeted: false, reason: "generate-failed" };
  } catch {
    return { greeted: false, reason: "generate-failed" };
  }

  // Deliver to HER dialog from before the jump — fail closed on mismatch.
  let threadId: string;
  try {
    const dialog = await resolveDialog(deps.storage, watch.threadId, watch.personaId);
    if (dialog.personaId !== watch.personaId) return { greeted: false, reason: "no-dialog" };
    threadId = dialog.id;
  } catch {
    return { greeted: false, reason: "no-dialog" };
  }
  try {
    await sendToDialog(
      deps.storage,
      threadId,
      text,
      { fromThreadId: "openapp", fromName: watch.app, at: deps.nowMs() },
      (tid) => deps.visibility.isSendTagVisible(tid),
    );
  } catch {
    return { greeted: false, reason: "deliver-failed" };
  }

  // 留痕: she can always see what he sent and why.
  try {
    await deps.trace.append({
      action: "openapp_return",
      fromThreadId: "openapp",
      fromName: watch.app,
      summary: text.slice(0, 200),
      reason: `welcome-back after she tapped the watchdog for "${watch.entryId}" (${watch.app})`,
      personaId: watch.personaId,
    });
  } catch {
    // Trace failure must not unsend a delivered message.
  }
  return { greeted: true, threadId, text };
}
