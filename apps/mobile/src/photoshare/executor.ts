/**
 * AI photo share （主动发照片） — slot executor.
 *
 * One slot fires at most once, ever. Fail-closed throughout: any failed
 * check means "stay silent", never "share anyway". A failed fire still
 * consumes its slot — interrupted execution is never retried (her hard
 * constraint).
 *
 * Order: slot ledger → deterministic gate (cheap vetoes) → mark fired →
 * ONE model decision call → generate image (real path, never fake) →
 * dialog delivery → trace + log.
 * The gate runs before the model call so vetoes never cost a call, and
 * the slot is marked before the model call so a kill between decision
 * and delivery can never double-fire it.
 */

import type { ApiGroup } from "../api-groups/types";
import { type CrossDialogStorage, listDialogs, sendToDialog } from "../chat/cross-dialog";
import type { CrossDialogVisibilityStore } from "../chat/cross-dialog-trace";
import { encodeImageMessage } from "../image/protocol";
import { shanghaiDayStart } from "../initiative/rules";
import type { InitiativeStore } from "../initiative/store";
import { describeHerMoment } from "../our-space/her-rhythm";
import type { TracePort } from "../outreach/notify";
import type { OutreachStore } from "../outreach/store";
import type { Persona } from "../persona/types";
import type { SelfpostStore } from "../selfpost/store";
import {
  buildCharacterRef,
  buildPhotoshareSystemPrompt,
  buildPhotoshareUserPrompt,
  type PhotoshareDecision,
  type PhotoshareDecisionContext,
  parsePhotoshareDecision,
} from "./decide";
import { evaluatePhotoshareGate, type PhotoshareGateReason } from "./gate";
import { isSlotExpired, type PhotoshareSlot, photoshareSlotId } from "./slots";
import type { PhotoshareLogEntry, PhotoshareOutcome, PhotoshareStore } from "./store";

export interface PhotoshareExecutorDeps {
  photoshareStore: PhotoshareStore;
  initiativeStore: InitiativeStore;
  outreachStore: OutreachStore;
  selfpostStore: SelfpostStore;
  storage: CrossDialogStorage;
  visibility: CrossDialogVisibilityStore;
  getActivePersona(): Promise<Persona | null>;
  personaDisplayName(persona: Persona): string;
  personaVoiceHint(persona: Persona): string;
  getActiveGroup(): Promise<ApiGroup | null>;
  /** Injected (generateOneShot in prod, fake in tests). May throw. */
  generateText(group: ApiGroup, systemPrompt: string, userPrompt: string): Promise<string>;
  /**
   * Real image generation: her image_output capability group first, free
   * fallback second (the same path as the generate_image tool). Throws on
   * failure — a failed generation is never covered up with a fake photo.
   */
  generateImage(prompt: string): Promise<{ url: string; via: string }>;
  listRecentMemories(): Promise<string[]>;
  listTodayEvents(): Promise<string[]>;
  isIncognito(): boolean;
  trace: TracePort;
  nowMs(): number;
}

export type PhotoshareFireOutcome =
  | { fired: true; outcome: "shared"; threadId: string; caption: string; imageUrl: string }
  | { fired: true; outcome: "skipped"; reason: "model-skip" }
  | { fired: false; reason: PhotoshareGateReason | "generate-failed" | "deliver-failed" };

export interface PhotoshareFireOptions {
  /**
   * Manual share ("发张照片给我" — she asked). Bypasses the surprise-only
   * vetoes (disabled toggle, quiet hours, 60-min collision, expiry) but
   * keeps the hard ones: incognito, caps, persona, API group.
   */
  manual?: boolean;
  /** What she asked for ("穿那件白衬衫的自拍") — passed to the model. */
  manualHint?: string;
}

/**
 * In-process in-flight slot claims (same race as initiative/selfpost):
 * the tick and the foreground event can overlap — claim synchronously
 * before the first await so one slot fires at most once per process.
 */
const inFlightSlots = new Set<string>();

/**
 * 60-min collision check: the most recent proactive send of ANY kind —
 * photoshare, initiative, outreach, or selfpost. Every read is guarded —
 * a failing source degrades to 0 (no veto).
 */
async function lastProactiveActivityAt(deps: PhotoshareExecutorDeps): Promise<number> {
  const [photoshareLast, initiativeLast, outreachLast, selfpostLast] = await Promise.all([
    deps.photoshareStore.lastActivityAt().catch(() => 0),
    Promise.resolve()
      .then(() => deps.initiativeStore.lastSendAt())
      .catch(() => 0),
    Promise.resolve()
      .then(() => deps.outreachStore.getLastOutreachAt())
      .then((last) => {
        let m = 0;
        for (const v of Object.values(last)) {
          if (typeof v === "number" && v > m) m = v;
        }
        return m;
      })
      .catch(() => 0),
    Promise.resolve()
      .then(() => deps.selfpostStore.lastActivityAt())
      .catch(() => 0),
  ]);
  return Math.max(photoshareLast, initiativeLast, outreachLast, selfpostLast);
}

