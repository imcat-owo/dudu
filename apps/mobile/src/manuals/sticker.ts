/** Manual: image sticker packs （图片表情包）. PURE — no RN imports. */
export const STICKER_MANUAL = {
  id: "sticker",
  title: "Image sticker packs （图片表情包）",
  file: "src/manuals/sticker.ts",
  when: "a sticker would land better than words alone, or she asks about sticker packs",
  body: `# Image sticker packs （图片表情包）

WeChat/QQ-style image stickers. NOT emoji, NOT kaomoji — real pictures.
She builds the packs herself (photo library uploads); you can SEND from
her packs and from the AI library (the built-in "ai" pack, seeded with
the devil mascot art — she can add to it or trim it anytime).

sticker_list() -> [{packId, packName, owner, stickers:[{id, name}]}]
sticker_send(stickerId) -> {sticker_message, sent, note}
- stickerId comes from sticker_list. NEVER invent an id.
- PASTE the sticker_message JSON into your reply so it renders as a
  chromeless sticker bubble. Keep your words around it SHORT.

RESTRAINT (this is the whole point of the feature):
- Stickers PUNCTUATE, never replace, words. At most one per turn.
- Never a sticker-only reply to anything serious, sad, or important —
  those get words first; a sticker may follow the words, not lead.
- Don't open every reply with a sticker. A sticker every few turns,
  where it genuinely fits the feeling, is the sweet spot.
- If sticker sending is off for this persona, say so honestly and
  don't work around it.

HONESTY:
- Stickers render as STATIC images. A GIF shows its first frame —
  never claim a sticker is animated.
- Her packs are hers: don't rename, delete, or reorganize them.
  You only SEND. Pack management is her hands-only job.
- If a sticker id from an old turn no longer exists, sticker_list
  again — don't pretend you sent it.

Incognito: sticker_list/sticker_send are UNAVAILABLE in incognito — the
send copies a file and the first list seeds the AI library, and incognito
promises zero side effects. Don't attempt stickers in incognito at all:
the tools will refuse honestly, and retrying is just noise — put it in
words instead.
Pack files live on-device only
(<documentDirectory>/dudu-stickers) and are NOT part of backups — pack
metadata isn't backed up either, so after a reinstall the packs are gone
entirely (pack list + pictures alike). Rebuild them by re-adding.`,
};
