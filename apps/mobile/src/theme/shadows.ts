/**
 * Tasteful shadow presets (iOS shadow props + Android elevation).
 *
 * Keep usage restrained: cards, modals/sheets, and floating elements only.
 * shadowColor stays neutral black at low opacity — it reads as depth,
 * not as a color, in both light and dark mode.
 */
import type { ViewStyle } from "react-native";

const base = (opacity: number, radius: number, height: number, elevation: number): ViewStyle => ({
  shadowColor: "#000",
  shadowOpacity: opacity,
  shadowRadius: radius,
  shadowOffset: { width: 0, height },
  elevation,
});

export const shadows = {
  /** Cards, list rows, task cards. */
  card: base(0.08, 12, 4, 3),
  /** Modals, sheets, dialogs. */
  modal: base(0.16, 24, 12, 8),
  /** Floating elements: tab bar, input bar, FABs. */
  float: base(0.12, 20, 8, 6),
} as const;

export type ShadowTier = keyof typeof shadows;
