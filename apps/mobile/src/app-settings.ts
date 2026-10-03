/**
 * App-level display settings.
 *
 * NOT part of the theme bundle — owner decision 2026-10-03: fonts stay out
 * of theme bundles. Font SIZE is a per-user app preference, like theme mode.
 *
 * Font size defaults to compact ("small"). Owner explicitly dislikes
 * oversized "elderly phone" style UI — refined, delicate, compact is the goal.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

export type FontSizeOption = "system" | "small" | "standard" | "large";

export const FONT_SIZE_OPTIONS: FontSizeOption[] = [
  "system",
  "small",
  "standard",
  "large",
];

/** Scale multipliers for the explicit options. "system" follows the OS text-size setting. */
export const FONT_SCALES: Record<Exclude<FontSizeOption, "system">, number> = {
  small: 0.88,
  standard: 1,
  large: 1.15,
};

export const DEFAULT_FONT_SIZE_OPTION: FontSizeOption = "small";

const STORAGE_KEY = "openmuse.settings.fontSize.v1";

function isFontSizeOption(raw: string | null): raw is FontSizeOption {
  return raw === "system" || raw === "small" || raw === "standard" || raw === "large";
}

export function useFontSizeSetting(): {
  option: FontSizeOption;
  /** Numeric multiplier to apply to base font sizes. 1 when following system. */
  scale: number;
  /** True when the OS text-size setting should apply (allowFontScaling). */
  followSystem: boolean;
  setOption: (o: FontSizeOption) => Promise<void>;
} {
  const [option, setOptionState] = useState<FontSizeOption>(DEFAULT_FONT_SIZE_OPTION);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (isFontSizeOption(raw)) setOptionState(raw);
      })
      .catch(() => {});
  }, []);

  const setOption = useCallback(async (o: FontSizeOption) => {
    setOptionState(o);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, o);
    } catch {
      // Non-fatal: preference stays in memory for this session.
    }
  }, []);

  const followSystem = option === "system";
  return { option, scale: followSystem ? 1 : FONT_SCALES[option], followSystem, setOption };
}
