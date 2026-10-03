/**
 * Restricted theme-CSS (theme-design.md §3/§4).
 *
 * Creative-mode CSS may ONLY override tokens on the 8 surfaces — layout,
 * interaction and business logic are not in the AI's writable range.
 * The accepted language is a tiny subset:
 *
 *   .surface-card { bg: #ffffff; radius: 20; }
 *   .surface-accent { bg: #ff0000; fg: #ffffff; }
 *
 * Allowed selectors: .surface-<SurfaceId> for the 8 ids.
 * Allowed properties: bg, fg, accent, border (hex), radius (number),
 * dim (0..1).
 *
 * Anything else (at-rules, url(), <script, unbalanced braces, unknown
 * selectors/properties, bad values) is rejected with a line number,
 * mirroring theme-design.md §4 ("CSS 解析失败 → 拒绝，把错位行号原样回给 AI").
 */

import { SURFACE_IDS, type SurfaceId, type SurfaceTokens } from "./types.ts";

const ALLOWED_PROPS = new Set(["bg", "fg", "accent", "border", "radius", "dim"]);
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const BLOCKED_RE = /@import|url\s*\(|expression\s*\(|javascript:|behavior\s*:|<script|<\//i;

export type CssOverrides = Partial<Record<SurfaceId, Partial<SurfaceTokens>>>;
export type CssParseResult = { ok: true; overrides: CssOverrides } | { ok: false; error: string };

function lineOf(css: string, index: number): number {
  return css.slice(0, index).split("\n").length;
}

export function parseThemeCss(css: string): CssParseResult {
  if (css.length > 20000) return { ok: false, error: "CSS too long (max 20000 chars)" };
  if (BLOCKED_RE.test(css)) {
    const m = BLOCKED_RE.exec(css);
    return {
      ok: false,
      error: `Blocked construct "${m?.[0]}" at line ${lineOf(css, m?.index ?? 0)} — theme CSS may only override surface tokens`,
    };
  }
  // Strip /* comments */ but keep line numbers.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, (m) => "\n".repeat(m.split("\n").length - 1));
  const overrides: CssOverrides = {};
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  let consumed = 0;
  // biome-ignore lint/suspicious/noAssignInExpressions: intentional loop
  while ((match = ruleRe.exec(stripped)) !== null) {
    consumed += match[0].length;
    const rawSelector = match[1];
    const selector = rawSelector.trim();
    const body = match[2];
    const selMatch = /^\.surface-([a-zA-Z]+)$/.exec(selector);
    const line = lineOf(stripped, match.index + rawSelector.indexOf(selector));
    if (!selMatch || !(SURFACE_IDS as readonly string[]).includes(selMatch[1])) {
      return {
        ok: false,
        error: `Line ${line}: unknown selector "${selector}" — use .surface-<id> with id in ${SURFACE_IDS.join(", ")}`,
      };
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
        return {
          ok: false,
          error: `Line ${line}: unknown property "${prop}" — allowed: bg, fg, accent, border, radius, dim`,
        };
      }
      if (prop === "bg" || prop === "fg" || prop === "accent" || prop === "border") {
        if (!HEX_RE.test(value))
          return { ok: false, error: `Line ${line}: ${prop} must be a #rrggbb hex, got "${value}"` };
        tokens[prop] = value.toLowerCase();
      } else if (prop === "radius") {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0 || n > 64)
          return { ok: false, error: `Line ${line}: radius must be 0..64, got "${value}"` };
        tokens.radius = n;
      } else {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0 || n > 1)
          return { ok: false, error: `Line ${line}: dim must be 0..1, got "${value}"` };
        tokens.dim = n;
      }
    }
    overrides[surface] = { ...overrides[surface], ...tokens };
  }
  // Anything left over that isn't whitespace means unbalanced/garbage input.
  const rest = stripped.replace(ruleRe, "").trim();
  if (rest.length > 0) {
    return { ok: false, error: `Could not parse near "${rest.slice(0, 40)}" — check braces` };
  }
  if (consumed === 0 && stripped.trim().length > 0) {
    return { ok: false, error: "No valid rules found — check braces" };
  }
  return { ok: true, overrides };
}
