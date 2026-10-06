/**
 * Daily mood check-in （每日心情 check-in） — fire-time engine.
 *
 * Delivery rides on the initiative executor (per-persona daily cap,
 * persona isolation, slot ledger, AI generation, dialog delivery,
 * trace) — same as the next-day follow-up. This engine adds the
 * check-in lifecycle around it:
 *
 * - master toggle off → silent;
 * - one check-in per Shanghai day, at her configured hour (default
 *   20:00 — she is nocturnal; the hour can never be 06:00–16:00);
 * - SMART SKIP: if her mood is already recorded today (she told him in
 *   chat, or answered earlier), or she was active in the app recently,
 *   don't send a redundant nudge — he already knows / she's around;
 * - DON'T NAG: if yesterday's check-in fired and she never answered,
 *   skip today (one quiet day), then resume;
 * - a fired check-in is one-shot: cap failure still counts as fired.
 *   Never retried (her hard rule).
 */

import type { FireOutcome } from "../initiative/executor";
import type { InitiativeRule } from "../initiative/rules";
import type { InitiativeStore } from "../initiative/store";
import type { TracePort } from "../outreach/notify";
import type { Persona } from "../persona/types";
import type { MoodcheckStore } from "./store";
import { shanghaiDayKey, shanghaiHourToday } from "./time";

export interface MoodcheckEngineDeps {
  moodcheckStore: MoodcheckStore;
  initiativeStore: InitiativeStore;
  listPersonas(): Promise<Array<{ id: string; name: string }>>;
  getPersona(personaId: string): Promise<Persona | null>;
  /**
   * Fire the one_time check-in rule — the REAL delivery path (cap,
   * isolation, ledger, generation, delivery, trace all enforced).
   * Injected so tests don't need the full executor.
   */
  fireRule(ruleId: string, slotTime: number): Promise<FireOutcome>;
  /** Re-arm the rule's notification after creation. */
  onMutated(rule: InitiativeRule): Promise<void>;
  /** Last app-foreground time (outreach lastOpened), 0 = unknown. */
  lastOpenedAt(): Promise<number>;
  trace: TracePort;
  nowMs(): number;
}

export type MoodcheckSkipReason =
  | "disabled"
  | "no-persona"
  | "already-fired-today"
  | "not-yet-time"
  | "no-reply-yesterday"
  | "already-recorded"
  | "recently-active";

export interface MoodcheckTickResult {
  fired: boolean;
  reason?: MoodcheckSkipReason;
}

/** "She was just here" window — a nudge would be redundant noise. */
export const RECENTLY_ACTIVE_MS = 2 * 3_600_000;

const DAY_MS = 86_400_000;

/**
 * The generation topic for the check-in rule. The initiative copy iron
 * rule ("never claim she just sent a request") already applies — this
 * adds the check-in voice: one caring line, never a form.
 */
export function buildCheckinTopic(): string {
  return (
    `像日常关心一样，自然地问她今天心情/状态怎么样，就一句关心，不要长篇大论。` +
    `绝对不要出现"打卡""check-in""记录""问卷""量表"这种词。` +
    `可以顺带给四个随口一说的选项（比如：挺好的、还行、有点累、很糟），让她直接回一句就行，不强迫。` +
    `如果她不想说，就温柔地放过她，不要追问。`
  );
}

export function buildCheckinTitle(): string {
  return "问问她今天怎么样";
}

async function traceSkip(
  deps: MoodcheckEngineDeps,
  personaId: string,
  reason: MoodcheckSkipReason,
  detail: string,
): Promise<void> {
  await deps.trace
    .append({
      action: "moodcheck_skipped",
      fromThreadId: "moodcheck",
      fromName: "每日心情",
      summary: `mood check-in skipped (${reason}): ${detail}`,
      reason: detail,
      personaId,
    })
    .catch(() => {});
}

/**
 * One tick of the mood check-in engine. Never throws — a failure never
 * breaks the initiative sweep that runs after it.
 */
export async function checkDueMoodcheck(
  deps: MoodcheckEngineDeps,
  nowMs: number = deps.nowMs(),
): Promise<MoodcheckTickResult> {
  const store = deps.moodcheckStore;
  try {
    const config = await store.getConfig().catch(() => null);
    if (!config) return { fired: false };
    if (!config.enabled) return { fired: false, reason: "disabled" };

    // Resolve the asking persona (chosen once, then stable).
    let personaId = config.personaId;
    if (!personaId) {
      const personas = await deps.listPersonas().catch(() => []);
      if (personas.length === 0) return { fired: false, reason: "no-persona" };
      personaId = personas[0].id;
      await store.setConfig({ personaId }).catch(() => {});
    }
    const persona = await deps.getPersona(personaId).catch(() => null);
    if (!persona) return { fired: false, reason: "no-persona" };

    const today = shanghaiDayKey(nowMs);
    const lastDay = await store.getLastCheckinDay().catch(() => "");
    if (lastDay === today) return { fired: false, reason: "already-fired-today" };
    if (nowMs < shanghaiHourToday(nowMs, config.hour)) {
      return { fired: false, reason: "not-yet-time" };
    }

    // Don't nag: yesterday fired and she never answered → one quiet day.
    if (lastDay !== "" && lastDay === shanghaiDayKey(nowMs - DAY_MS)) {
      const outcome = await store.getLastOutcome().catch(() => "answered" as const);
      if (outcome === "pending") {
        await store.setLastOutcome("skipped").catch(() => {});
        await traceSkip(deps, personaId, "no-reply-yesterday", "yesterday's check-in got no answer — one quiet day");
        return { fired: false, reason: "no-reply-yesterday" };
      }
    }

    // Smart skip: her mood is already on record today — he already knows.
    const todays = await store.getDay(today, personaId).catch(() => null);
    if (todays) {
      await traceSkip(deps, personaId, "already-recorded", `mood already recorded today ("${todays.mood}")`);
      return { fired: false, reason: "already-recorded" };
    }

    // Smart skip: she was just active — asking in chat is natural, a
    // push nudge would be redundant.
    const lastOpened = await deps.lastOpenedAt().catch(() => 0);
    if (lastOpened > 0 && nowMs - lastOpened < RECENTLY_ACTIVE_MS) {
      await traceSkip(deps, personaId, "recently-active", "she was active in the app recently");
      return { fired: false, reason: "recently-active" };
    }

    // Fire through the real initiative path (cap/isolation/ledger/trace).
    const rule = await deps.initiativeStore.create({
      personaId,
      title: buildCheckinTitle(),
      topic: buildCheckinTopic(),
      type: "one_time",
      schedule: { kind: "one_time", atMs: nowMs },
      target: { mode: "latest" },
    });
    await deps.onMutated(rule).catch(() => {});
    await deps.fireRule(rule.id, nowMs).catch(() => null);
    // One-shot ledger: fired today, no retry ever — even on cap failure.
    await store.setLastCheckinDay(today).catch(() => {});
    await store.setLastOutcome("pending").catch(() => {});
    await deps.trace
      .append({
        action: "moodcheck_fired",
        fromThreadId: "moodcheck",
        fromName: "每日心情",
        summary: `daily mood check-in fired for ${persona.name}`,
        reason: "daily check-in due at her hour — asked through the proactive path",
        personaId,
      })
      .catch(() => {});
    return { fired: true };
  } catch {
    return { fired: false };
  }
}
