/**
 * Personal greeting (P3-1) — PURE module, no React Native imports.
 *
 * The old welcome was a clock-time bucket ("早上好" at 8am — but for her,
 * 8am is deep sleep). This composes a greeting from HER rhythm plus a
 * real anchor, in priority order:
 *   1. an anniversary today / within 3 days,
 *   2. an unread love letter waiting,
 *   3. her moment on her own clock (never a generic "早上好").
 * The body carries a second soft anchor (pending tell-later count) or a
 * quiet fallback line. No fabricated content: every anchor comes from a
 * real record the caller loaded.
 */

import type { HerMoment } from "../our-space/her-rhythm";

export interface GreetingAnchors {
  anniversaries: { title: string; daysUntil: number }[];
  unseenLoveLetters: number;
  pendingTellLater: number;
}

export interface GreetingCopy {
  titleKey: string;
  titleParams?: Record<string, string | number>;
  bodyKey: string;
  bodyParams?: Record<string, string | number>;
}

const RHYTHM_TITLE_KEY: Record<HerMoment, string> = {
  "deep-sleep": "chat.greet.rhythm.evening", // she's awake and opening the app — treat as her evening
  waking: "chat.greet.rhythm.waking",
  evening: "chat.greet.rhythm.evening",
  "late-night": "chat.greet.rhythm.lateNight",
  "pre-dawn": "chat.greet.rhythm.preDawn",
};

export function composeGreeting(moment: HerMoment, anchors: GreetingAnchors): GreetingCopy {
  const near = anchors.anniversaries
    .filter((a) => a.daysUntil >= 0 && a.title.trim().length > 0)
    .sort((a, b) => a.daysUntil - b.daysUntil)[0];

  let titleKey = RHYTHM_TITLE_KEY[moment];
  let titleParams: Record<string, string | number> | undefined;
  if (near && near.daysUntil === 0) {
    titleKey = "chat.greet.anniversaryToday";
    titleParams = { title: near.title.trim() };
  } else if (near && near.daysUntil <= 3) {
    titleKey = "chat.greet.anniversarySoon";
    titleParams = { title: near.title.trim(), days: near.daysUntil };
  } else if (anchors.unseenLoveLetters > 0) {
    titleKey = "chat.greet.letterWaiting";
  }

  const bodyKey = "chat.greet.body.tellLater";
  const bodyParams =
    anchors.pendingTellLater > 0 ? { n: anchors.pendingTellLater } : undefined;

  return {
    titleKey,
    titleParams,
    bodyKey: bodyParams ? bodyKey : "chat.greet.body.soft",
    bodyParams,
  };
}
