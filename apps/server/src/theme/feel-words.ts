/**
 * Feel-word → hex mapping for apply_theme_coordinates (theme-design.md §3).
 * The AI accepts natural language ("薄荷偏青绿", "minty teal") or a hex
 * code; unknown words fall back to the current seed primary.
 * Out-of-range axis values are clamped (Polaris behavior).
 */

const FEEL_WORDS: Record<string, string> = {
  // Chinese
  薄荷: "#3f9b8a",
  青绿: "#3f9b8a",
  晚霞: "#cf6a4d",
  橙粉: "#cf6a4d",
  樱花: "#b98aa5",
  粉: "#c95a7a",
  薰衣草: "#9b8afb",
  紫: "#7a6ff0",
  海洋: "#5b9bd5",
  蓝: "#5b9bd5",
  天空: "#5aa9c9",
  森林: "#4d9b7a",
  绿: "#8fbf6a",
  柠檬: "#e0a458",
  黄: "#e0a458",
  墨: "#3a3f4a",
  灰: "#6b7280",
  奶油: "#e8ddc4",
  米白: "#f0ebe0",
  穹妹灰: "#aaa7aa",
  // English
  mint: "#3f9b8a",
  teal: "#3f9b8a",
  sunset: "#cf6a4d",
  peach: "#e0a458",
  sakura: "#b98aa5",
  pink: "#c95a7a",
  lavender: "#9b8afb",
  purple: "#7a6ff0",
  ocean: "#5b9bd5",
  blue: "#5b9bd5",
  sky: "#5aa9c9",
  forest: "#4d9b7a",
  green: "#8fbf6a",
  lemon: "#e0a458",
  yellow: "#e0a458",
  ink: "#3a3f4a",
  gray: "#6b7280",
  grey: "#6b7280",
  cream: "#e8ddc4",
};

/**
 * Resolve a hue input (feel-word or hex) to a #rrggbb hex.
 * Returns null when the input matches nothing — the caller then keeps
 * the current seed.
 */
export function feelWordToHex(input: string): string | null {
  const trimmed = input.trim();
  // Hex first: #abc, abc, #aabbcc, aabbcc.
  const hexMatch = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(trimmed);
  if (hexMatch) {
    const h = hexMatch[1].toLowerCase();
    return h.length === 3 ? `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}` : `#${h}`;
  }
  // Substring match against feel-words (handles "薄荷偏青绿", "minty teal").
  const lower = trimmed.toLowerCase();
  for (const [word, hex] of Object.entries(FEEL_WORDS)) {
    if (lower.includes(word.toLowerCase())) return hex;
  }
  return null;
}

/** Clamp an axis value to [-5, 5] (Polaris: out-of-range clamps to edge). */
export function clampAxis(v: number): number {
  return Math.min(5, Math.max(-5, v));
}
