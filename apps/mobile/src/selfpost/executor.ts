/**
 * AI self-post trigger （自发帖触发器） — slot executor.
 *
 * One slot fires at most once, ever. Fail-closed throughout: any failed
 * check means "stay silent", never "post anyway". A failed fire still
 * consumes its slot — interrupted execution is never retried (her hard
 * constraint).
 *
 * Order: slot ledger → deterministic gate (cheap vetoes) → mark fired →
 * ONE model decision call → post-or-skip → feed + log + trace.
 * The gate runs before the model call so vetoes never cost a call.
 */

import type { ApiGroup } from "../api-groups/types";
import { shanghaiDayStart } from "../initiative/rules";
import type { InitiativeStore } from "../initiative/store";
import type { TracePort } from "../outreach/notify";
import type { OutreachStore } from "../outreach/store";
import type { Persona } from "../persona/types";
import {
  buildSelfpostSystemPrompt,
  buildSelfpostUserPrompt,
  parseSelfpostDecision,
  type SelfpostDecisionContext,
} from "./decide";
import { evaluateSelfpostGate, type SelfpostGateReason } from "./gate";
import { isSlotExpired, type SelfpostSlot, selfpostSlotId } from "./slots";
import type { SelfpostLogEntry, SelfpostOutcome, SelfpostStore } from "./store";

export interface SelfpostExecutorDeps {
  selfpostStore: SelfpostStore;
  initiativeStore: InitiativeStore;
  outreachStore: OutreachStore;
  /** "ai" post goes through the same pipeline as the feed_post tool. */
  addFeedPost(text: string): Promise<{ id: string }>;
  listTodayFeed(): Promise<string[]>;
  listRecentMemories(): Promise<string[]>;
  listTodayEvents(): Promise<string[]>;
  getActivePersona(): Promise<Persona | null>;
  personaDisplayName(persona: Persona): string;
  personaVoiceHint(persona: Persona): string;
  getActiveGroup(): Promise<ApiGroup | null>;
  /** Injected (generateOneShot in prod, fake in tests). May throw. */
  generateText(group: ApiGroup, systemPrompt: string, userPrompt: string): Promise<string>;
  isIncognito(): boolean;
  trace: TracePort;
  nowMs(): number;
}

export type SelfpostFireOutcome =
  | { fired: true; outcome: "posted"; postId: string; text: string }
  | { fired: true; outcome: "skipped"; reason: "model-skip" }
  | { fired: false; reason: SelfpostGateReason | "post-failed" };

/**
 * In-process in-flight slot claims (same race as initiative P2-1): the
 * tick and the foreground event can overlap — claim synchronously before
 * the first await so one slot fires at most once per process.
 */
const inFlightSlots = new Set<string>();

async function countSharedSendsToday(
  deps: SelfpostExecutorDeps,
  now: number,
): Promise<{ sharedSends: number; sharedCap: number }> {
  const dayStart = shanghaiDayStart(now);
  const sharedCap = await deps.initiativeStore.getDailyCap().catch(() => 3);
  const [initiativeSends, outreachSends] = await Promise.all([
    deps.initiativeStore.countAllSendsToday(now).catch(() => 0),
    (async () => {
      try {
        const last = await deps.outreachStore.getLastOutreachAt();
        let n = 0;
        for (const v of Object.values(last)) {
          if (typeof v === "number" && v >= dayStart) n += 1;
        }
        return n;
      } catch {
        return 0;
      }
    })(),
  ]);
  return { sharedSends: initiativeSends + outreachSends, sharedCap };
}

export async function fireSelfpostSlot(
  deps: SelfpostExecutorDeps,
  slot: SelfpostSlot,
): Promise<SelfpostFireOutcome> {
  const now = deps.nowMs();
  const slotKey = selfpostSlotId(shanghaiDayStart(now), slot.index);
  if (inFlightSlots.has(slotKey)) return { fired: false, reason: "already-fired" };
  inFlightSlots.add(slotKey);
  try {
    return await fireSelfpostSlotInner(deps, slot, slotKey, now);
  } finally {
    inFlightSlots.delete(slotKey);
  }
}

