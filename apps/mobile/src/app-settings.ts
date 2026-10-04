/**
 * App-level display settings.
 *
 * NOT part of the theme bundle — owner decision 2026-10-03: fonts stay out
 * of theme bundles. Font SIZE is a per-user app preference, like theme mode.
 *
 * Font size defaults to compact ("small"). Owner explicitly dislikes
 * oversized "elderly phone" style UI — refined, delicate, compact is the goal.
 *
 * The option lives in a module-level store (useSyncExternalStore) so every
 * consumer re-renders live when the option changes in Settings — no remount
 * needed.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useSyncExternalStore } from "react";

export type FontSizeOption = "system" | "small" | "standard" | "large";

export const FONT_SIZE_OPTIONS: FontSizeOption[] = ["system", "small", "standard", "large"];

/** Scale multipliers for the explicit options. "system" follows the OS text-size setting. */
export const FONT_SCALES: Record<Exclude<FontSizeOption, "system">, number> = {
  small: 0.88,
  standard: 1,
  large: 1.15,
};

export const DEFAULT_FONT_SIZE_OPTION: FontSizeOption = "small";

const STORAGE_KEY = "dudu.settings.fontSize.v1";

function isFontSizeOption(raw: string | null): raw is FontSizeOption {
  return raw === "system" || raw === "small" || raw === "standard" || raw === "large";
}

let current: FontSizeOption = DEFAULT_FONT_SIZE_OPTION;
let loaded = false;
const listeners = new Set<() => void>();
// Generation guard (review P2, 2026-10-03): the import-time AsyncStorage
// load may resolve after the user already changed the option — a stale load
// must never clobber the newer in-memory value.
let generation = 0;

function emit() {
  for (const listener of listeners) listener();
}

// Load the saved option once; late subscribers still get the value via getSnapshot.
if (!loaded) {
  loaded = true;
  const seen = generation;
  AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      if (seen !== generation) return; // a setOption won the race — keep it
      if (isFontSizeOption(raw) && raw !== current) {
        current = raw;
        emit();
      }
    })
    .catch(() => {});
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): FontSizeOption {
  return current;
}

export function useFontSizeSetting(): {
  option: FontSizeOption;
  /** Numeric multiplier to apply to base font sizes. 1 when following system. */
  scale: number;
  /** True when the OS text-size setting should apply (allowFontScaling). */
  followSystem: boolean;
  setOption: (o: FontSizeOption) => Promise<void>;
} {
  const option = useSyncExternalStore(subscribe, getSnapshot);

  const setOption = useCallback(async (o: FontSizeOption) => {
    if (o !== current) {
      generation += 1;
      current = o;
      emit();
    }
    try {
      await AsyncStorage.setItem(STORAGE_KEY, o);
    } catch {
      // Non-fatal: preference stays in memory for this session.
    }
  }, []);

  const followSystem = option === "system";
  return { option, scale: followSystem ? 1 : FONT_SCALES[option], followSystem, setOption };
}

/**
 * Re-read the font-size option from storage (e.g. after backup restore).
 * Bumps the generation so a stale in-flight load can't clobber it.
 */
export async function refreshFontSizeOption(): Promise<void> {
  const seen = ++generation;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (seen !== generation) return;
    const next = isFontSizeOption(raw) ? raw : DEFAULT_FONT_SIZE_OPTION;
    if (next !== current) {
      current = next;
      emit();
    }
  } catch {
    // Non-fatal: keep the in-memory value.
  }
}

/**
 * Set the font-size option programmatically (e.g. from an AI tool).
 * Updates memory immediately (UI re-renders via useSyncExternalStore),
 * persists to AsyncStorage. No React needed — safe to call from PURE modules.
 */
export async function setFontSizeOption(o: FontSizeOption): Promise<void> {
  if (o !== current) {
    generation += 1;
    current = o;
    emit();
  }
  try {
    await AsyncStorage.setItem(STORAGE_KEY, o);
  } catch {
    // Non-fatal: preference stays in memory for this session.
  }
}