/**
 * All proactive sends today: initiative (this persona) + outreach
 * (global) + selfpost (global) + photoshare (global). A photo is an
 * "AI reaches her" send like any other — it draws from the same budget
 * and counts against it (symmetric shared cap).
 */
async function countSharedSendsToday(
  deps: PhotoshareExecutorDeps,
  personaId: string,
  now: number,
): Promise<{ sharedSends: number; sharedCap: number }> {
  const dayStart = shanghaiDayStart(now);
  const sharedCap = await deps.initiativeStore.getDailyCap().catch(() => 3);
  const [initiativeSends, outreachSends, selfpostSends, photoshareSends] = await Promise.all([
    deps.initiativeStore.countSendsToday(personaId, now).catch(() => 0),
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
    deps.selfpostStore.countSendsToday(now).catch(() => 0),
    deps.photoshareStore.countSendsToday(now).catch(() => 0),
  ]);
  return {
    sharedSends: initiativeSends + outreachSends + selfpostSends + photoshareSends,
    sharedCap,
  };
}

/** Resolve the dialog the photo lands in: the persona's latest dialog. Persona-isolated by construction. */
async function resolveTargetDialog(
  deps: PhotoshareExecutorDeps,
  personaId: string,
): Promise<string | null> {
  try {
    const dialogs = await listDialogs(deps.storage, personaId);
    return dialogs.length > 0 ? dialogs[0].id : null;
  } catch {
    return null;
  }
}

export async function firePhotoshareSlot(
  deps: PhotoshareExecutorDeps,
  slot: PhotoshareSlot,
  opts?: PhotoshareFireOptions,
): Promise<PhotoshareFireOutcome> {
  const manual = opts?.manual === true;
  const manualHint = (opts?.manualHint ?? "").trim().slice(0, 200);
  const now = deps.nowMs();
  const slotKey = manual ? `manual:${now}` : photoshareSlotId(shanghaiDayStart(now), slot.index);
  if (inFlightSlots.has(slotKey)) return { fired: false, reason: "already-fired" };
  inFlightSlots.add(slotKey);
  try {
    return await firePhotoshareSlotInner(deps, slot, slotKey, now, manual, manualHint);
  } finally {
    inFlightSlots.delete(slotKey);
  }
}

