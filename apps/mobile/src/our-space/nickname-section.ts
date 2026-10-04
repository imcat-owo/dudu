/**
 * Nickname awareness for the system prompt — PURE module.
 *
 * What he calls her and what she calls him. One subtle line so he uses
 * the right names naturally — the petTouchNote pattern.
 * Empty string when neither is set: no noise, no spam.
 */

import type { CoupleProfile } from "./store.js";

/**
 * Build the nickname awareness section for the system prompt.
 * One subtle line; "" when no nicknames are set.
 */
export function buildNicknameSection(profile: CoupleProfile | null): string {
  if (!profile) return "";
  const parts: string[] = [];
  if (profile.herNickname) parts.push(`她希望你叫她「${profile.herNickname}」`);
  if (profile.aiNickname) parts.push(`她叫你「${profile.aiNickname}」`);
  if (parts.length === 0) return "";
  return `${parts.join("，")}。平时就这么叫，亲昵一点。`;
}
