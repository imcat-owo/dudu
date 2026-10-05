/**
 * Batch 7 I2 — settings search.
 *
 * Aligned with Kelivo's settings search (lib/features/settings/widgets/
 * settings_search_field.dart, researched 2026-10-05): a search field at the
 * top of the settings screen filters the visible sections.
 *
 * Each section registers a title key + technical keyword aliases
 * (universal terms like "TTS"/"MCP"/"Siri" that need no translation).
 * matchSettingsQuery is pure and unit-tested.
 */

import { createContext, type ReactNode, useContext } from "react";
import { type StringKey, t } from "../i18n";

const SettingsSearchContext = createContext<string>("");

export function useSettingsQuery(): string {
  return useContext(SettingsSearchContext);
}

export function SettingsSearchProvider({
  query,
  children,
}: {
  query: string;
  children: ReactNode;
}) {
  return <SettingsSearchContext.Provider value={query}>{children}</SettingsSearchContext.Provider>;
}

/** Pure: does this section match the query? */
export function matchSettingsQuery(query: string, title: string, keywords: string[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (title.toLowerCase().includes(q)) return true;
  return keywords.some((k) => k.toLowerCase().includes(q) || q.includes(k.toLowerCase()));
}

/**
 * Wrapper: hides the section when it doesn't match the current query.
 * Sections that render nothing anyway (e.g. empty states) stay hidden-safe.
 */
export function SearchableSection({
  titleKey,
  keywords,
  children,
}: {
  titleKey: StringKey;
  keywords: string[];
  children: ReactNode;
}) {
  const query = useSettingsQuery();
  if (!matchSettingsQuery(query, t(titleKey), keywords)) return null;
  return <>{children}</>;
}
