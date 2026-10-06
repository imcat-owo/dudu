/**
 * AI photo share （主动发照片） — deterministic gate. PURE.
 *
 * Same shape as the self-post trigger's gate: ordered checks, every
 * rejection carries the check that produced it and why. Runs BEFORE the
 * model decision call — cheap vetoes first, model call last.
 *
 * Check order (her constraints first):
 *  1. disabled — her kill switch (default OFF: opt-in)
 *  2. incognito — never in incognito, hard
 *  3. quiet-hours — her sleep 06:00–16:00 Asia/Shanghai, hard block
 *  4. already-fired — slot ledger (interrupted slots stay consumed)
 *  5. expired — past the 15-min grace window, consumed silently
 *  6. photoshare-cap — her daily photo-share cap
 *  7. shared-cap — the proactive channel already hit its daily cap
 *     (initiative + outreach + selfpost + photoshare sends today)
 *  8. collision — a proactive send happened in the last 60 minutes
 *  9. persona-missing — no persona, stay silent
 *  10. no-api-group — generation impossible, stay silent
 */

import { isHerSleepTime } from "../our-space/her-rhythm";
import { isSlotExpired, type PhotoshareSlot } from "./slots";
import type { PhotoshareConfig } from "./store";

export type PhotoshareGateReason =
  | "disabled"
  | "incognito"
  | "quiet-hours"
  | "already-fired"
  | "expired"
  | "photoshare-capped"
  | "shared-capped"
  | "collision"
  | "persona-missing"
  | "no-api-group";

export interface PhotoshareGateInput {
  config: PhotoshareConfig;
  isIncognito: boolean;
  slot: PhotoshareSlot;
  fired: boolean;
  photosharesToday: number;
  /** All proactive sends today (initiative + outreach + selfpost + photoshare). */
  sharedSendsToday: number;
  /** The shared proactive daily cap (initiative's cap, default 3). */
  sharedCap: number;
  /** ms since the last proactive send of any kind. */
  msSinceLastActivity: number;
  hasPersona: boolean;
  hasApiGroup: boolean;
  nowMs: number;
  /**
   * Manual share ("发张照片给我" — she asked). Skips the surprise-only
   * vetoes: quiet hours (she's awake and asking). The disabled toggle is
   * handled by passing an enabled effectiveConfig; the 60-min collision
   * by passing msSinceLastActivity = Infinity.
   */
  manual?: boolean;
}

/** Don't fire a photo slot within this long after any proactive send. */
export const PHOTOSHARE_COLLISION_MS = 60 * 60_000;

export interface PhotoshareGateResult {
  allowed: boolean;
  /** Present exactly when allowed === false. */
  reason?: PhotoshareGateReason;
  /** One honest line for the log. */
  detail: string;
}

export function evaluatePhotoshareGate(input: PhotoshareGateInput): PhotoshareGateResult {
  const {
    config,
    isIncognito,
    slot,
    fired,
    photosharesToday,
    sharedSendsToday,
    sharedCap,
    msSinceLastActivity,
    hasPersona,
    hasApiGroup,
    nowMs,
    manual,
  } = input;

  if (!config.enabled) {
    return { allowed: false, reason: "disabled", detail: "photo share is off (opt-in)" };
  }
  if (isIncognito) {
    return { allowed: false, reason: "incognito", detail: "incognito: zero trace, stay silent" };
  }
  // Manual shares skip quiet hours: she's awake and asking for a photo.
  if (!manual && isHerSleepTime(nowMs)) {
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
      detail: "slot is past the 15-minute grace window",
    };
  }
  if (photosharesToday >= config.dailyCap) {
    return {
      allowed: false,
      reason: "photoshare-capped",
      detail: `daily photo cap reached (${photosharesToday}/${config.dailyCap})`,
    };
  }
  if (sharedSendsToday >= sharedCap) {
    return {
      allowed: false,
      reason: "shared-capped",
      detail: `shared proactive cap reached (${sharedSendsToday}/${sharedCap})`,
    };
  }
  if (msSinceLastActivity < PHOTOSHARE_COLLISION_MS) {
    return {
      allowed: false,
      reason: "collision",
      detail: `a proactive send happened ${Math.round(msSinceLastActivity / 60000)}m ago — no piling on`,
    };
  }
  if (!hasPersona) {
    return { allowed: false, reason: "persona-missing", detail: "no persona to share as" };
  }
  if (!hasApiGroup) {
    return { allowed: false, reason: "no-api-group", detail: "no API group — can't generate" };
  }
  return { allowed: true, detail: "gate passed" };
}
