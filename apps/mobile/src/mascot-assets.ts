/**
 * Mascot asset resolution — the only place bundled sticker paths live.
 *
 * The theme token model (bundle.avatar.assistant / .user) carries plain URI
 * strings; this module translates sticker indices into those URIs via
 * Image.resolveAssetSource, and into <Image> sources for direct rendering.
 * Nothing outside this module hardcodes a sticker path.
 */
import { Image, type ImageSourcePropType } from "react-native";
import { clampMascotIndex, MASCOT_COUNT } from "./mascot";

function stickerSources(): ImageSourcePropType[] {
  // Static requires so Metro bundles the files. Byte-identical copies of
  // artwork/mascot/devil-*.jpg — never edit the image bytes.
  return [
    require("../assets/mascot/devil-01.jpg") as ImageSourcePropType,
    require("../assets/mascot/devil-02.jpg") as ImageSourcePropType,
    require("../assets/mascot/devil-03.jpg") as ImageSourcePropType,
    require("../assets/mascot/devil-04.jpg") as ImageSourcePropType,
    require("../assets/mascot/devil-05.jpg") as ImageSourcePropType,
    require("../assets/mascot/devil-06.jpg") as ImageSourcePropType,
    require("../assets/mascot/devil-07.jpg") as ImageSourcePropType,
    require("../assets/mascot/devil-08.jpg") as ImageSourcePropType,
    require("../assets/mascot/devil-09.jpg") as ImageSourcePropType,
    require("../assets/mascot/devil-10.jpg") as ImageSourcePropType,
  ];
}

/** <Image> source for sticker `index` (clamped to 0 … MASCOT_COUNT-1). */
export function mascotSource(index: number): ImageSourcePropType {
  const all = stickerSources();
  if (all.length !== MASCOT_COUNT) {
    throw new Error("mascot sticker list out of sync with MASCOT_COUNT");
  }
  return all[clampMascotIndex(index)];
}

/**
 * Resolved URI string for sticker `index`, suitable for storing in the
 * theme token (bundle.avatar.assistant / .user). Returns "" when the
 * asset can't be resolved (callers fall back to the Mascot component).
 */
export function mascotUri(index: number): string {
  try {
    const resolved = Image.resolveAssetSource(mascotSource(index));
    return resolved?.uri ?? "";
  } catch {
    return "";
  }
}
