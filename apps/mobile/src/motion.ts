/**
 * Motion design tokens — unified rhythm for the whole app.
 *
 * Alignment: Apple HIG Motion + Material Design 3 easing.
 * - Purposeful motion only: every animation answers "where did this come
 *   from / what changed". Decorative motion is cut.
 * - Spring physics over linear (Apple's favorite) for natural settle.
 * - Ease-out for entering (arrive fast, settle gently); ease-in for leaving.
 * - Exit faster than enter (~60-70%) so the app feels responsive.
 * - Stagger 80-150ms per item for sequences (Apple uses ~90ms for words).
 *
 * PURE module: no React Native imports — plain constants + helpers.
 * Components map these onto Animated.spring / Animated.timing.
 */

/** Duration scale (ms). */
export const DUR = {
  /** Micro-interactions: press feedback. */
  instant: 100,
  /** Hover/focus states, small reveals. */
  fast: 200,
  /** Standard transitions: tab switches, sheet slides. */
  normal: 300,
  /** Complex animations: splash, hero moments. */
  slow: 500,
  /** Splash total choreography. */
  splash: 1400,
} as const;

/** Spring configs for Animated.spring (tension / friction). */
export const SPRING = {
  /** Gentle settle — default for UI entrances (thinking drawer uses this). */
  gentle: { tension: 130, friction: 16 },
  /** Softer, dreamier — splash avatar bloom, garden items. */
  soft: { tension: 90, friction: 14 },
  /** Snappy — tab indicator, checkbox pops. */
  snappy: { tension: 180, friction: 20 },
} as const;

/** Stagger delays (ms) for sequenced entrances. */
export const STAGGER = {
  /** List items: diary entries, timeline events, garden cards. */
  item: 90,
  /** Tab content blocks. */
  block: 120,
  /** Splash choreography beats. */
  splash: 150,
} as const;

/**
 * Easing curves as cubic-bezier tuples for Animated.timing's `easing`
 * (via Easing.bezier). Use EASE_OUT for entrances, EASE_IN for exits.
 */
export const EASE = {
  /** Entering: arrive fast, settle gently. ~70% of animations. */
  out: [0, 0, 0.2, 1] as const,
  /** Leaving: accelerate away, don't linger. */
  in: [0.4, 0, 1, 1] as const,
  /** Moving between on-screen positions. */
  inOut: [0.4, 0, 0.2, 1] as const,
} as const;

/** Exit duration = ~65% of enter duration (feels responsive). */
export function exitDuration(enterMs: number): number {
  return Math.round(enterMs * 0.65);
}