async function fireSelfpostSlotInner(
  deps: SelfpostExecutorDeps,
  slot: SelfpostSlot,
  slotKey: string,
  now: number,
): Promise<SelfpostFireOutcome> {
  const store = deps.selfpostStore;

  /** Consume the slot + write the lightweight log. Never throws. */
  const consume = async (
    outcome: SelfpostOutcome,
    reason: string,
    textPreview?: string,
  ): Promise<void> => {
    try {
      await store.markSlotFired(slot, now);
    } catch {
      // ledger write failure must not resurrect the slot into a retry
    }
    const entry: SelfpostLogEntry = {
      at: now,
      slotIndex: slot.index,
      slotAt: slot.atMs,
      outcome,
      reason,
      ...(textPreview ? { textPreview: textPreview.slice(0, 120) } : {}),
    };
    try {
      await store.appendLog(entry);
    } catch {
      // log failure is not fatal
    }
  };

  const config = await store.getConfig().catch(() => ({
    enabled: true,
    slotCount: 3,
    dailyCap: 1,
  }));
  const [firedSet, selfpostsToday, shared, lastActivity, persona, group] = await Promise.all([
    store.firedSlotIds().catch(() => new Set<string>()),
    store.countSendsToday(now).catch(() => 0),
    countSharedSendsToday(deps, now).catch(() => ({ sharedSends: 0, sharedCap: 3 })),
    store.lastActivityAt().catch(() => 0),
    deps.getActivePersona().catch(() => null),
    deps.getActiveGroup().catch(() => null),
  ]);

  const gate = evaluateSelfpostGate({
    config,
    isIncognito: deps.isIncognito(),
    slot,
    fired: firedSet.has(slotKey),
    selfpostsToday,
    sharedSendsToday: shared.sharedSends,
    sharedCap: shared.sharedCap,
    msSinceLastActivity: now - lastActivity,
    hasPersona: persona !== null,
    hasApiGroup: group !== null,
    nowMs: now,
  });
  if (!gate.allowed) {
    // Expired slots are consumed silently (grace rule); every other veto
    // also consumes the slot — an interrupted slot is never retried.
    await consume("skipped", gate.reason ?? "vetoed");
    return { fired: false, reason: gate.reason ?? "disabled" };
  }

  // Gate passed — consume the slot BEFORE the model call so a crash or
  // kill between decision and post can never double-fire it.
  const personaName = deps.personaDisplayName(persona as Persona);
  let decision: string | null = null;
  try {
    const [memories, todayEvents, todayFeed, log] = await Promise.all([
      deps.listRecentMemories().catch(() => [] as string[]),
      deps.listTodayEvents().catch(() => [] as string[]),
      deps.listTodayFeed().catch(() => [] as string[]),
      store.listLog(10).catch(() => [] as SelfpostLogEntry[]),
    ]);
    const recentSkips = log
      .filter((e) => e.outcome === "skipped")
      .slice(0, 3)
      .map((e) => e.reason);
    const dctx: SelfpostDecisionContext = {
      personaName,
      personaHint: deps.personaVoiceHint(persona as Persona),
      memories,
      todayEvents,
      todayFeed,
      recentSkips,
      nowMs: now,
    };
    const raw = await deps.generateText(
      group as ApiGroup,
      buildSelfpostSystemPrompt(personaName, dctx.personaHint),
      buildSelfpostUserPrompt(dctx),
    );
    decision = parseSelfpostDecision(raw);
  } catch {
    decision = null;
  }

  if (decision === null) {
    // Model said SKIP, errored, or produced nothing usable — silence wins.
    await consume("skipped", "model-skip");
    return { fired: true, outcome: "skipped", reason: "model-skip" };
  }

  // Post through the same pipeline as the feed_post tool.
  let postId: string;
  try {
    const post = await deps.addFeedPost(decision);
    postId = post.id;
  } catch {
    await consume("skipped", "post-failed");
    return { fired: false, reason: "post-failed" };
  }

  try {
    await store.recordSend(now);
  } catch {
    // send recorded in feed; ledger hiccup must not unpost
  }
  await consume("posted", "posted", decision);

  // 留痕: she can always see what he posted and why.
  try {
    await deps.trace.append({
      action: "selfpost_post",
      fromThreadId: "selfpost",
      fromName: "feed",
      summary: decision.slice(0, 200),
      reason: `AI self-post at quiet slot ${slot.index} (${slot.label})`,
      personaId: (persona as Persona).id,
    });
  } catch {
    // Trace failure must not unpost a delivered post.
  }

  return { fired: true, outcome: "posted", postId, text: decision };
}

// Re-export for tests that want the grace constant without the scheduler.
export { isSlotExpired };