async function firePhotoshareSlotInner(
  deps: PhotoshareExecutorDeps,
  slot: PhotoshareSlot,
  slotKey: string,
  now: number,
  manual: boolean,
  manualHint: string,
): Promise<PhotoshareFireOutcome> {
  const store = deps.photoshareStore;

  /** Consume the slot + write the lightweight log. Never throws. */
  const consume = async (
    outcome: PhotoshareOutcome,
    reason: string,
    captionPreview?: string,
  ): Promise<void> => {
    try {
      if (!manual) await store.markSlotFired(slot, now);
    } catch {
      // ledger write failure must not resurrect the slot into a retry
    }
    const entry: PhotoshareLogEntry = {
      at: now,
      slotIndex: slot.index,
      slotAt: slot.atMs,
      outcome,
      reason,
      ...(captionPreview ? { captionPreview: captionPreview.slice(0, 120) } : {}),
      ...(manual ? { manual: true } : {}),
    };
    try {
      await store.appendLog(entry);
    } catch {
      // log failure is not fatal
    }
  };

  const config = await store.getConfig().catch(() => ({
    enabled: false,
    slotCount: 2,
    dailyCap: 1,
    personaId: "",
  }));
  // Manual share: she asked for it — the surprise-only vetoes don't apply.
  // Everything else (incognito, caps, persona, API group) still does.
  const effectiveConfig = manual ? { ...config, enabled: true } : config;
  const [firedSet, photosharesToday, persona, group] = await Promise.all([
    store.firedSlotIds().catch(() => new Set<string>()),
    store.countSendsToday(now).catch(() => 0),
    deps.getActivePersona().catch(() => null),
    deps.getActiveGroup().catch(() => null),
  ]);
  const shared = persona
    ? await countSharedSendsToday(deps, persona.id, now).catch(() => ({
        sharedSends: 0,
        sharedCap: 3,
      }))
    : { sharedSends: 0, sharedCap: 3 };
  const lastActivity = await lastProactiveActivityAt(deps);

  const gate = evaluatePhotoshareGate({
    config: effectiveConfig,
    isIncognito: deps.isIncognito(),
    slot,
    // Manual shares never collide with the daily quiet slots (index -1).
    fired: manual ? false : firedSet.has(slotKey),
    photosharesToday,
    sharedSendsToday: shared.sharedSends,
    sharedCap: shared.sharedCap,
    // Manual: she's here asking — the 60-min collision rule is for
    // surprises, not answers.
    msSinceLastActivity: manual ? Number.POSITIVE_INFINITY : now - lastActivity,
    hasPersona: persona !== null,
    hasApiGroup: group !== null,
    nowMs: now,
    manual,
  });
  if (!gate.allowed) {
    await consume("skipped", gate.reason ?? "vetoed");
    return { fired: false, reason: gate.reason ?? "disabled" };
  }

  // Gate passed — consume the slot BEFORE the model call so a crash or
  // kill between decision and delivery can never double-fire it.
  // (Manual shares don't consume quiet slots.)
  if (!manual) {
    try {
      await store.markSlotFired(slot, now);
    } catch {
      // a ledger hiccup must not resurrect the slot into a retry
    }
  }

  const personaName = deps.personaDisplayName(persona as Persona);
  let decision: PhotoshareDecision | null = null;
  try {
    const [memories, todayEvents, log] = await Promise.all([
      deps.listRecentMemories().catch(() => [] as string[]),
      deps.listTodayEvents().catch(() => [] as string[]),
      store.listLog(10).catch(() => [] as PhotoshareLogEntry[]),
    ]);
    const recentCaptions = log
      .filter((e) => e.outcome === "shared" && e.captionPreview)
      .slice(0, 3)
      .map((e) => e.captionPreview as string);
    const dctx: PhotoshareDecisionContext = {
      personaName,
      personaHint: deps.personaVoiceHint(persona as Persona),
      characterRef: buildCharacterRef(persona as Persona),
      herMoment: describeHerMoment(now),
      memories,
      todayEvents,
      recentCaptions,
      nowMs: now,
    };
    const raw = await deps.generateText(
      group as ApiGroup,
      buildPhotoshareSystemPrompt(personaName),
      manual
        ? `She just asked you to share a photo with her${manualHint ? ` ("${manualHint}")` : ""}. ` +
            `Pick a sweet moment and SHARE it — same format as always.\n\n` +
            buildPhotoshareUserPrompt(dctx)
        : buildPhotoshareUserPrompt(dctx),
    );
    decision = parsePhotoshareDecision(raw);
  } catch {
    decision = null;
  }

  if (decision === null) {
    // Model said SKIP, errored, or produced nothing usable — silence wins.
    await consume("skipped", "model-skip");
    try {
      await deps.trace.append({
        action: "photoshare_skipped",
        fromThreadId: "photoshare",
        fromName: "主动发照片",
        summary: "model chose not to share a photo at this quiet moment",
        reason: "model-skip",
        personaId: (persona as Persona).id,
      });
    } catch {
      // trace is best-effort
    }
    return { fired: true, outcome: "skipped", reason: "model-skip" };
  }

  // Generate the photo through the REAL image path. A failure here is
  // honest: no stock photo, no placeholder, no "me right now" lie.
  let imageUrl: string;
  try {
    const gen = await deps.generateImage(decision.imagePrompt);
    imageUrl = gen.url;
    if (!imageUrl) throw new Error("empty image url");
  } catch {
    await consume("skipped", "generate-failed");
    return { fired: false, reason: "generate-failed" };
  }

  // Deliver to the dialog: caption + image envelope (chat renders the
  // image bubble — same protocol as the generate_image tool).
  const threadId = await resolveTargetDialog(deps, (persona as Persona).id);
  if (!threadId) {
    await consume("skipped", "deliver-failed");
    return { fired: false, reason: "deliver-failed" };
  }
  const content = `${decision.caption}\n${encodeImageMessage(imageUrl, decision.imagePrompt)}`;
  try {
    await sendToDialog(
      deps.storage,
      threadId,
      content,
      { fromThreadId: "photoshare", fromName: "主动发照片", at: now },
      (tid) => deps.visibility.isSendTagVisible(tid),
    );
  } catch {
    await consume("skipped", "deliver-failed");
    return { fired: false, reason: "deliver-failed" };
  }

  try {
    await store.recordSend(now);
  } catch {
    // delivered to chat; ledger hiccup must not unsend
  }
  await consume("shared", "shared", decision.caption);

  // 留痕: she can always see what he shared and why.
  try {
    await deps.trace.append({
      action: "photoshare_shared",
      fromThreadId: "photoshare",
      fromName: "主动发照片",
      summary: decision.caption.slice(0, 200),
      reason: manual
        ? "she asked for a photo"
        : `AI photo share at quiet slot ${slot.index} (${slot.label})`,
      personaId: (persona as Persona).id,
    });
  } catch {
    // Trace failure must not unsend a delivered photo.
  }

  return { fired: true, outcome: "shared", threadId, caption: decision.caption, imageUrl };
}

// Re-export for tests that want the grace constant without the scheduler.
export { isSlotExpired };
