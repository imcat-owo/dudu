/**
 * Devil sticker mascot set — the owner's own art.
 *
 * Source files live at artwork/mascot/devil-01.jpg … devil-10.jpg (the
 * pristine archive, never touched by the app) and are bundled into the app
 * at apps/mobile/assets/mascot/. The images are used EXACTLY as-is: never
 * resized, redrawn, recolored, or otherwise modified.
 *
 * This module is pure TypeScript (no react-native import) so it stays
 * unit-testable. Asset resolution lives in ./mascot-assets.
 */

/** Number of stickers in the set. */
export const MASCOT_COUNT = 10;

/** Sticker used as the default assistant face (devil-01.jpg). */
export const DEFAULT_MASCOT_INDEX = 0;

/** Bundled filenames, in order. Index i ↔ devil-(i+1).jpg. */
export const MASCOT_STICKER_FILES: readonly string[] = [
  "devil-01.jpg",
  "devil-02.jpg",
  "devil-03.jpg",
  "devil-04.jpg",
  "devil-05.jpg",
  "devil-06.jpg",
  "devil-07.jpg",
  "devil-08.jpg",
  "devil-09.jpg",
  "devil-10.jpg",
];

/** Clamp any number into a valid sticker index (0 … MASCOT_COUNT-1). */
export function clampMascotIndex(i: number): number {
  if (!Number.isFinite(i)) return DEFAULT_MASCOT_INDEX;
  return Math.min(MASCOT_COUNT - 1, Math.max(0, Math.floor(i)));
}
