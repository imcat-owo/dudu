/**
 * Chat text-bubble resolution — PURE module, no React Native imports.
 *
 * chat.tsx renders one message row per message; the `text` value it computes
 * decides whether a text bubble appears (and what it shows). That decision
 * is extracted here so node tests can cover it as the render-level guard.
 */
import type { ImageMessageHit } from "./image/protocol";
import type { VoiceMessageHit } from "./message-envelope";

/**
 * Text-bubble content for an AI message, given envelope detection results.
 *
 * When the message carries a voice/image envelope, the bubble shows ONLY the
 * surrounding prose (`rest`). A PURE JSON envelope (no prose, rest === "")
 * yields "" — it must NOT fall back to `content`, otherwise the raw JSON
 * renders as a text bubble stacked above the voice/image bubble (P1
 * regression from the P2-27 envelope work: `envelopeRest || message.content`
 * falls through on the empty string).
 */
export function resolveAssistantText(
  content: string,
  voiceHit: VoiceMessageHit | null,
  imageHit: ImageMessageHit | null,
): string {
  const envelopeRest = voiceHit?.rest || imageHit?.rest || "";
  return voiceHit || imageHit ? envelopeRest : content;
}
