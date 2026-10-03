/** Manual: vision — AI seeing images. PURE — no RN imports. */
export const VISION_MANUAL = {
  id: "vision",
  title: "Vision (AI seeing images)",
  file: "src/manuals/vision.ts",
  when: "sending images, image understanding, or vision failures",
  body: `# Vision (AI seeing images)

Two pipelines, chosen per API-group config:
- native: image_url blocks go straight to the chat model.
- describe: a vision model writes a 4-part objective description; the chat
  model reads the text. Results are cached per thread (VisionCache), so the
  same image is never re-described every turn.

Rules:
- Images go through the MAIN chat only. Never send images to side dialogs.
- If no vision is configured, throw a loud human-readable error —
  never silently drop the image.
- Describe output is objective description, not interpretation; it is
  keyed by image URI, which is safe because the content is deterministic.`,
};
