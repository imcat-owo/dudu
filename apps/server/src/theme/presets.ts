/**
 * Built-in preset seeds — server mirror of apps/mobile/src/theme/presets.ts.
 * Only seed + mode are mirrored (the server derives surfaces itself);
 * display names stay client-side (i18n).
 */

import { makeThemeBundle } from "./derive.ts";
import type { ThemeBundle } from "./types.ts";

export type PresetSeed = {
  id: string;
  seed: { primary: string; secondary?: string; tertiary?: string };
  mode: "light" | "dark";
};

export const PRESET_SEEDS: readonly PresetSeed[] = [
  { id: "preset-sora-gray", seed: { primary: "#aaa7aa" }, mode: "light" },
  { id: "preset-mint-frost", seed: { primary: "#3f9b8a" }, mode: "light" },
  { id: "preset-sunset-peach", seed: { primary: "#cf6a4d" }, mode: "light" },
  { id: "preset-sakura-mist", seed: { primary: "#b98aa5" }, mode: "light" },
  { id: "preset-lavender-night", seed: { primary: "#9b8afb" }, mode: "dark" },
  { id: "preset-deep-ocean", seed: { primary: "#5b9bd5" }, mode: "dark" },
];

export function presetBundle(id: string, name: string, label?: string): ThemeBundle | null {
  const found = PRESET_SEEDS.find((p) => p.id === id);
  if (!found) return null;
  return makeThemeBundle({
    id: `theme-${Date.now().toString(36)}`,
    name,
    seed: found.seed,
    mode: found.mode,
    author: "openmuse",
    ...(label ? { label } : {}),
  });
}
