/**
 * Server-side theme types — mirrors apps/mobile/src/theme/types.ts.
 * Kept as a separate module (not imported from mobile) so the server
 * build stays decoupled from the mobile bundle. If the mobile model
 * changes, update this file to match.
 */

export type SurfaceId =
  | "canvas"
  | "card"
  | "input"
  | "userBubble"
  | "aiBubble"
  | "accent"
  | "text"
  | "overlay";

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
  bg: string;
  fg: string;
  accent: string;
  border?: string;
  radius?: number;
  dim?: number;
};

export type ThemeMode = "light" | "dark" | "system";

export type ThemeSeed = {
  primary: string;
  secondary?: string;
  tertiary?: string;
};

export type ThemeBundle = {
  kind: "openmuse-theme-bundle";
  version: 1;
  id: string;
  name: string;
  author?: string;
  seed: ThemeSeed;
  mode: ThemeMode;
  surfaces: Record<SurfaceId, SurfaceTokens>;
  wallpaper?: { uri: string; fit: "cover" | "contain"; dim: number };
  avatar?: { user?: string; assistant?: string; size?: number };
  css?: string;
  /** App font-size option the AI set (cloud mode). Phone applies it on adopt. */
  fontSize?: "system" | "small" | "standard" | "large";
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

export function normalizeHex(input: string): string {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(input.trim());
  if (!m) throw new Error(`Invalid hex color: ${input}`);
  const h = m[1].toLowerCase();
  return h.length === 3 ? `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}` : `#${h}`;
}

function isSurfaceTokens(v: unknown): v is SurfaceTokens {
  if (!isObject(v)) return false;
  if (!isHex6(v.bg) || !isHex6(v.fg) || !isHex6(v.accent)) return false;
  if (v.border !== undefined && !isHex6(v.border)) return false;
  if (v.radius !== undefined && typeof v.radius !== "number") return false;
  if (v.dim !== undefined && (typeof v.dim !== "number" || v.dim < 0 || v.dim > 1)) return false;
  return true;
}

export function isThemeBundle(v: unknown): v is ThemeBundle {
  if (!isObject(v)) return false;
  if (v.kind !== "openmuse-theme-bundle" || v.version !== 1) return false;
  if (!isNonEmptyString(v.id) || !isNonEmptyString(v.name)) return false;
  if (!isObject(v.seed) || !isHex6(v.seed.primary)) return false;
  if (!isObject(v.surfaces)) return false;
  for (const id of SURFACE_IDS) {
    if (!isSurfaceTokens((v.surfaces as Record<string, unknown>)[id])) return false;
  }
  if (
    v.fontSize !== undefined &&
    v.fontSize !== "system" &&
    v.fontSize !== "small" &&
    v.fontSize !== "standard" &&
    v.fontSize !== "large"
  )
    return false;
  return true;
}
