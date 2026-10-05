/**
 * Crash-screen palette — theme-independent, import-safe anywhere.
 *
 * Same pattern as brand.ts: the error boundary deliberately does NOT read
 * the theme provider (if the theme system is what crashed, depending on it
 * would blank the fallback too), so the fallback palette lives here as a
 * static light/dark token set instead of inline hex literals. The colors
 * follow the resolved OS color scheme via useColorScheme().
 */

export const CRASH_PALETTE = {
  light: {
    bg: "#F6F4F1",
    fg: "#2B2620",
    muted: "#8A8378",
    iconBg: "#FFFFFF",
    buttonBg: "#2B2620",
    buttonFg: "#F6F4F1",
  },
  dark: {
    bg: "#1C1C1E",
    fg: "#F5F2EC",
    muted: "#A8A29A",
    iconBg: "#2C2C2E",
    buttonBg: "#E8E2D6",
    buttonFg: "#2B2620",
  },
} as const;

export type CrashPalette = (typeof CRASH_PALETTE)[keyof typeof CRASH_PALETTE];
