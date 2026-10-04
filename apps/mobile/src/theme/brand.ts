/**
 * Dudu brand constants — theme-independent, import-safe anywhere.
 *
 * The ochre is the brand color (hearts, liked states, splash accent). It is
 * deliberately NOT a theme token: it stays the same in every theme and in
 * dark mode, the same way a logo color does. Theme-aware surfaces live in
 * theme/types.ts + derive.ts; this file is for fixed brand identity only.
 *
 * Splash imports this directly because the theme provider isn't mounted yet
 * at launch — a plain constant keeps the launch palette honest without
 * duplicating the hex.
 */

/** Dudu brand ochre — hearts, liked/active states, brand accents. */
export const BRAND_OCHRE = "#C15F3C";
