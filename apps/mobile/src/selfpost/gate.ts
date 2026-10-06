/**
 * AI self-post trigger （自发帖触发器） — deterministic gate. PURE.
 *
 * Borrowed from Bubblegunn/proactive-gate: one gate, ordered checks, every
 * rejection carries the check that produced it and why. This runs BEFORE
 * the model decision call (eamars/kazusaaichatbot's deterministic-policy
 * pattern) — cheap vetoes first, model call last.
 *
 * Check order (her constraints first):
 *  1. disabled — her kill switch
 *  2. incognito — never in incognito, hard
 *  3. quiet-hours — her sleep 06:00–16:00 Asia/Shanghai, hard block
 *  4. already-fired — slot ledger (interrupted slots stay consumed)
 *  5. expired — past the 15-min grace window, consumed silently
 *  6. selfpost-cap — her daily self-post cap
 *  7. shared-cap — initiative+outreach already hit the proactive cap today
 *  8. collision — a proactive send happened in the last 60 minutes
 *  9. persona-missing — no active persona, stay silent
 *  10. no-api-group — generation impossible, stay silent
 */

import { isHerSleepTime } from "../our-space/her-rhythm";
import { isSlotExpired, type SelfpostSlot } from "./slots";
import type { SelfpostConfig } from "./store";

export type SelfpostGateReason =
  | "disabled"
  | "incognito"
  | "quiet-hours"
  | "already-fired"
  | "expired"
  | "selfpost-capped"
  | "shared-capped"
  | "collision"
  | "persona-missing"
  | "no-api-group";

export interface SelfpostGateInput {
  config: SelfpostConfig;
  isIncognito: boolean;
  slot: SelfpostSlot;
  fired: boolean;
  selfpostsToday: number;
  /** initiative + outreach sends today (the shared "AI reaches her" channel). */
  sharedSendsToday: number;
  /** The shared proactive daily cap (initiative's cap, default 3). */
  sharedCap: number;
  /** ms since the last proactive send of any kind. */
  msSinceLastActivity: number;
  hasPersona: boolean;
  hasApiGroup: boolean;
  nowMs: number;
}

/** Don't fire a self-post slot within this long after any proactive send. */
export const SELFPOST_COLLISION_MS = 60 * 60_000;

export interface SelfpostGateResult {
  allowed: boolean;
  /** Present exactly when allowed === false. */
  reason?: SelfpostGateReason;
  /** One honest line for the log. */
  detail: string;
}

export function evaluateSelfpostGate(input: SelfpostGateInput): SelfpostGateResult {
  const {
    config,
    isIncognito,
    slot,
    fired,
    selfpostsToday,
    sharedSendsToday,
    sharedCap,
    msSinceLastActivity,
    hasPersona,
    hasApiGroup,
    nowMs,
  } = input;

  if (!config.enabled) {
    return { allowed: false, reason: "disabled", detail: "self-post trigger is off" };
  }
  if (isIncognito) {
    return { allowed: false, reason: "incognito", detail: "incognito: zero trace, stay silent" };
  }
  if (isHerSleepTime(nowMs)) {
    return {
      allowed: false,
      reason: "quiet-hours",
      detail: "she is asleep (06:00–16:00 Asia/Shanghai)",
    };
  }
  if (fired) {
    return { allowed: false, reason: "already-fired", detail: "slot already consumed" };
  }
  if (isSlotExpired(slot.atMs, nowMs)) {
    return {
      allowed: false,
      reason: "expired",
      detail: "slot older than 15 min — consumed silently, never backfilled",
    };
  }
  if (selfpostsToday >= config.dailyCap) {
    return {
      allowed: false,
      reason: "selfpost-capped",
      detail: `self-post cap reached (${selfpostsToday}/${config.dailyCap} today)`,
    };
  }
  if (sharedSendsToday >= sharedCap) {
    return {
      allowed: false,
      reason: "shared-capped",
      detail: `proactive channel cap reached (${sharedSendsToday}/${sharedCap} today)`,
    };
  }
  if (msSinceLastActivity < SELFPOST_COLLISION_MS) {
    return {
      allowed: false,
      reason: "collision",
      detail: "a proactive send happened <60 min ago — don't pile on",
    };
  }
  if (!hasPersona) {
    return { allowed: false, reason: "persona-missing", detail: "no active persona" };
  }
  if (!hasApiGroup) {
    return { allowed: false, reason: "no-api-group", detail: "no API group configured" };
  }
  return { allowed: true, detail: "all checks passed — ask the model" };
}
