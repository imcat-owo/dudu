/**
 * 5-tier corner radius scale (px).
 *
 * Hard rule: use these tiers instead of hardcoded borderRadius literals.
 * Numeric literals >= 64 (circular / pill shapes) are exempt.
 */
export const radii = {
  /** Tiny: chips, badges, small tags. */
  xs: 6,
  /** Small: buttons, small inputs, thumbnails. */
  sm: 10,
  /** Medium: cards, list rows, default. */
  md: 14,
  /** Large: sheets, large cards, input bars. */
  lg: 20,
  /** Extra large: hero cards, floating capsules. */
  xl: 28,
} as const;

export type RadiusTier = keyof typeof radii;
