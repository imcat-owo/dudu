/**
 * Theme token foundation — the data model from theme-design.md §2.
 *
 * Hard rule (owner, 2026-10-03): fonts stay OUT of theme bundles.
 * There are no fontFamily / fontSize / fontWeight fields anywhere in this module.
 */

export type SurfaceId =
  | "canvas" // 01 — app background
  | "card" // 02 — cards / panels
  | "input" // 03 — text fields / input bar
  | "userBubble" // 04 — user chat bubble
  | "aiBubble" // 05 — AI chat bubble
  | "accent" // 06 — buttons / links / highlights
  | "text" // 07 — primary & secondary text, dividers
  | "overlay"; // 08 — modals / drawers / navigation

/** The 8 themeable surfaces, in the 01–08 numbering from the design doc. */
export const SURFACE_IDS: readonly SurfaceId[] = [
  "canvas",
  "card",
  "input",
  "userBubble",
  "aiBubble",
  "accent",
  "text",
  "overlay",
];

export type SurfaceTokens = {
  /** Background fill, #rrggbb. */
  bg: string;
  /**
   * Foreground (text/icons drawn on bg), #rrggbb.
   * Hard rule: never pure black (#000000) or pure white (#FFFFFF) —
   * derive() clamps every fg to tonal values instead.
   */
  fg: string;
  /** Accent color used inside this surface, #rrggbb. */
  accent: string;
  /** Border / hairline color, #rrggbb. */
  border?: string;
  /** Corner radius in px. */
  radius?: number;
  /** Wallpaper dim factor 0–1 (used by overlay scrims). */
  dim?: number;
};

export type ThemeMode = "light" | "dark" | "system";

export type ThemeSeed = {
  /** Primary seed color, #rrggbb. */
  primary: string;
  secondary?: string;
  tertiary?: string;
};

export type ThemeBundle = {
  kind: "dudu-theme-bundle";
  version: 1;
  id: string;
  /**
   * Display name. For built-in presets this is an i18n key ("theme.preset.*"),
   * resolved via t() at render time — never a hardcoded user-facing string.
   */
  name: string;
  author?: string;
  seed: ThemeSeed;
  mode: ThemeMode;
  surfaces: Record<SurfaceId, SurfaceTokens>;
  wallpaper?: { uri: string; fit: "cover" | "contain"; dim: number };
  /**
   * Avatar images (URIs) plus the avatar diameter in pt.
   * Design §9: avatar shape/size are theme tokens, never hardcoded.
   * size defaults to 30pt when unset (see ChatAvatar).
   */
  avatar?: { user?: string; assistant?: string; size?: number };
  /** Restricted theme-CSS text (creative mode). */
  css?: string;
  meta: { createdAt: string; updatedAt: string; label?: string };
};

const HEX6_RE = /^#[0-9a-fA-F]{6}$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isHex6(v: unknown): v is string {
  return typeof v === "string" && HEX6_RE.test(v);
}

function isOptHex6(v: unknown): boolean {
  return v === undefined || isHex6(v);
}

function isOptNumber(v: unknown): boolean {
  return v === undefined || typeof v === "number";
}

function isSurfaceTokens(v: unknown): v is SurfaceTokens {
  if (!isObject(v)) return false;
  if (!isHex6(v.bg) || !isHex6(v.fg) || !isHex6(v.accent)) return false;
  if (!isOptHex6(v.border) || !isOptNumber(v.radius)) return false;
  if (v.dim !== undefined && (typeof v.dim !== "number" || v.dim < 0 || v.dim > 1)) {
    return false;
  }
  return true;
}

/**
 * Runtime guard: unknown JSON -> ThemeBundle.
 * Used for stored-bundle self-heal (never blank screen) and preset validation.
 */
export function isThemeBundle(v: unknown): v is ThemeBundle {
  if (!isObject(v)) return false;
  if (v.kind !== "dudu-theme-bundle" || v.version !== 1) return false;
  if (!isNonEmptyString(v.id) || !isNonEmptyString(v.name)) return false;
  if (v.author !== undefined && typeof v.author !== "string") return false;
  if (v.mode !== "light" && v.mode !== "dark" && v.mode !== "system") return false;

  if (!isObject(v.seed) || !isHex6(v.seed.primary)) return false;
  if (!isOptHex6(v.seed.secondary) || !isOptHex6(v.seed.tertiary)) return false;

  if (!isObject(v.surfaces)) return false;
  for (const id of SURFACE_IDS) {
    if (!isSurfaceTokens((v.surfaces as Record<string, unknown>)[id])) return false;
  }

  if (v.wallpaper !== undefined) {
    const w = v.wallpaper;
    if (!isObject(w) || !isNonEmptyString(w.uri)) return false;
    if (w.fit !== "cover" && w.fit !== "contain") return false;
    if (typeof w.dim !== "number" || w.dim < 0 || w.dim > 1) return false;
  }
  if (v.avatar !== undefined) {
    const a = v.avatar;
    if (!isObject(a)) return false;
    if (a.user !== undefined && typeof a.user !== "string") return false;
    if (a.assistant !== undefined && typeof a.assistant !== "string") return false;
    if (
      a.size !== undefined &&
      (typeof a.size !== "number" || !(a.size >= 12 && a.size <= 96))
    )
      return false;
  }
  if (v.css !== undefined && typeof v.css !== "string") return false;

  if (!isObject(v.meta)) return false;
  if (!isNonEmptyString(v.meta.createdAt) || !isNonEmptyString(v.meta.updatedAt)) return false;
  if (v.meta.label !== undefined && typeof v.meta.label !== "string") return false;

  return true;
}
