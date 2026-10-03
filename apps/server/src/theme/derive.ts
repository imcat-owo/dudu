/**
 * Server-side HCT color derivation — mirrors apps/mobile/src/theme/derive.ts.
 * Same math, same recipes: a seed derived on the server produces byte-identical
 * surfaces to one derived on the client. Kept as a separate module so the
 * server build stays decoupled from the mobile bundle.
 */

import { argbFromHex, Hct, hexFromArgb, TonalPalette } from "@material/material-color-utilities";
import { normalizeHex, type SurfaceId, type SurfaceTokens, type ThemeBundle, type ThemeSeed } from "./types.ts";

export type ResolvedMode = "light" | "dark";

const MIN_TONE = 3;
const MAX_TONE = 97;
const MIN_CONTRAST = 4.5;

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 0xff) + 0.7152 * channel((n >> 8) & 0xff) + 0.0722 * channel(n & 0xff);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function clampFg(bg: string, fg: string): string {
  const base = Hct.fromInt(argbFromHex(normalizeHex(fg)));
  const startTone = Math.min(MAX_TONE, Math.max(MIN_TONE, base.tone));
  const darken = startTone < 50;
  let tone = startTone;
  for (let i = 0; i < 48; i++) {
    const candidate = hexFromArgb(Hct.from(base.hue, base.chroma, tone).toInt());
    if (contrastRatio(bg, candidate) >= MIN_CONTRAST) return candidate;
    tone = darken ? tone - 2 : tone + 2;
    if (tone <= MIN_TONE || tone >= MAX_TONE) break;
  }
  const finalTone = darken ? MIN_TONE : MAX_TONE;
  return hexFromArgb(Hct.from(base.hue, base.chroma, finalTone).toInt());
}

type Palettes = {
  primary: TonalPalette;
  secondary: TonalPalette;
  tertiary: TonalPalette;
  neutral: TonalPalette;
};

function buildPalettes(seed: ThemeSeed): Palettes {
  const primaryHex = normalizeHex(seed.primary);
  const primary = TonalPalette.fromInt(argbFromHex(primaryHex));
  const base = Hct.fromInt(argbFromHex(primaryHex));
  const achromatic = base.chroma < 8;
  const rotated = (degrees: number, chromaScale: number): TonalPalette => {
    if (achromatic) return primary;
    const hue = (((base.hue + degrees) % 360) + 360) % 360;
    return TonalPalette.fromHueAndChroma(hue, Math.max(6, base.chroma * chromaScale));
  };
  const fromSeed = (hex: string | undefined, fallback: TonalPalette): TonalPalette =>
    hex === undefined ? fallback : TonalPalette.fromInt(argbFromHex(normalizeHex(hex)));
  return {
    primary,
    secondary: fromSeed(seed.secondary, rotated(60, 0.66)),
    tertiary: fromSeed(seed.tertiary, rotated(120, 0.8)),
    neutral: achromatic
      ? TonalPalette.fromHueAndChroma(0, 0)
      : TonalPalette.fromHueAndChroma(base.hue, Math.min(6, base.chroma / 12)),
  };
}

type ToneRef = { p: keyof Palettes; t: number };
type SurfaceRecipe = {
  bg: ToneRef;
  fg: ToneRef;
  accent: ToneRef;
  border?: ToneRef;
  radius?: number;
  dim?: number;
};

const LIGHT_RECIPES: Record<SurfaceId, SurfaceRecipe> = {
  canvas: { bg: { p: "neutral", t: 99 }, fg: { p: "neutral", t: 10 }, accent: { p: "primary", t: 40 }, border: { p: "neutral", t: 90 }, radius: 16, dim: 0 },
  card: { bg: { p: "neutral", t: 95 }, fg: { p: "neutral", t: 10 }, accent: { p: "primary", t: 40 }, border: { p: "neutral", t: 90 }, radius: 16 },
  input: { bg: { p: "neutral", t: 93 }, fg: { p: "neutral", t: 10 }, accent: { p: "primary", t: 40 }, border: { p: "neutral", t: 82 }, radius: 20 },
  userBubble: { bg: { p: "primary", t: 70 }, fg: { p: "primary", t: 10 }, accent: { p: "primary", t: 40 }, border: { p: "primary", t: 60 }, radius: 18 },
  aiBubble: { bg: { p: "neutral", t: 90 }, fg: { p: "neutral", t: 10 }, accent: { p: "secondary", t: 40 }, border: { p: "neutral", t: 80 }, radius: 18 },
  accent: { bg: { p: "primary", t: 40 }, fg: { p: "primary", t: 95 }, accent: { p: "tertiary", t: 55 }, radius: 12 },
  text: { bg: { p: "neutral", t: 99 }, fg: { p: "neutral", t: 10 }, accent: { p: "neutral", t: 45 }, border: { p: "neutral", t: 85 } },
  overlay: { bg: { p: "neutral", t: 98 }, fg: { p: "neutral", t: 10 }, accent: { p: "primary", t: 40 }, border: { p: "neutral", t: 85 }, radius: 24, dim: 0.5 },
};

