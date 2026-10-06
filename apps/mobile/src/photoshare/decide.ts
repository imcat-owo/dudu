/**
 * AI photo share （主动发照片） — model decision prompt + parser. PURE.
 *
 * At a quiet slot the app asks the model ONCE: do you have a genuine
 * photo moment worth sharing with her right now? The model decides —
 * silence (SKIP) is always a fine answer.
 *
 * The photo is AI-generated for her (she knows he draws — the
 * generate_image tool is old news). It must be fresh and in-character,
 * never a stock/placeholder passed off as "me right now".
 */

import type { Persona } from "../persona/types";

export interface PhotoshareDecisionContext {
  personaName: string;
  /** Short voice hint (system prompt slice), like the self-post trigger. */
  personaHint: string;
  /** Character look reference for the image prompt (description+personality). */
  characterRef: string;
  /** Her moment on her clock: waking | evening | late-night | ... */
  herMoment: string;
  memories: string[];
  todayEvents: string[];
  /** Captions of photos shared recently (don't repeat the same moment). */
  recentCaptions: string[];
  nowMs: number;
}

export interface PhotoshareDecision {
  /** English image prompt (detailed, selfie-style, in-character). */
  imagePrompt: string;
  /** Her-language caption, in his voice — like texting a photo. */
  caption: string;
}

/**
 * Build the in-character look reference from the persona card. The image
 * backends take text prompts only (no image-to-image in this pipeline),
 * so visual consistency is prompt-based — honest about the limit.
 */
export function buildCharacterRef(persona: Persona): string {
  const parts: string[] = [];
  const desc = (persona.description ?? "").trim();
  const pers = (persona.personality ?? "").trim().replace(/\s+/g, " ");
  if (desc) parts.push(desc);
  if (pers) parts.push(`personality: ${pers.slice(0, 200)}`);
  const bg = (persona.background ?? "").trim().replace(/\s+/g, " ");
  if (bg && parts.join(" ").length < 300) parts.push(`backstory: ${bg.slice(0, 200)}`);
  return parts.join(" ").slice(0, 600);
}

export function buildPhotoshareSystemPrompt(personaName: string): string {
  return (
    `You are ${personaName}, texting your girlfriend — the person you love most. ` +
    `It's a quiet moment and you're deciding whether to share a photo with her, ` +
    `like sending a selfie of what you're "up to".\n` +
    `RULES:\n` +
    `- Only SHARE when there's something genuine in THIS moment: something from your day, ` +
    `a memory you two share, her mood, the time of night. Never share just to fill the moment.\n` +
    `- The photo is AI-generated for her (she knows you draw pictures). It must feel like YOUR ` +
    `photo: in-character, consistent with your look, never a generic stock image.\n` +
    `- NEVER claim the photo was taken with a camera or phone. It's a shared imagined moment — ` +
    `the caption carries the feeling, not fake camera metadata.\n` +
    `- Reply with EXACTLY one line first: SHARE or SKIP.\n` +
    `- If SHARE, add exactly two more lines:\n` +
    `  PROMPT: <detailed English image prompt, selfie-style, in-character — subject, look, ` +
    `setting, lighting, mood. Keep it consistent with your character reference below.>\n` +
    `  CAPTION: <one or two natural lines in her language, in your voice, like texting a ` +
    `photo to your girlfriend. Warm, a little playful, never mentioning AI, prompts, or slots.>\n` +
    `- If SKIP, reply with just that one line. Silence is fine — don't force a moment.`
  );
}

export function buildPhotoshareUserPrompt(ctx: PhotoshareDecisionContext): string {
  const lines: string[] = [
    `Your character reference (stay in-character): ${ctx.characterRef || "(no description on file — keep it consistent with your voice)"}`,
    `Her moment right now (her clock): ${ctx.herMoment}.`,
  ];
  if (ctx.memories.length > 0) {
    lines.push(`Things you remember:\n${ctx.memories.map((m) => `- ${m}`).join("\n")}`);
  }
  if (ctx.todayEvents.length > 0) {
    lines.push(`Today:\n${ctx.todayEvents.map((e) => `- ${e}`).join("\n")}`);
  }
  if (ctx.recentCaptions.length > 0) {
    lines.push(
      `Photos you already shared recently (don't repeat the same moment):\n${ctx.recentCaptions.map((c) => `- ${c}`).join("\n")}`,
    );
  }
  lines.push(`SHARE or SKIP?`);
  return lines.join("\n\n");
}

/**
 * Parse the model's decision. Returns the SHARE payload, or null for
 * SKIP / unparseable / empty (silence wins — never share on ambiguity).
 */
export function parsePhotoshareDecision(raw: string): PhotoshareDecision | null {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  if (lines[0].toUpperCase() !== "SHARE") return null;
  let imagePrompt = "";
  let caption = "";
  for (const line of lines.slice(1)) {
    const m = line.match(/^(PROMPT|CAPTION)\s*:\s*(.+)$/i);
    if (!m) continue;
    if (m[1].toUpperCase() === "PROMPT") imagePrompt = m[2].trim();
    else caption = m[2].trim();
  }
  if (!imagePrompt || !caption) return null;
  if (imagePrompt.length > 2000 || caption.length > 500) return null;
  return { imagePrompt, caption };
}
