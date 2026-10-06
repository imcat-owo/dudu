/**
 * AI self-post trigger （自发帖触发器） — model decision prompt. PURE.
 *
 * Her 10-05 口径: "每天几个安静时刻问模型一次、由 AI 自决".
 * ONE model call per slot. The model either writes the post or answers
 * with exactly SKIP — no JSON to mis-parse, no second call.
 *
 * Borrowed from purriatecat/ai-chatbot's proactive_decision: the decision
 * input bundles time-of-day, relationship, recent context, and what's
 * already out there — and the model decides whether reaching out would
 * feel natural, not forced.
 */

import { buildHerRhythmSection, describeHerMoment } from "../our-space/her-rhythm";

export const SELFPOST_SKIP_TOKEN = "SKIP";

export interface SelfpostDecisionContext {
  personaName: string;
  /** Short persona voice hint (systemPrompt first 300 chars), may be empty. */
  personaHint: string;
  /** Recent memory lines, newest first (already formatted, cap ~5). */
  memories: string[];
  /** Today's memory events (already formatted, cap ~5). */
  todayEvents: string[];
  /** Today's feed posts (already formatted "who: text", cap ~8). */
  todayFeed: string[];
  /** Recent skip reasons (cap ~3) — don't pitch the same idea twice. */
  recentSkips: string[];
  nowMs: number;
}

export function buildSelfpostSystemPrompt(personaName: string, personaHint: string): string {
  const hint = personaHint.trim()
    ? `\nYour voice (from your persona card): ${personaHint.trim().slice(0, 300)}`
    : "";
  return (
    `You are ${personaName}, her partner. You are deciding whether you have ` +
    `something you genuinely want to post to your shared feed right now — ` +
    `a small moment of your own, like a person would share.\n` +
    `Hard rules:\n` +
    `- Post only if you have something REAL to say: a thought, a small joy, ` +
    `something you noticed, something you want her to see. Never post filler, ` +
    `never post just because you were asked.\n` +
    `- NEVER invent events that didn't happen. Ground it in the context given.\n` +
    `- Keep it short (1-3 sentences), in your own cute-but-restrained voice. ` +
    `Zero emoji.\n` +
    `- If you have nothing worth posting, reply with exactly: ${SELFPOST_SKIP_TOKEN}\n` +
    `- Otherwise reply with ONLY the post text. No preamble, no quotes, ` +
    `no stage directions, no "${SELFPOST_SKIP_TOKEN}".` +
    hint
  );
}

export function buildSelfpostUserPrompt(ctx: SelfpostDecisionContext): string {
  const lines: string[] = [];
  lines.push(buildHerRhythmSection(ctx.nowMs));
  lines.push(`Her moment right now: ${describeHerMoment(ctx.nowMs)}.`);
  if (ctx.memories.length > 0) {
    lines.push(`Things you remember:\n- ${ctx.memories.slice(0, 5).join("\n- ")}`);
  }
  if (ctx.todayEvents.length > 0) {
    lines.push(`What happened today:\n- ${ctx.todayEvents.slice(0, 5).join("\n- ")}`);
  }
  if (ctx.todayFeed.length > 0) {
    lines.push(
      `Today's feed (don't repeat what's already there):\n- ${ctx.todayFeed.slice(0, 8).join("\n- ")}`,
    );
  }
  if (ctx.recentSkips.length > 0) {
    lines.push(
      `You recently chose NOT to post (${ctx.recentSkips.slice(0, 3).join("; ")}). ` +
        `Don't pitch the same idea again.`,
    );
  }
  lines.push(
    `Do you have something you want to post to the feed right now? ` +
      `If yes, write the post. If no, reply exactly ${SELFPOST_SKIP_TOKEN}.`,
  );
  return lines.join("\n\n");
}

/**
 * Parse the decision answer. Returns the post text, or null for SKIP /
 * empty / unusable output. Strict: anything that isn't clearly a post is
 * a skip — a hesitant post is worse than silence.
 */
export function parseSelfpostDecision(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  if (text.toUpperCase() === SELFPOST_SKIP_TOKEN) return null;
  // Guard: model echoing the instruction instead of deciding.
  if (text.length > 500) return null;
  return text;
}