const DARK_RECIPES: Record<SurfaceId, SurfaceRecipe> = {
  canvas: { bg: { p: "neutral", t: 6 }, fg: { p: "neutral", t: 90 }, accent: { p: "primary", t: 80 }, border: { p: "neutral", t: 22 }, radius: 16, dim: 0 },
  card: { bg: { p: "neutral", t: 12 }, fg: { p: "neutral", t: 90 }, accent: { p: "primary", t: 80 }, border: { p: "neutral", t: 22 }, radius: 16 },
  input: { bg: { p: "neutral", t: 16 }, fg: { p: "neutral", t: 90 }, accent: { p: "primary", t: 80 }, border: { p: "neutral", t: 28 }, radius: 20 },
  userBubble: { bg: { p: "primary", t: 65 }, fg: { p: "primary", t: 12 }, accent: { p: "primary", t: 80 }, border: { p: "primary", t: 50 }, radius: 18 },
  aiBubble: { bg: { p: "neutral", t: 22 }, fg: { p: "neutral", t: 90 }, accent: { p: "secondary", t: 80 }, border: { p: "neutral", t: 28 }, radius: 18 },
  accent: { bg: { p: "primary", t: 80 }, fg: { p: "primary", t: 20 }, accent: { p: "tertiary", t: 70 }, radius: 12 },
  text: { bg: { p: "neutral", t: 6 }, fg: { p: "neutral", t: 90 }, accent: { p: "neutral", t: 60 }, border: { p: "neutral", t: 28 } },
  overlay: { bg: { p: "neutral", t: 14 }, fg: { p: "neutral", t: 90 }, accent: { p: "primary", t: 80 }, border: { p: "neutral", t: 28 }, radius: 24, dim: 0.55 },
};

export function deriveSurfaces(seed: ThemeSeed, mode: ResolvedMode): Record<SurfaceId, SurfaceTokens> {
  const palettes = buildPalettes(seed);
  const recipes = mode === "dark" ? DARK_RECIPES : LIGHT_RECIPES;
  const toneOf = (ref: ToneRef): string => hexFromArgb(palettes[ref.p].tone(ref.t));
  const out = {} as Record<SurfaceId, SurfaceTokens>;
  for (const id of Object.keys(recipes) as SurfaceId[]) {
    const r = recipes[id];
    const bg = toneOf(r.bg);
    const tokens: SurfaceTokens = { bg, fg: clampFg(bg, toneOf(r.fg)), accent: toneOf(r.accent) };
    if (r.border) tokens.border = toneOf(r.border);
    if (r.radius !== undefined) tokens.radius = r.radius;
    if (r.dim !== undefined) tokens.dim = r.dim;
    out[id] = tokens;
  }
  return out;
}

/**
 * Shift a seed hex along the emotion/meaning axes (theme-design.md §3).
 * emotion -5..5: cool→warm (hue rotate ±15°, chroma nudge).
 * meaning -5..5: muted→vivid (chroma scale).
 */
export function shiftSeed(hex: string, emotion: number, meaning: number): string {
  const hct = Hct.fromInt(argbFromHex(normalizeHex(hex)));
  const hue = (((hct.hue + emotion * 3) % 360) + 360) % 360;
  const chroma = Math.max(4, hct.chroma * (1 + emotion * 0.04 + meaning * 0.05));
  return hexFromArgb(Hct.from(hue, chroma, hct.tone).toInt());
}

export type NewBundleOptions = {  id: string;
  name: string;
  seed: ThemeSeed;
  mode: ThemeBundle["mode"];
  author?: string;
  label?: string;
  wallpaper?: ThemeBundle["wallpaper"];
  avatar?: ThemeBundle["avatar"];
  css?: string;
};

export function makeThemeBundle(opts: NewBundleOptions): ThemeBundle {
  const now = new Date().toISOString();
  const resolved: ResolvedMode = opts.mode === "dark" ? "dark" : "light";
  return {
    kind: "openmuse-theme-bundle",
    version: 1,
    id: opts.id,
    name: opts.name,
    ...(opts.author ? { author: opts.author } : {}),
    seed: {
      primary: normalizeHex(opts.seed.primary),
      ...(opts.seed.secondary ? { secondary: normalizeHex(opts.seed.secondary) } : {}),
      ...(opts.seed.tertiary ? { tertiary: normalizeHex(opts.seed.tertiary) } : {}),
    },
    mode: opts.mode,
    surfaces: deriveSurfaces(opts.seed, resolved),
    ...(opts.wallpaper ? { wallpaper: opts.wallpaper } : {}),
    ...(opts.avatar ? { avatar: opts.avatar } : {}),
    ...(opts.css ? { css: opts.css } : {}),
    meta: { createdAt: now, updatedAt: now, ...(opts.label ? { label: opts.label } : {}) },
  };
}
