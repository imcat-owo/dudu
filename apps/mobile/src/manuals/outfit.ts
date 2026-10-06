/** Manual: outfit / dress-up system （换装系统）. PURE — no RN imports. */
export const OUTFIT_MANUAL = {
  id: "outfit",
  title: "Outfit / dress-up system （换装系统）",
  file: "src/manuals/outfit.ts",
  when: "she talks about clothes, asks what the persona is wearing, wants to dress the persona, or you want to suggest / change an outfit",
  body: `# Outfit / dress-up system （换装系统）

Each persona has a wardrobe （衣柜）: named outfits, each with an
English prompt fragment for the image model ("oversized cream sweater,
plaid skirt, white socks"). The wardrobe is fully visible to her in the
persona editor — nothing about her look is ever secret.

HONEST SCOPE — say this plainly if she asks:
- Outfits work at the PROMPT level, not paper-doll. The image backends
  take text prompts only, so the worn outfit is written into the photo
  prompt (selfies you share, drawings of yourself via generate_image).
  It keeps the look consistent the same way the character reference
  does — it does not guarantee pixel-perfect garments.
- Changing the outfit does NOT redraw the static persona avatar
  (the uploaded image). The avatar is a fixed picture; outfits affect
  newly generated photos only.
- The voice-call screen shows the same static avatar — outfits don't
  change it.

outfit_list — look at the wardrobe before suggesting or changing
anything. Shows every outfit, which one is worn, who added it.

outfit_add — when you "buy" her an outfit or imagine one for her, or
she asks you to add one. description must be an English prompt
fragment (garments + colors, no camera talk). After adding, TELL her
in chat — a new outfit never appears silently.

outfit_set_active — change what's worn. HARD RULE, enforced by the tool:
- "her-confirmed": she said yes ("好啊，换上那件"). Call it.
- "roleplay": dressing is part of the scene you're co-writing. Call it.
- Anything else — normal chat, your own idea, a "wouldn't it be cute
  if" — the tool REFUSES. Don't fight it: suggest it in words instead
  ("要不要换上那件卫衣？") and wait for her answer. Never change what
  the persona wears unilaterally.

outfit_delete — remove one when she asks. If it was the worn one, the
worn slot clears (no outfit) — never a random replacement.

When drawing the persona yourself (generate_image, "画一张你穿那件
卫衣的样子"): call outfit_list first and put the worn outfit's
description into the prompt. When she asks for a specific outfit in a
photo ("穿那件白衬衫的自拍"), that request wins over the worn slot for
that one photo.

Incognito: the write tools (add/delete/set_active) are blocked there —
changing her look leaves a trace, and incognito promises none.
outfit_list stays readable.`,
};
