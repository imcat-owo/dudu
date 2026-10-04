/**
 * AI 换肤 mode (theme-design.md §3): stable | creative | off.
 *
 * - stable (default): AI sees the theme tools (set_theme, set_wallpaper,
 *   set_ai_avatar) and may adjust colors/wallpaper/avatar on request.
 * - creative: same as stable for now (no CSS-writing tool exists yet —
 *   when one lands it will be gated on this mode).
 * - off: the AI never sees the theme tools at all.
 *
 * PURE module: storage is injectable so this stays unit-testable.
 * Persisted locally (AsyncStorage) — works in local mode, no server needed.
 */

export type AiThemeMode = "stable" | "creative" | "off";

/** Storage key for the AI theme mode. */
export const AI_THEME_MODE_KEY = "dudu.theme.aiMode.v1";

export interface AiModeStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export function isAiThemeMode(v: unknown): v is AiThemeMode {
  return v === "stable" || v === "creative" || v === "off";
}

/** Read the AI theme mode; defaults to "stable" when unset or corrupt. */
export async function getAiThemeMode(storage: AiModeStorage): Promise<AiThemeMode> {
  try {
    const raw = await storage.getItem(AI_THEME_MODE_KEY);
    if (isAiThemeMode(raw)) return raw;
  } catch {
    // Corrupt/unreadable storage: fall back to default.
  }
  return "stable";
}

/** Persist the AI theme mode. */
export async function setAiThemeMode(storage: AiModeStorage, mode: AiThemeMode): Promise<void> {
  await storage.setItem(AI_THEME_MODE_KEY, mode);
}
