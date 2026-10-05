/**
 * Reduce Motion support.
 *
 * useReduceMotion(): live flag from AccessibilityInfo, following the same
 * pattern as useScreenReaderEnabled() in voiceover.ts. Ambient loops
 * (thinking-drawer pulse/breathe, our-space status pulse) must not run
 * while the OS reduce-motion setting is on — they render a static frame
 * instead. Purposeful one-shot transitions (drawer slide, dismiss) are
 * untouched: the setting targets looping/ambient motion, not feedback.
 */

import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/** True while the OS reduce-motion setting is enabled. Live. */
export function useReduceMotion(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (mounted) setEnabled(v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setEnabled);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return enabled;
}
