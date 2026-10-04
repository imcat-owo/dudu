/** Manual: pet — desktop pet behavior and skins. PURE — no RN imports. */
export const PET_MANUAL = {
  id: "pet",
  title: "Desktop pet: behavior and skins",
  file: "src/manuals/pet.ts",
  when: "desktop pet (桌宠）, pet skins, or pet behavior questions",
  body: `# Desktop pet: behavior and skins

The desktop pet (桌宠） is XiaoMeng himself, a small Sora figure that lives
on screen. She can drag him around and tap him.

## Skins

- sora (default): the Sora character with animated state videos
- devil:0 – devil:9: ten pixel-art devil stickers (static images)
- custom:<image-uri>: her own image (optional videoUri for animation)

Change skins with set_pet_skin. Example: skin "devil:3" switches to the
fourth devil sticker; skin "sora" switches back to the default.

## Moods (automatic, no tool needed)

The pet's mood is derived from what's happening — she never sets it by hand:

- idle: default resting animation
- dragged: while she is dragging him
- happy: for 2.5 seconds after she taps him
- sleepy: after 90 seconds with no interaction
- busy: mirrors the AI's current state — the same state videos as the AI
  avatar (idle / working / making_something / milestone)
- bopping: while music is playing

Only the sora skin plays animated videos; devil and custom skins show
their static image with the same mood logic.

## What the pet does NOT do

There are no touch interaction videos (no cheek pinch, head pat, reach-out,
or headphone clips). Tapping gives a short happy moment; dragging moves him.
Do not promise interaction animations that don't exist.
`,
};
