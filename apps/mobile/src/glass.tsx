import { BlurView } from "expo-blur";
import type { ReactNode } from "react";
import { type StyleProp, StyleSheet, View, type ViewProps, type ViewStyle } from "react-native";
import { useTheme } from "./theme/ThemeContext";

/**
 * GlassView — Liquid Glass surface for iOS 26.
 *
 * Native (iOS/Android): real gaussian blur via expo-blur, tint follows the
 * resolved theme mode. Web: expo-blur renders backdrop-filter CSS.
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
  const { resolvedMode } = useTheme();
  const dark = resolvedMode === "dark";
  const rim = edgeColor ?? (dark ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.55)");
  const flat = StyleSheet.flatten(style) ?? {};
  const radius = borderRadius ?? (typeof flat.borderRadius === "number" ? flat.borderRadius : 0);
  return (
    <View style={[{ overflow: "hidden" }, style]} {...rest}>
      <BlurView
        intensity={intensity}
        tint={dark ? "dark" : "light"}
        style={StyleSheet.absoluteFill}
      />
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
