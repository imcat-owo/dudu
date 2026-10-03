/**
 * ThemeTransition — the silky theme switch (Phase 1b item 4).
 *
 * The owner called upstream OpenMuse's animations mediocre and not silky;
 * ours must be visibly smoother. On every discrete theme change (try-on
 * start, apply, rollback, remote adopt) the content does a subtle
 * 300ms opacity pulse — enough to feel deliberate, never flashy.
 * Continuous updates during a color drag do NOT pulse (the live preview
 * is already smooth); see ThemeContext.transitionKey.
 */

import { type ReactNode, useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";
import { useTheme } from "./theme/ThemeContext";

export function ThemeTransition({ children }: { children: ReactNode }) {
  const { transitionKey } = useTheme();
  const opacity = useRef(new Animated.Value(1)).current;
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    opacity.setValue(0.93);
    const anim = Animated.timing(opacity, {
      toValue: 1,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [transitionKey, opacity]);

  return <Animated.View style={{ flex: 1, opacity }}>{children}</Animated.View>;
}
