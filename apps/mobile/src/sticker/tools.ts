/**
 * 图片表情包 — AI tools.
 *
 * sticker_list:  lists what stickers exist (her custom packs + AI library).
 *                 First call seeds the AI library (copies 10 mascot images)
 *                 — a real file write, so it is in INCOGNITO_BLOCKED_TOOLS.
 * sticker_send:  send one sticker. Resolves the sticker, copies it into the
 *                 message-scoped sent dir (a real file write on EVERY call),
 *                 and returns a sticker_message envelope: the AI pastes that
 *                 JSON into its reply so it renders as a chromeless sticker
 *                 bubble. In INCOGNITO_BLOCKED_TOOLS.
 *
 * Neither tool touches a store (pack management is her UI-only job), but
 * both leave files behind, so incognito refuses them — incognito promises
 * zero side effects.
 * manualId "sticker" pairs with src/manuals/sticker.ts (paper slip:
 * restraint rules — stickers punctuate, never replace, words).
 */

import type { LocalTool } from "../api-groups/local-tools";
import { ToolError } from "../api-groups/local-tools";
import type { Sticker, StickerPack } from "./types";
import { encodeStickerMessage } from "./types";

export interface StickerToolEnv {
  /** All packs with their stickers (AI library first). */
  listAll: () => Promise<Array<{ pack: StickerPack; stickers: Sticker[] }>>;
  /** Full file:// URI of a pack sticker file. */
  stickerFileUri: (packId: string, fileName: string) => Promise<string>;
  /**
   * Copy-on-send into the message-scoped sent dir. Returns the new URI
   * to embed in the envelope (survives pack deletion).
   */
  copyForSend: (srcUri: string) => Promise<string>;
  /** May the AI send stickers in the current persona's chats? (per-persona toggle) */
  isAiEnabled: () => Promise<boolean>;
}

export function createStickerTools(env: StickerToolEnv): LocalTool[] {
  return [
    {
      name: "sticker_list",
      description:
        "List available sticker packs and stickers (her custom packs + the AI library). " +
        "Call this before sticker_send so you pick a real sticker id. " +
        "Returns [{packId, packName, owner, stickers:[{id, name}]}].",
      parameters: { type: "object", properties: {} },
      manualId: "sticker",
      run: async () => {
        const all = await env.listAll();
        return JSON.stringify(
          all.map(({ pack, stickers }) => ({
            packId: pack.id,
            packName: pack.name,
            owner: pack.owner,
            stickers: stickers.map((s) => ({ id: s.id, name: s.name })),
          })),
        );
      },
    },
    {
      name: "sticker_send",
      description:
        "Send one image sticker in your reply. stickerId: from sticker_list. " +
        "Returns a sticker_message envelope JSON — PASTE that JSON into your reply " +
        "so it renders as a sticker bubble, and keep your words around it short. " +
        "GIFs render as their first frame only — never promise animation. " +
        "Restraint (from the sticker manual): stickers punctuate, never replace, " +
        "words — at most one per turn, never a sticker-only reply to anything serious.",
      parameters: {
        type: "object",
        properties: {
          stickerId: {
            type: "string",
            description: "The sticker's id (from sticker_list).",
          },
        },
        required: ["stickerId"],
      },
      manualId: "sticker",
      run: async (args) => {
        if (!(await env.isAiEnabled())) {
          throw new ToolError(
            "sticker sending is turned off for this persona — say so honestly instead of sending one.",
          );
        }
        const stickerId = typeof args.stickerId === "string" ? args.stickerId.trim() : "";
        if (!stickerId) throw new ToolError("stickerId is required — call sticker_list first.");
        const all = await env.listAll();
        let found: { sticker: Sticker; pack: StickerPack } | null = null;
        for (const { pack, stickers } of all) {
          const s = stickers.find((x) => x.id === stickerId);
          if (s) {
            found = { sticker: s, pack };
            break;
          }
        }
        if (!found) {
          throw new ToolError(
            `No sticker with id "${stickerId}". Call sticker_list and pick a real id — never invent one.`,
          );
        }
        const srcUri = await env.stickerFileUri(found.pack.id, found.sticker.fileName);
        const uri = await env.copyForSend(srcUri);
        return JSON.stringify({
          sticker_message: encodeStickerMessage({
            uri,
            stickerId: found.sticker.id,
            packId: found.pack.id,
            name: found.sticker.name,
          }),
          sent: { id: found.sticker.id, name: found.sticker.name, pack: found.pack.name },
          note: "Paste the sticker_message JSON into your reply so it renders as a sticker bubble.",
        });
      },
    },
  ];
}
