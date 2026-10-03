/**
 * Pure locale resolution (no native dependencies — safe to unit test under node).
 *
 * Policy: the app follows the phone's system language. All Chinese variants
 * (zh, zh-Hans, zh-Hant, zh-CN, zh-HK, zh-TW, ...) resolve to zh-Hans, which is
 * the primary, fully-translated pack. Every other language falls back to
 * English ("graceful degradation").
 */
export type AppLocale = "zh-Hans" | "en";

export function resolveLocale(languageTag: string | undefined | null): AppLocale {
  if (!languageTag) return "en";
  const tag = languageTag.trim().toLowerCase();
  if (tag === "zh" || tag.startsWith("zh-") || tag.startsWith("zh_")) return "zh-Hans";
  return "en";
}
