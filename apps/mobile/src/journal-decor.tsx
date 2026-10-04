/**
 * 手帐风小装饰 (Journal decorations) — washi tape, paper grain, handwriting text.
 *
 * Tasteful, cheap, zero-emoji:
 * - WashiTape: rotated semi-transparent strip with dashed "torn" edges.
 * - PaperGrain: faint dot-grid SVG overlay that reads as paper fiber.
 * - HandText: heading text with a slight hand-placed tilt. Automatically uses
 *   the user's uploaded font (via TText) when one is set — upload a
 *   handwriting font in settings for the full effect.
 */

import { useMemo, useRef } from "react";
import { StyleSheet, type TextProps, View, type ViewStyle } from "react-native";
import Svg, { Circle, Defs, Pattern, Rect } from "react-native-svg";
import { TText } from "./font";
import { shadows } from "./theme/shadows";
import { useColors } from "./ui";

let grainCounter = 0;

/**
 * Faint dot-grid overlay that gives a card a paper feel.
 * Absolutely positioned — parent must be position:relative (RN default).
 */
export function PaperGrain({ opacity = 0.5 }: { opacity?: number }) {
  const colors = useColors();
  const pid = useRef(`grain-${++grainCounter}`).current;
  // Dot color follows theme just enough to stay visible on card bg.
  const dot = colors.muted;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]} aria-hidden>
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id={pid} width={14} height={14} patternUnits="userSpaceOnUse">
            <Circle cx={2.5} cy={2.5} r={0.9} fill={dot} opacity={0.16} />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${pid})`} />
      </Svg>
    </View>
  );
}

/** Pastel washi tape colors. Keep muted — tape is decoration, not the star. */
export const TAPE_COLORS = {
  pink: "#f4a7b9",
  blue: "#9cc5e8",
  mint: "#a8d8b9",
  yellow: "#f6d998",
  lavender: "#c3b2e0",
} as const;

export type TapeColor = keyof typeof TAPE_COLORS;

/**
 * A strip of washi tape. Position it absolutely over a card corner, e.g.
 *   <WashiTape color="pink" style={{ top: -10, left: 24 }} rotate={-8} />
 */
export function WashiTape({
  color,
  rotate = -6,
  style,
  width = 84,
}: {
  color: TapeColor;
  rotate?: number;
  style?: ViewStyle;
  width?: number;
}) {
  const tapeStyle = useMemo<ViewStyle>(
    () => ({
      position: "absolute",
      width,
      height: 26,
      backgroundColor: TAPE_COLORS[color],
      opacity: 0.62,
      borderRadius: 2,
      transform: [{ rotate: `${rotate}deg` }],
      // Dashed light edges read as torn tape.
      borderTopWidth: 1.5,
      borderBottomWidth: 1.5,
      borderTopColor: "rgba(255,255,255,0.65)",
      borderBottomColor: "rgba(255,255,255,0.65)",
      borderStyle: "dashed",
      // Soft shadow so it sits "on" the paper (tiered card shadow).
      ...shadows.card,
    }),
    [color, rotate, width],
  );
  return <View pointerEvents="none" style={[tapeStyle, style]} aria-hidden />;
}

/**
 * Heading text with a hand-placed feel: slight tilt, relaxed spacing.
 * Uses the user's uploaded font automatically (TText). Keep it to short
 * titles — long body text stays straight for readability.
 */
export function HandText(props: TextProps) {
  const { style, ...rest } = props;
  return (
    <TText
      {...rest}
      style={[
        {
          transform: [{ rotate: "-0.8deg" }],
          letterSpacing: 0.6,
        },
        style,
      ]}
    />
  );
}
