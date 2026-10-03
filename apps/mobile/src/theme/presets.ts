/**
 * Built-in theme presets: 5 tasteful bundles, mixed light and dark.
 *
 * Display names are i18n keys ("theme.preset.*") resolved via t() at render
 * time — no hardcoded user-facing strings anywhere here.
 */

import { makeThemeBundle } from "./derive";
import type { ThemeBundle } from "./types";

const BUILT_IN_AUTHOR = "dudu";

export const PRESETS: readonly ThemeBundle[] = [
  makeThemeBundle({
    id: "preset-sora-gray",
    name: "theme.preset.soraGray",
    // Seed extracted from the owner's finalized avatar
    // (artwork/avatar/sora-avatar.webp, mid-tone average).
    seed: { primary: "#aaa7aa" },
    mode: "light",
    author: BUILT_IN_AUTHOR,
  }),
  makeThemeBundle({
    id: "preset-mint-frost",
    name: "theme.preset.mintFrost",
    seed: { primary: "#3f9b8a" },
    mode: "light",
    author: BUILT_IN_AUTHOR,
  }),
  makeThemeBundle({
    id: "preset-sunset-peach",
    name: "theme.preset.sunsetPeach",
    seed: { primary: "#cf6a4d" },
    mode: "light",
    author: BUILT_IN_AUTHOR,
  }),
  makeThemeBundle({
    id: "preset-sakura-mist",
    name: "theme.preset.sakuraMist",
    seed: { primary: "#b98aa5" },
    mode: "light",
    author: BUILT_IN_AUTHOR,
  }),
  makeThemeBundle({
    id: "preset-lavender-night",
    name: "theme.preset.lavenderNight",
    seed: { primary: "#9b8afb" },
    mode: "dark",
    author: BUILT_IN_AUTHOR,
  }),
  makeThemeBundle({
    id: "preset-deep-ocean",
    name: "theme.preset.deepOcean",
    seed: { primary: "#5b9bd5" },
    mode: "dark",
    author: BUILT_IN_AUTHOR,
  }),
];

export const DEFAULT_PRESET_ID = "preset-mint-frost";

export function getPreset(id: string): ThemeBundle {
  const found = PRESETS.find((p) => p.id === id);
  return found ?? PRESETS[0];
}

/** The bundle used on first launch and for corrupt-cache self-heal. */
export const defaultPreset: ThemeBundle = getPreset(DEFAULT_PRESET_ID);
