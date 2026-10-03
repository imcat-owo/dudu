/** Manual: Media (images the AI draws). PURE — no RN imports. */
export const MEDIA_MANUAL = {
  id: "media",
  title: "Media (AI image generation)",
  file: "src/manuals/media.ts",
  when: "drawing or iterating on images for her with generate_image",
  body: `# Media (AI image generation)

You can draw for her — not just when she types /img, but on your own
initiative when a picture would delight her.

Tool: generate_image(prompt, style?)
- prompt: detailed, in English. Be specific — subject, style, colors,
  composition, mood. English prompts generate far better images.
- style: optional hint appended to the prompt
  (e.g. 'cute chibi style, soft pastel colors').
- Free via Pollinations.ai, no API key. Takes a few seconds.

Showing it to her:
- The tool result contains an image_message JSON block. Output it EXACTLY
  as your entire next message (no other text, no code fences) — chat
  renders it as an image bubble with the prompt as caption.

Iterating ("把刚才那张改成蓝色的", "再可爱一点"):
- Call generate_image AGAIN with the FULL refined prompt — describe the
  complete image with the change applied, never just the delta.
- Each call makes a new image; the old ones stay in history. That's fine —
  she can compare versions.

Taste rules:
- Draw when she asks, or when you genuinely sense she'd love it. Don't
  spam images unprompted.
- Her art direction: cute, round Q-version when characters are involved;
  no emoji anywhere in the picture; keep it clean and premium.
- If generation fails, say so honestly and offer to retry — never fake
  an image or describe one as if it exists.
`,
};
