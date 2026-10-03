/**
 * i18n public API.
 *
 * - Locale is resolved ONCE at startup from the phone's system language
 *   (expo-localization). zh-Hans is the primary, fully-translated pack;
 *   everything non-Chinese falls back to English.
 * - t(key, params?) looks up the key in the current pack with per-key
 *   English fallback. Supports {name} interpolation via params.
 * - useStrings() is the React hook version (stable reference).
 *
 * Rule: no hardcoded user-facing strings anywhere. Add keys to zh-Hans.ts
 * (complete Chinese) and en.ts (same keys), then t("your.key").
 */

import { useMemo } from "react";
import { enStrings } from "./en";
import { type AppLocale, resolveLocale } from "./locale";
import { type StringKey, zhHansStrings } from "./zh-Hans";

export type { AppLocale, StringKey };

const packs = { "zh-Hans": zhHansStrings, en: enStrings } as const;

function detectLocale(): AppLocale {
  try {
    // Guarded require: expo-localization pulls in react-native, which plain
    // node test runners cannot transform. In that environment the require
    // throws and we fall back to English; on device it loads normally.
    const { getLocales } = require("expo-localization") as {
      getLocales: () => Array<{ languageTag?: string }>;
    };
    const tag = getLocales()[0]?.languageTag;
    return resolveLocale(tag);
  } catch {
    return "en";
  }
}

const currentLocale: AppLocale = detectLocale();

export function getLocale(): AppLocale {
  return currentLocale;
}

export function t(key: StringKey, params?: Record<string, string | number>): string {
  const pack = packs[currentLocale];
  let text: string = pack[key] ?? enStrings[key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      // Replacer function: param values may contain $& / $' / $` sequences,
      // which a plain string replacement would interpret specially.
      text = text.replaceAll(`{${name}}`, () => String(value));
    }
  }
  return text;
}

export function useStrings(): { t: typeof t; locale: AppLocale } {
  return useMemo(() => ({ t, locale: currentLocale }), []);
}
