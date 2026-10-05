/**
 * Pure locale resolution (no native dependencies — safe to unit test under node).
 *
 * Policy: the app follows the phone's system language.
 * - zh-Hant, zh-TW, zh-HK -> Traditional Chinese (zh-Hant)
 * - Other Chinese variants (zh, zh-Hans, zh-CN, ...) -> Simplified (zh-Hans)
 * - Everything else falls back to English ("graceful degradation").
 */
export type AppLocale = "zh-Hans" | "zh-Hant" | "en";

export function resolveLocale(languageTag: string | undefined | null): AppLocale {
  if (!languageTag) return "en";
  const tag = languageTag.trim().toLowerCase();
  if (tag === "zh-hant" || tag === "zh-tw" || tag === "zh-hk" || tag === "zh-mo") return "zh-Hant";
  if (tag === "zh" || tag.startsWith("zh-") || tag.startsWith("zh_")) return "zh-Hans";
  return "en";
}
