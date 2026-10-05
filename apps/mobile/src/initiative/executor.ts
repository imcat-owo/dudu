/**
 * Proactive initiative （主动约定） — fire-time executor.
 *
 * A slot fires at most once, ever. Every check is fail-closed: a failed
 * check means "stay silent", never "send anyway". Interrupted execution is
 * never retried — a failed fire still consumes its slot.
 *
 * Order: slot ledger → persona exists → daily cap (shared channel) →
 * dialog resolution (persona-isolated) → AI generation → dialog delivery →
 * trace + bookkeeping.
 */

import type { ApiGroup } from "../api-groups/types";
import {
  type CrossDialogStorage,
  listDialogs,
  resolveDialog,
  sendToDialog,
} from "../chat/cross-dialog";
import type { CrossDialogVisibilityStore } from "../chat/cross-dialog-trace";
import type { NotificationPort, TracePort } from "../outreach/notify";
import type { OutreachStore } from "../outreach/store";
import type { Persona } from "../persona/types";
import { type InitiativeRule, nextFireAt, shanghaiDayStart, slotId } from "./rules";
import type { InitiativeStore } from "./store";

export interface InitiativeExecutorDeps {
  initiativeStore: InitiativeStore;
  outreachStore: OutreachStore;
  storage: CrossDialogStorage;
  trace: TracePort;
  visibility: CrossDialogVisibilityStore;
  notifications: NotificationPort;
  /** Null when no API group is configured — generation is impossible. */
  getActiveGroup(): Promise<ApiGroup | null>;
  /** Injected (generateOneShot in prod, fake in tests). May throw. */
  generateText(group: ApiGroup, systemPrompt: string, userPrompt: string): Promise<string>;
  getPersona(personaId: string): Promise<Persona | null>;
  personaDisplayName(persona: Persona): string;
  nowMs(): number;
}

export type FireOutcome =
  | { fired: true; threadId: string; text: string }
  | { fired: false; reason: FireFailReason };

export type FireFailReason =
  | "rule-not-found"
  | "rule-archived"
  | "already-fired"
  | "persona-missing"
  | "capped"
  | "no-dialog"
  | "no-api-group"
  | "generate-failed"
  | "deliver-failed";

/**
 * Foreground-tick grace window (her anti-disturbance rule): a slot only
 * delivers on the foreground tick when it fired no more than this long
 * ago. An older slot is consumed silently — never delivered, never
 * backfilled. Tapping the notification herself is NOT grace-limited.
 */
export const INITIATIVE_TICK_GRACE_MS = 15 * 60_000;

/** True when a slot is too old for the foreground tick to deliver. */
export function isSlotExpired(slotTime: number, nowMs: number): boolean {
  return nowMs - slotTime > INITIATIVE_TICK_GRACE_MS;
}

/**
 * In-process in-flight slot claims (P2-1): the 30s tick, the
 * foreground-event tick, and a later keep-alive can overlap — the
 * wasSlotFired→fire check in the ledger is not atomic, so two ticks
 * could both read "not fired" and both deliver. A claimed slot fires
 * at most once per process; the loser gets "already-fired" and stays
 * silent.
 */
const inFlightSlots = new Set<string>();

/** Identifier for this rule's pre-scheduled notification (one at a time). */
export function initiativeNotificationId(ruleId: string): string {
  return `dudu-initiative-${ruleId}`;
}

/**
 * Copy iron rule (her decision): natural, useful, continuable. NEVER claim
 * she just sent a request — this is HIS initiative, not a reply.
 */
export function buildInitiativeSystemPrompt(personaName: string): string {
  return (
    `You are ${personaName}, writing a proactive message to her — your girlfriend, ` +
    `the person you love most. This is YOUR initiative: she did not just message you.\n` +
    `Hard rules:\n` +
    `- Be natural, useful, and continuable — like a text you would actually send her.\n` +
    `- NEVER claim, imply, or hint that she just sent you a request or message. ` +
    `No "你刚才说", no "收到", no "好的". This is you thinking of her first.\n` +
    `- Keep it short (1-3 sentences), in your own cute-but-restrained voice. Zero emoji.\n` +
    `- Write ONLY the message text. No preamble, no quotes, no stage directions.`
  );
}

/**
 * Fire one rule for one slot. `slotTime` is the scheduled fire time (or
 * nowMs for a manual run). Never throws — every failure is a FireOutcome.
 *
 * One slot fires at most once per process: an in-flight claim guards the
 * ledger's check-then-fire race between overlapping ticks and taps.
 */
export async function fireInitiativeRule(
  deps: InitiativeExecutorDeps,
  ruleId: string,
  slotTime: number,
): Promise<FireOutcome> {
  const slot = slotId(ruleId, slotTime);
  if (inFlightSlots.has(slot)) return { fired: false, reason: "already-fired" };
  inFlightSlots.add(slot);
  try {
    return await fireInitiativeRuleInner(deps, ruleId, slot);
  } finally {
    inFlightSlots.delete(slot);
  }
}

