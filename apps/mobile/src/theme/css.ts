/**
 * Restricted theme-CSS parser — mobile mirror of apps/server/src/theme/css.ts.
 * Same language, same rejections. Applied as a token-override layer on top
 * of the derived surfaces (creative mode only).
 */

import { SURFACE_IDS, type SurfaceId, type SurfaceTokens } from "./types";

const ALLOWED_PROPS = new Set(["bg", "fg", "accent", "border", "radius", "dim"]);
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const BLOCKED_RE = /@import|url\s*\(|expression\s*\(|javascript:|behavior\s*:|<script|<\//i;

export type CssOverrides = Partial<Record<SurfaceId, Partial<SurfaceTokens>>>;

function lineOf(css: string, index: number): number {
  return css.slice(0, index).split("\n").length;
}

export function parseThemeCss(
  css: string,
): { ok: true; overrides: CssOverrides } | { ok: false; error: string } {
  if (css.length > 20000) return { ok: false, error: "CSS too long (max 20000 chars)" };
  const blocked = BLOCKED_RE.exec(css);
  if (blocked) {
    return {
      ok: false,
      error: `Blocked construct "${blocked[0]}" at line ${lineOf(css, blocked.index)}`,
    };
  }
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, (m) => "\n".repeat(m.split("\n").length - 1));
  const overrides: CssOverrides = {};
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: intentional loop
  while ((match = ruleRe.exec(stripped)) !== null) {
    const rawSelector = match[1];
    const selector = rawSelector.trim();
    const body = match[2];
    const selMatch = /^\.surface-([a-zA-Z]+)$/.exec(selector);
    const line = lineOf(stripped, match.index + rawSelector.indexOf(selector));
    if (!selMatch || !(SURFACE_IDS as readonly string[]).includes(selMatch[1])) {
      return { ok: false, error: `Line ${line}: unknown selector "${selector}"` };
    }
    const surface = selMatch[1] as SurfaceId;
    const tokens: Partial<SurfaceTokens> = {};
    for (const decl of body.split(";")) {
      const trimmed = decl.trim();
      if (!trimmed) continue;
      const colon = trimmed.indexOf(":");
      if (colon < 0) return { ok: false, error: `Line ${line}: bad declaration "${trimmed}"` };
      const prop = trimmed.slice(0, colon).trim();
      const value = trimmed.slice(colon + 1).trim();
      if (!ALLOWED_PROPS.has(prop)) {
        return { ok: false, error: `Line ${line}: unknown property "${prop}"` };
      }
      if (prop === "bg" || prop === "fg" || prop === "accent" || prop === "border") {
        if (!HEX_RE.test(value))
          return { ok: false, error: `Line ${line}: ${prop} must be #rrggbb` };
        tokens[prop] = value.toLowerCase();
      } else {
        const n = Number(value);
        const max = prop === "radius" ? 64 : 1;
        if (!Number.isFinite(n) || n < 0 || n > max)
          return { ok: false, error: `Line ${line}: ${prop} out of range` };
        if (prop === "radius") tokens.radius = n;
        else tokens.dim = n;
      }
    }
    overrides[surface] = { ...overrides[surface], ...tokens };
  }
  const rest = stripped.replace(/([^{}]+)\{([^{}]*)\}/g, "").trim();
  if (rest.length > 0) return { ok: false, error: `Could not parse near "${rest.slice(0, 40)}"` };
  return { ok: true, overrides };
}

/** Merge CSS overrides over derived surfaces; re-clamp fg contrast after. */
export function applyCssOverrides(
  surfaces: Record<SurfaceId, SurfaceTokens>,
  css: string | undefined,
  clampFg: (bg: string, fg: string) => string,
): Record<SurfaceId, SurfaceTokens> {
  if (!css?.trim()) return surfaces;
  const parsed = parseThemeCss(css);
  if (!parsed.ok) return surfaces; // Invalid CSS never applies (server rejects first).
  const out = { ...surfaces };
  for (const id of SURFACE_IDS) {
    const override = parsed.overrides[id];
    if (!override) continue;
    const merged = { ...out[id], ...override };
    merged.fg = clampFg(merged.bg, merged.fg);
    out[id] = merged;
  }
  return out;
}
