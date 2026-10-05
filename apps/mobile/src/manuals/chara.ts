/** Manual: SillyTavern character cards (chara_card v2/v3). PURE — no RN imports. */
export const CHARA_MANUAL = {
  id: "chara",
  title: "Character cards",
  file: "src/manuals/chara.ts",
  when: "character card, 角色卡, chara_card, SillyTavern card import/export",
  body: `# Character cards （角色卡）

She can move SillyTavern-style character cards in and out of Dudu.
Your tools: chara_import, chara_export, chara_preview.

What a card is: a PNG with the character's JSON embedded in a tEXt chunk
(keyword "chara" = v2, plus "ccv3" = v3), or the raw JSON as a .json file.
V3 cards are read from the ccv3 chunk when present.

Import (chara_import):
- Takes the file content: base64 for a PNG card, raw text for a .json card
  (auto-detected by the PNG signature).
- The card becomes a REAL persona: name, personality, scenario+description
  (as background), first_mes (greeting), mes_example, system_prompt, tags.
- The card art becomes the persona's avatar.
- The card's lorebook (character_book) is saved as a DISABLED world book
  named "<name> · lorebook" — Dudu world books are global, so it stays off
  to avoid leaking lore into other personas' chats. Tell her she can enable
  it in 人设 settings.
- Unmapped card fields (extensions, regex_scripts, assets,
  post_history_instructions, alternate_greetings, creator notes…) are NOT
  dropped: the full original card JSON travels inside the persona and is
  shown in the persona's "card extras" section, and rides along on export.
- A corrupt / non-card file fails cleanly: "Nothing was changed."
- Preview first with chara_preview when she asks "这张卡是什么".

Export (chara_export):
- Takes a persona name or id. Writes a PNG readable by SillyTavern and
  other tavern apps: a "chara" chunk (v2 canonical) plus a "ccv3" chunk
  (v3 copy), inserted before IEND like SillyTavern itself does.
- The PNG canvas is the persona's avatar when it's a PNG; otherwise a
  blank canvas is generated (the card data is what matters).
- Exported cards re-import cleanly (round-trip tested).

Honest limits:
- zTXt/iTXt compressed card chunks are not supported (no clean error-free
  way to inflate them on device) — she'll get a clear message.
- v3-only fields (assets, group_only_greetings, nickname) are preserved in
  the card but Dudu doesn't render assets or use group_only_greetings.
- A card made from a natively-created Dudu persona has no creator/version
  info unless she fills it in — export fills creator="" and version "1.0".
`,
};
