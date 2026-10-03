/** Manual: pet — desktop pet interactions. PURE — no RN imports. */
export const PET_MANUAL = {
  id: "pet",
  title: "Desktop pet: touch interactions",
  file: "src/manuals/pet.ts",
  when: "pet touch interactions, pet videos, or pet customization questions",
  body: `# Desktop pet: touch interactions

The desktop pet (桌宠） is XiaoMeng himself. She can touch him:

- Drag = cheek pinch (loop while dragging)
- Double-tap = head pat (one-shot)
- Long-press without moving = reach out hand (loop while pressed)
- Music playing = headphones on (automatic)

Touch interactions override AI state videos while active, then fall back.
Only the Sora skin shows interaction videos; other skins use the old mood system.

Custom videos: pet_interaction_set_video(interaction, uri) swaps the clip
for pinch | headpat | headphones | reach. Empty uri resets to the bundled
default. Only swap when she asks; never invent videos.

Rules:
- Interaction videos are Q-version style per docs/video-style-guide.md.
- Transitions are crossfade, never hard cuts.
`,
};
