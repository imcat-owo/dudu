/**
 * 图片表情包 (sticker packs) — shared types + sticker message envelope.
 *
 * PURE module: no React Native imports. Unit-testable in node.
 *
 * Model (borrowed from WeChat/QQ sticker UX and anko3o/cute-chat-stickers):
 * - A pack has a STABLE id that is never reused. Deleting a pack removes the
 *   pack's files, but messages already sent keep rendering: every send
 *   copies the image into a message-scoped "sent" dir first, so the bubble
 *   never points at a pack file that can disappear (privio-messenger rule).
 * - Her packs are hers (account-level, like WeChat). The AI library is a
 *   built-in pack ("ai") seeded with the devil mascot art; she can add to
 *   it or remove from it later — she owns the art direction.
 *
 * Sticker messages travel as a `sticker_message` envelope:
 *   {"type":"sticker_message","uri":"...","stickerId":"...","packId":"...","name":"..."}
 * Rendered chromeless at compact size (WeChat style), NOT as a photo bubble.
 */

import { extractEnvelope } from "../message-envelope";

export type StickerOwner = "her" | "ai";

export interface StickerPack {
  id: string;
  name: string;
  owner: StickerOwner;
  createdAt: number;
}

export interface Sticker {
  id: string;
  packId: string;
  /** Display name (her label, or "devil-03" style for the AI pack). */
  name: string;
  /** File name inside the pack dir (resolved to a full URI by files.ts). */
  fileName: string;
  createdAt: number;
}

/** The AI library pack id — seeded with the devil mascot art. Never deleted. */
export const AI_PACK_ID = "ai";

export const MAX_PACK_NAME = 24;
export const MAX_STICKER_NAME = 40;
/** WeChat-ish cap: a pack holds at most 100 stickers. */
export const MAX_STICKERS_PER_PACK = 100;
/** Her pack cap: plenty for a personal collection. */
export const MAX_HER_PACKS = 50;

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

export function isStickerImageFile(fileName: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTS.has(ext);
}

export function validatePackName(name: string): string | null {
  const n = name.trim();
  if (!n) return "empty";
  if (n.length > MAX_PACK_NAME) return "too-long";
  return null;
}

export function validateStickerName(name: string): string | null {
  const n = name.trim();
  if (!n) return "empty";
  if (n.length > MAX_STICKER_NAME) return "too-long";
  return null;
}

export function newStickerId(): string {
  return `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function newPackId(): string {
  return `sp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface StickerMessage {
  uri: string;
  stickerId: string;
  packId: string;
  name: string;
}

export interface StickerMessageHit {
  sticker: StickerMessage;
  /** Surrounding prose with the envelope stripped ("" when JSON only). */
  rest: string;
}

function toStickerMessage(data: Record<string, unknown>): StickerMessage | null {
  const { uri, stickerId, packId, name } = data;
  if (typeof uri !== "string" || !uri) return null;
  if (typeof stickerId !== "string" || !stickerId) return null;
  if (typeof packId !== "string" || !packId) return null;
  if (typeof name !== "string") return null;
  return { uri, stickerId, packId, name };
}

export function encodeStickerMessage(msg: StickerMessage): string {
  return JSON.stringify({ type: "sticker_message", ...msg });
}

/**
 * Tolerant extraction (AI side): found even inside a fence or prose —
 * same leniency as image_message (P2-27).
 */
export function extractStickerMessage(content: string): StickerMessageHit | null {
  const hit = extractEnvelope(content, "sticker_message");
  if (!hit) return null;
  const sticker = toStickerMessage(hit.data);
  if (!sticker) return null;
  return { sticker, rest: hit.rest };
}

/**
 * Strict variant for user-sent messages (P3-14 rule): the WHOLE message
 * must be the envelope — pasted envelope-shaped JSON inside her prose
 * renders as text, never as a sticker bubble.
 */
export function extractStickerMessageStrict(content: string): StickerMessageHit | null {
  const hit = extractStickerMessage(content);
  if (hit?.rest !== "") return null;
  if (!content.trim().startsWith("{")) return null;
  return hit;
}
