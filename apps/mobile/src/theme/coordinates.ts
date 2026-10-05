/**
 * 稳态四轴 (stable four-axis) theme coordinates — Polaris's "AI-understandable
 * theme language", adapted for the HCT derivation engine in derive.ts.
 *
 * Four axes:
 * - hue: main color tendency — a feeling word ("粉嫩", "薄荷", "mint"...)
 *   or a direct #rrggbb hex.
 * - hueCount (1-5): color complexity. 1 = monochrome anchor, higher = richer.
 * - emotion (-5..5): emotional intensity. Positive = warm/bold, negative =
 *   calm/muted. Out-of-range values are clamped, never rejected.
 * - meaning (-5..5): presence direction. Negative = atmosphere (air/light/
 *   mist), positive = material (paper/cloth/coating).
 *
 * PURE module: no React Native imports. HCT math via
 * @material/material-color-utilities (same engine as derive.ts).
 */

import { argbFromHex, Hct, hexFromArgb } from "@material/material-color-utilities";
import { ToolError } from "../api-groups/local-tools";
import { normalizeHex } from "./derive";
import type { ThemeSeed } from "./types";

/** Feeling word (Chinese or English, lowercased for lookup) -> seed hex. */
const FEELING_HUES: Record<string, string> = {
  // pinks
  粉嫩: "#f4a7c3",
  粉色: "#f4a7c3",
  粉: "#f4a7c3",
  pink: "#f4a7c3",
  樱花粉: "#f8b4d0",
  樱花: "#f8b4d0",
  sakura: "#f8b4d0",
  少女粉: "#f9a8d4",
  // peach / orange
  晚霞: "#f9a875",
  晚霞粉: "#f6a5a5",
  蜜桃: "#f9b08c",
  桃色: "#f9b08c",
  peach: "#f9b08c",
  橙色: "#f6ad55",
  橙: "#f6ad55",
  orange: "#f6ad55",
  // greens
  薄荷: "#7fe0b8",
  薄荷绿: "#7fe0b8",
  青绿: "#7fe0b8",
  mint: "#7fe0b8",
  抹茶: "#a8d5a2",
  抹茶绿: "#a8d5a2",
  草绿: "#9ae6a0",
  绿色: "#86d68a",
  绿: "#86d68a",
  green: "#86d68a",
  // blues
  天空蓝: "#8ecae6",
  天空: "#8ecae6",
  蓝色: "#7fb8e8",
  蓝: "#7fb8e8",
  blue: "#7fb8e8",
  sky: "#8ecae6",
  海洋: "#5b9bd5",
  深海: "#4a7fb5",
  海蓝: "#5b9bd5",
  ocean: "#5b9bd5",
  雾蓝: "#93a8b8",
  灰蓝: "#93a8b8",
  青瓷: "#8fc7c0",
  青色: "#8fc7c0",
  teal: "#8fc7c0",
  // purples
  薰衣草: "#b8a9e0",
  淡紫: "#c4b5fd",
  紫色: "#b39ddb",
  紫: "#b39ddb",
  purple: "#b39ddb",
  lavender: "#b8a9e0",
  葡萄紫: "#9d7bd8",
  // yellows
  柠檬: "#f5d67b",
  柠檬黄: "#f5d67b",
  黄色: "#f0d060",
  黄: "#f0d060",
  yellow: "#f0d060",
  lemon: "#f5d67b",
  鹅黄: "#f7e08b",
  // reds
  玫瑰: "#e08a9b",
  玫瑰红: "#e08a9b",
  红色: "#e0707f",
  红: "#e0707f",
  red: "#e0707f",
  rose: "#e08a9b",
  樱桃红: "#d86a7a",
  // neutrals
  穹妹灰: "#aaa7aa",
  灰色: "#9aa0a6",
  灰: "#9aa0a6",
  gray: "#9aa0a6",
  grey: "#9aa0a6",
  雾灰: "#b0b5ba",
  石墨: "#6e6e73",
  深灰: "#6e6e73",
  奶油: "#e8dcc8",
  米色: "#e8dcc8",
  燕麦: "#ddd0b8",
  cream: "#e8dcc8",
  beige: "#e8dcc8",
  墨色: "#4a4a4e",
  黑: "#3a3a3e",
  black: "#3a3a3e",
  白色: "#f5f5f4",
  白: "#f5f5f4",
  white: "#f5f5f4",
};

/** All known feeling words (for error messages and UI hints). */
export function listFeelingWords(): string[] {
  return Object.keys(FEELING_HUES);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Resolve a hue argument to a #rrggbb hex.
 * Accepts a direct hex ("#f4a7c3", "f4a7c3", "#abc") or a feeling word.
 * Throws ToolError on unknown words (never silently substitutes).
 */
export function resolveHue(hue: string): string {
  const raw = hue.trim();
  if (!raw) throw new ToolError("hue is required.");
  // Direct hex passthrough.
  if (/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw)) {
    return normalizeHex(raw);
  }
  const hit = FEELING_HUES[raw] ?? FEELING_HUES[raw.toLowerCase()];
  if (!hit) {
    throw new ToolError(
      `Unknown hue "${raw}". Use a #rrggbb hex or one of: ${Object.keys(FEELING_HUES).join(", ")}.`,
    );
  }
  return hit;
}

export interface ThemeCoordinates {
  hue: string;
  hueCount?: number;
  emotion?: number;
  meaning?: number;
}

function rotateHue(hex: string, degrees: number): string {
  const hct = Hct.fromInt(argbFromHex(hex));
  const hue = (((hct.hue + degrees) % 360) + 360) % 360;
  return hexFromArgb(Hct.from(hue, hct.chroma, hct.tone).toInt());
}

/**
 * Convert four-axis coordinates to a ThemeSeed.
 * Out-of-range numbers are clamped (Polaris behavior: "超出范围也没关系，
 * 系统会自动夹到边界"). Achromatic hues stay achromatic — no invented color.
 */
export function coordinatesToSeed(c: ThemeCoordinates): ThemeSeed {
  const primaryHex = resolveHue(c.hue);
  const hueCount = clamp(Math.round(c.hueCount ?? 3), 1, 5);
  const emotion = clamp(c.emotion ?? 0, -5, 5);
  const meaning = clamp(c.meaning ?? 0, -5, 5);

  const base = Hct.fromInt(argbFromHex(primaryHex));
  const achromatic = base.chroma < 8;

  // emotion: chroma intensity. meaning: atmosphere (-) vs material (+).
  const chroma = achromatic
    ? base.chroma
    : Math.max(4, base.chroma * (1 + emotion * 0.07) * (1 + meaning * 0.05));
  const tone = clamp(base.tone - meaning * 1.2, 5, 95);
  const primary = hexFromArgb(Hct.from(base.hue, chroma, tone).toInt());

  if (achromatic || hueCount === 1) {
    // Monochrome anchor: no invented hues.
    return { primary };
  }
  const spread = hueCount - 1;
  const secondary = rotateHue(primary, spread * 28);
  const tertiary = rotateHue(primary, -spread * 48);
  return { primary, secondary, tertiary };
}
