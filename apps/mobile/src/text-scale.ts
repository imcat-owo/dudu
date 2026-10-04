/**
 * Text-size scaling — PURE module, no React Native imports (tsx-safe).
 *
 * TText (font.tsx) is the SINGLE place the user's font-size setting takes
 * effect: the shared stylesheet and all component styles carry BASE sizes,
 * and TText scales fontSize/lineHeight exactly once at render time via
 * scaleTextStyle. Do NOT pre-scale anywhere else.
 */
import type { TextStyle } from "react-native";

/**
 * Scale a flattened text style by the font-size setting multiplier.
 * fontSize and lineHeight scale together so text never clips; anything
 * else passes through untouched. A scale of 1 is a no-op (same reference).
 */
export function scaleTextStyle(
  style: TextStyle | null | undefined,
  scale: number,
): TextStyle | null | undefined {
  if (!style || scale === 1) return style;
  const out: TextStyle = { ...style };
  if (typeof out.fontSize === "number") {
    out.fontSize = Math.round(out.fontSize * scale * 10) / 10;
  }
  if (typeof out.lineHeight === "number") {
    out.lineHeight = Math.round(out.lineHeight * scale * 10) / 10;
  }
  return out;
}
