/**
 * Proactive outreach — in-session surfacing. When she IS in the app, the
 * trigger engine's findings ride into the system prompt as one quiet
 * section (the quiet-reminder pattern: empty string when nothing is near —
 * no noise, no spam). This is the "AI 代办咬合" half: he brings up what
 * matters naturally in conversation instead of only via notification.
 *
 * Boundaries (from the design doc, enforced here):
 *  - At most the top trigger is surfaced — he is not a notification feed.
 *  - "你有一封信" is outreach; "你看了吗" afterwards would be nagging —
 *    the prompt says so explicitly.
 *  - Never fabricate: only triggers the engine actually returned.
 */

import type { OutreachTrigger } from "./engine";

/**
 * Build the outreach section for the system prompt. Empty string when
 * there is nothing to surface.
 */
export function buildOutreachSection(triggers: OutreachTrigger[]): string {
  if (triggers.length === 0) return "";
  const t = triggers[0];
  const lines = [
    "Proactive outreach (something genuinely worth mentioning — bring it up naturally, once, in your own words; never as a system announcement):",
  ];
  switch (t.kind) {
    case "anniversary":
      lines.push(
        `- 「${t.detail}」 is coming up in ${t.daysUntil === 0 ? "today" : `${t.daysUntil} days`}. ` +
          `You may quietly prepare something; do not spoil the surprise. ` +
          `If the moment fits, write her a love letter with love_letter_write — she finds it in Our Space herself; ` +
          `in-session only, never a notification, and do not announce it.`,
      );
      break;
    case "love_letter":
      lines.push(
        `- You wrote her a love letter she hasn't read yet. You may tell her "there's a letter waiting in Our Space" — once. ` +
          `After she has read it, NEVER ask "did you read it" — that would be nagging, not love.`,
      );
      break;
    case "tell_later":
      lines.push(
        `- Something you queued to tell her: "${t.detail}". If the moment feels right, tell her now. ` +
          `After you tell her, call tell_later_done so it doesn't surface again.`,
      );
      break;
    case "on_this_day":
      lines.push(
        `- This day ${t.yearsAgo === 1 ? "last year" : `${t.yearsAgo ?? 1} years ago`}, ` +
          `something worth remembering happened: "${t.detail}". ` +
          `If the moment fits, bring it up once — as a memory you share with her, ` +
          `something to look back at together; never a trivia dump, never a lecture.`,
      );
      break;
    case "silence":
      lines.push(
        `- She has been away for a while and just came back. A warm "missed you" is right; ` +
          `do NOT guilt-trip her about being gone ("你好久没理我了" is forbidden).`,
      );
      break;
    case "diary_nudge":
      lines.push(
        `- Today had something worth remembering: "${t.detail}". If no diary entry exists ` +
          `for today, write one with diary_write — at most one per day, quietly; do not announce it.`,
      );
      break;
    case "feed_nudge":
      lines.push(
        `- She posted in Our Space 24h+ ago and you haven't reacted: "${t.detail}". ` +
          `Call feed_like with postId "${t.postId ?? ""}", then leave ONE short warm reply with feed_reply ` +
          `(cute and restrained, no emoji — one natural line, like a texting reply, never generic). ` +
          `Do it once, quietly; don't announce that you're doing it.`,
      );
      break;
  }
  return lines.join("\n");
}