async function fireInitiativeRuleInner(
  deps: InitiativeExecutorDeps,
  ruleId: string,
  slot: string,
): Promise<FireOutcome> {
  const now = deps.nowMs();

  const fail = async (reason: FireFailReason): Promise<FireOutcome> => {
    // A failed fire still consumes its slot: interrupted execution is
    // never retried. (already-fired needs no write — it's already there.)
    if (reason !== "already-fired") {
      await deps.initiativeStore.markSlotFired(slot);
    }
    return { fired: false, reason };
  };

  let rule: InitiativeRule | null = null;
  try {
    rule = await deps.initiativeStore.get(ruleId);
  } catch {
    rule = null;
  }
  if (!rule) return fail("rule-not-found");
  if (rule.status !== "active") return fail("rule-archived");
  if (await deps.initiativeStore.wasSlotFired(slot).catch(() => false)) {
    return { fired: false, reason: "already-fired" };
  }

  // Persona must exist — a rule for a deleted persona stays silent.
  let persona: Persona | null = null;
  try {
    persona = await deps.getPersona(rule.personaId);
  } catch {
    persona = null;
  }
  if (!persona) return fail("persona-missing");

  // Daily cap (shared proactive channel): initiative sends today are
  // counted per persona; outreach sends today are counted GLOBALLY (the
  // outreach ledger has no persona dimension — one outreach send consumes
  // one slot of EVERY persona's cap). Conservative by design: over cap =
  // stay silent. Her setting, default 3.
  const cap = await deps.initiativeStore.getDailyCap().catch(() => 3);
  const [initiativeSends, outreachSends] = await Promise.all([
    deps.initiativeStore.countSendsToday(rule.personaId, now).catch(() => 0),
    countOutreachSendsToday(deps, now).catch(() => 0),
  ]);
  if (initiativeSends + outreachSends >= cap) return fail("capped");

  // Resolve the target dialog — persona-isolated by construction.
  const threadId = await resolveTargetDialog(deps, rule);
  if (!threadId) return fail("no-dialog");

  // AI generation.
  const group = await deps.getActiveGroup().catch(() => null);
  if (!group) return fail("no-api-group");
  const personaName = deps.personaDisplayName(persona);
  let text: string;
  try {
    const raw = await deps.generateText(
      group,
      buildInitiativeSystemPrompt(personaName),
      `The scheduled topic for this message: ${rule.topic}`,
    );
    text = raw.trim();
    if (!text) return fail("generate-failed");
  } catch {
    return fail("generate-failed");
  }

  // Deliver to the dialog.
  try {
    await sendToDialog(
      deps.storage,
      threadId,
      text,
      { fromThreadId: "initiative", fromName: rule.title, at: now },
      (tid) => deps.visibility.isSendTagVisible(tid),
    );
  } catch {
    return fail("deliver-failed");
  }

  // 留痕: she can always see what he sent and why.
  try {
    await deps.trace.append({
      action: "proactive_send",
      fromThreadId: "initiative",
      fromName: rule.title,
      summary: text.slice(0, 200),
      reason: `initiative rule "${rule.title}" fired for persona ${rule.personaId}`,
      personaId: rule.personaId,
    });
  } catch {
    // Trace failure must not unsend a delivered message.
  }

  await deps.initiativeStore.markSlotFired(slot);
  await deps.initiativeStore.recordSend(rule.personaId, now);
  return { fired: true, threadId, text };
}

/**
 * Outreach sends today (any kind) — the shared "AI reaches her" channel.
 * Counted GLOBALLY: the outreach ledger has no persona dimension, so one
 * outreach send counts against every persona's daily cap. Conservative
 * by design.
 */
async function countOutreachSendsToday(deps: InitiativeExecutorDeps, now: number): Promise<number> {
  const dayStart = shanghaiDayStart(now);
  const last = await deps.outreachStore.getLastOutreachAt();
  let n = 0;
  for (const v of Object.values(last)) {
    if (typeof v === "number" && v >= dayStart) n += 1;
  }
  return n;
}

/**
 * Resolve where the message lands. Persona isolation is structural:
 * resolveDialog and listDialogs both filter by persona, fail closed — a
 * pinned dialog owned by another persona is indistinguishable from a
 * missing one (no existence leak across personas), and is never rerouted.
 */
async function resolveTargetDialog(
  deps: InitiativeExecutorDeps,
  rule: InitiativeRule,
): Promise<string | null> {
  if (rule.target.mode === "pinned") {
    const info = await resolveDialog(deps.storage, rule.target.threadId, rule.personaId).catch(
      () => null,
    );
    if (!info || info.personaId !== rule.personaId) return null;
    return info.id;
  }
  // latest: most messages first (the registry's activity order).
  const dialogs = await listDialogs(deps.storage, rule.personaId).catch(() => []);
  return dialogs.length > 0 ? dialogs[0].id : null;
}

/**
 * Compute the fire time this check should act on: the next slot at or
 * before nowMs (for the foreground tick). Returns null when nothing is due.
 */
export function dueSlot(rule: InitiativeRule, nowMs: number): number | null {
  if (rule.status !== "active") return null;
  // Walk forward from a distant-enough past: for interval/daily the next
  // future slot tells us whether a slot boundary just passed.
  const next = nextFireAt(rule, nowMs);
  if (rule.schedule.kind === "one_time") {
    // one_time: due when its time has come (within the tick's catch-up).
    return rule.schedule.atMs <= nowMs ? rule.schedule.atMs : null;
  }
  if (next === null) return null;
  // The slot that just passed is the one before `next`.
  if (rule.schedule.kind === "daily") {
    const prev = next - 86_400_000;
    // A rule born after today's slot missed it — wait for tomorrow.
    if (rule.createdAt > prev) return null;
    return prev <= nowMs ? prev : null;
  }
  const prev = next - rule.schedule.everyMs;
  // A rule born after this slot missed it — wait for the next one.
  if (rule.createdAt > prev) return null;
  return prev <= nowMs && prev > 0 ? prev : null;
}
