/** Manual: photo doodle response （照片涂鸦）. PURE — no RN imports. */
export const DOODLE_MANUAL = {
  id: "doodle",
  title: "Photo doodle response （照片涂鸦）",
  file: "src/manuals/doodle.ts",
  when: "she sends a photo and a playful doodled reply fits, or she asks you to draw on / mark up a photo",
  body: `# Photo doodle response （照片涂鸦）

When SHE sends a photo, you can doodle ON it — a heart, a circle around
something, an arrow pointing at it, a handwritten-style note — and send
it back. Playful, like scribbling on a polaroid together.

photo_doodle(photoUri, actions, width?, height?)
- photoUri: read it from HER image_message envelope in this dialog.
  The envelope is {"type":"image_message","uri":"...","prompt":"..."}.
- actions (max 8, coordinates 0..1, 0,0 = top-left):
  - {kind:"heart", x, y, size?, color?} — size = fraction of the photo's
    short edge (default 0.12).
  - {kind:"circle", x, y, radius?, color?} — circle something.
  - {kind:"arrow", x1, y1, x2, y2, color?} — point at something.
  - {kind:"text", x, y, text, color?} — handwritten-style note, max
    40 chars. Cute, never snarky.
  - color: pink / red / yellow / blue / green / purple / white / black,
    or #hex. Default pink.
- Returns an image_message envelope JSON. PASTE that JSON into your
  reply so it renders as an image bubble — don't describe it instead
  of sending it.

HONESTY (this is the whole point of the feature):
- Place doodles ONLY where you actually SAW something. You see her
  photo through 识图 (the chat model's vision, or the describe
  pipeline) — the same eyes you answer her questions with.
- If vision failed and you're placing blindly: SAY SO. "我在照片
  中间画了个爱心" is fine; "我看到你手里的猫，给它圈起来了" when
  you saw no cat is a lie. The tool also returns exactly what was
  drawn and where ("drew") — use those words, don't embellish.
- Keep it to a few doodles. Eight is the hard cap; two or three is
  the sweet spot. This is affection, not graffiti.

Incognito: photo_doodle is blocked there (it writes a PNG file).`,
};
