import { BlurView } from "expo-blur";
import type { ReactNode } from "react";
import { type StyleProp, StyleSheet, View, type ViewProps, type ViewStyle } from "react-native";
import { useReduceTransparency } from "./accessibility";
import { radii } from "./theme/radii";
import { useTheme } from "./theme/ThemeContext";

/**
 * Pure decision for the glass fill, extracted for testing.
 *
 * Returns the solid theme-token background to use when the OS
 * reduce-transparency switch is on, or null when the blur should render.
 * The solid fallback comes from the theme's "overlay" surface (08 —
 * modals / drawers / navigation), never a hardcoded grey.
 */
export function resolveGlassFill(
  reduceTransparency: boolean,
  overlayBg: string,
): { kind: "solid"; backgroundColor: string } | { kind: "blur" } {
  if (reduceTransparency) return { kind: "solid", backgroundColor: overlayBg };
  return { kind: "blur" };
}

/**
 * GlassView — Liquid Glass surface for iOS 26.
 *
 * Native (iOS/Android): real gaussian blur via expo-blur, tint follows the
 * resolved theme mode. Web: expo-blur renders backdrop-filter CSS.
 *
 * System settings (owner rule, 2026-10-05): appearance follows iOS — nothing
 * hardcoded. iOS exposes no API for a user-adjustable glass clarity level,
 * so `intensity` stays a shipped default; the Reduce Transparency
 * accessibility switch IS honored — when on, the blur is replaced with the
 * solid overlay surface from the theme tokens (still looks right, no grey
 * boxes). The hairline edge highlight is kept in both modes: it is a 1px
 * border, not a translucency effect.
 *
 * The hairline edge highlight gives the "liquid" rim: bright on top/left,
 * fading into the blur. Keep usage tasteful — floating bars, sheets, cards.
 */
export function GlassView({
  children,
  style,
  intensity = 48,
  edgeColor,
  borderRadius,
  ...rest
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Blur strength, 0-100. Default 48 reads as frosted glass. */
  intensity?: number;
  /** Override the glass rim color (e.g. focus ring). */
  edgeColor?: string;
  /** Corner radius. Falls back to style.borderRadius when style is a plain object. */
  borderRadius?: number;
} & Omit<ViewProps, "style">) {
  const { resolvedMode, tokens } = useTheme();
  const reduceTransparency = useReduceTransparency();
  const dark = resolvedMode === "dark";
  const rim = edgeColor ?? (dark ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.55)");
  const flat = StyleSheet.flatten(style) ?? {};
  const radius =
    borderRadius ?? (typeof flat.borderRadius === "number" ? flat.borderRadius : radii.xs);
  const fill = resolveGlassFill(reduceTransparency, tokens.overlay.bg);
  return (
    <View style={[{ overflow: "hidden" }, style]} {...rest}>
      {fill.kind === "solid" ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: fill.backgroundColor }]} />
      ) : (
        <BlurView
          intensity={intensity}
          tint={dark ? "dark" : "light"}
          style={StyleSheet.absoluteFill}
        />
      )}
      {/* Specular top sheen — the liquid-glass highlight. */}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: radius,
            borderWidth: 1,
            borderColor: rim,
          },
        ]}
      />
      {children}
    </View>
  );
}
