/**
 * Sora avatar + animated avatar asset resolution — the only place the
 * bundled avatar paths live.
 *
 * The Sora avatar is the owner's finalized AI assistant face
 * (artwork/avatar/sora-avatar.webp, pristine archive, never touched).
 * The four animation mp4s live at artwork/avatar-anim/; the app bundles
 * byte-identical copies at apps/mobile/assets/avatar[-anim]/.
 *
 * Mirrors the mascot-assets.ts pattern: nothing outside this module
 * hardcodes an avatar path. The theme token model still carries plain
 * URI strings; this module translates states into VideoSources.
 */
import type { VideoSource } from "expo-video";
import { Image, type ImageSourcePropType } from "react-native";
import { AVATAR_STATE_VIDEO, type AvatarState } from "./avatar-state";

/** <Image> source for the static Sora avatar (still contexts). */
export function soraSource(): ImageSourcePropType {
  // Static require so Metro bundles the file. Byte-identical copy of
  // artwork/avatar/sora-avatar.webp — never edit the image bytes.
  return require("../assets/avatar/sora-avatar.webp") as ImageSourcePropType;
}

/**
 * Resolved URI string for the Sora avatar, suitable for storing in the
 * theme token (bundle.avatar.assistant). Returns "" when the asset
 * can't be resolved (callers fall back to soraSource()).
 */
export function soraUri(): string {
  try {
    const resolved = Image.resolveAssetSource(soraSource());
    return resolved?.uri ?? "";
  } catch {
    return "";
  }
}

function videoSources(): Record<
  "idle" | "working" | "making_something" | "milestone_level_up",
  VideoSource
> {
  // Static requires so Metro bundles the files. Byte-identical copies of
  // artwork/avatar-anim/*.mp4 — never edit the video bytes.
  return {
    idle: require("../assets/avatar-anim/idle.mp4") as VideoSource,
    working: require("../assets/avatar-anim/working.mp4") as VideoSource,
    making_something: require("../assets/avatar-anim/making_something.mp4") as VideoSource,
    milestone_level_up: require("../assets/avatar-anim/milestone_level_up.mp4") as VideoSource,
  };
}

/** Bundled mp4 VideoSource for an AvatarState. */
export function avatarVideoSource(state: AvatarState): VideoSource {
  return videoSources()[AVATAR_STATE_VIDEO[state]];
}
