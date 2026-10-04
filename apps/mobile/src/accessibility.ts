/**
 * System accessibility settings that the App's appearance must follow.
 *
 * Standing rule (owner, 2026-10-05): App appearance follows iOS system
 * settings — nothing hardcoded. Language and font size already follow;
 * this module covers the visual/transparency side.
 *
 * What iOS exposes to apps:
 * - Reduce Transparency (Settings → Accessibility → Display & Text Size):
 *   readable via AccessibilityInfo.isReduceTransparencyEnabled() and the
 *   "reduceTransparencyChanged" event. When ON, all frosted-glass / blur
 *   surfaces must render as solid theme-token colors instead.
 * - Glass "clarity" amount: iOS exposes NO public API for a user-adjustable
 *   glass transparency level, so blur intensities stay as shipped defaults
 *   (they match the current look); the reduce-transparency switch is the
 *   honored control.
 */

import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * True when the OS "Reduce Transparency" accessibility switch is on.
 * Live-updates when the user flips the switch (no app restart needed).
 */
export function useReduceTransparency(): boolean {
  const [reduceTransparency, setReduceTransparency] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceTransparencyEnabled()
      .then((v) => {
        if (mounted) setReduceTransparency(v);
      })
      .catch(() => {
        // Leave the default (transparency on): a failed read must not
        // silently switch the whole App to solid surfaces.
      });
    const sub = AccessibilityInfo.addEventListener(
      "reduceTransparencyChanged",
      setReduceTransparency,
    );
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduceTransparency;
}
