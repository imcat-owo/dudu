/**
 * Splash — app launch animation. Sora gray hand-drawn style.
 *
 * Alignment: premium app splash patterns (Mobbin catalog) —
 *   Netflix 'Tudum', Instagram logo-bloom, WhatsApp dots-to-logo:
 *   brand mark emerges with motion, holds a beat, then dissolves
 *   into the app via cross-fade. Never a dead static logo.
 *
 * Choreography (~1.8s total):
 *   0ms    Avatar blooms in — soft spring scale 0.85→1, fade 0→1
 *   150ms  Shimmer band sweeps across the avatar (one-shot, 800ms)
 *   350ms  Title "我们的空间" rises + fades in
 *   500ms  Subtitle fades in
 *   1400ms Whole splash cross-fades out (400ms, ease-in)
 *   1800ms onDone() — app takes over
 *
 * Warm gray canvas (#FAF9F6) hardcoded: theme isn't loaded yet at boot.
 * Zero emoji. Respects reduced motion implicitly — durations are short
 * and the animation is a single gentle bloom, no spinning/zooming.
 */

import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Image, View } from "react-native";
import { soraSource } from "./avatar-assets";
import { DUR, EASE, SPRING, STAGGER } from "./motion";

const CANVAS = "#FAF9F6";
const INK = "#3D3A33";
const MUTED = "#8A8578";
const ACCENT = "#C15F3C";

export function Splash({ onDone }: { onDone: () => void }) {
  const bloom = useRef(new Animated.Value(0)).current; // 0→1 avatar bloom
  const shimmerX = useRef(new Animated.Value(-1)).current; // -1→1 shimmer sweep
  const titleUp = useRef(new Animated.Value(0)).current; // 0→1 title rise
  const subFade = useRef(new Animated.Value(0)).current; // 0→1 subtitle
  const fadeOut = useRef(new Animated.Value(1)).current; // 1→0 exit
  const [reduceMotion, setReduceMotion] = useState(false);

  // Honor the OS Reduce Motion setting: skip the shimmer sweep and settle
  // the entrance instantly instead of choreographing it.
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (alive) setReduceMotion(v);
    });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      // Settle instantly: no bloom, no shimmer, no rise — just appear.
      bloom.setValue(1);
      titleUp.setValue(1);
      subFade.setValue(1);
    } else {
      // 1. Avatar bloom — soft spring, the hero moment.
      Animated.spring(bloom, {
        toValue: 1,
        ...SPRING.soft,
        useNativeDriver: true,
      }).start();

      // 2. Shimmer sweep across the avatar (one-shot).
      Animated.timing(shimmerX, {
        toValue: 1,
        duration: 800,
        delay: STAGGER.splash,
        easing: Easing.bezier(...EASE.inOut),
        useNativeDriver: true,
      }).start();

      // 3. Title rises.
      Animated.timing(titleUp, {
        toValue: 1,
        duration: DUR.normal,
        delay: 350,
        easing: Easing.bezier(...EASE.out),
        useNativeDriver: true,
      }).start();

      // 4. Subtitle fades.
      Animated.timing(subFade, {
        toValue: 1,
        duration: DUR.normal,
        delay: 500,
        easing: Easing.bezier(...EASE.out),
        useNativeDriver: true,
      }).start();
    }

    // 5. Cross-fade out, then hand over.
    const t1 = setTimeout(() => {
      Animated.timing(fadeOut, {
        toValue: 0,
        duration: reduceMotion ? 0 : 400,
        easing: Easing.bezier(...EASE.in),
        useNativeDriver: true,
      }).start();
    }, DUR.splash);
    const t2 = setTimeout(onDone, DUR.splash + 400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [bloom, shimmerX, titleUp, subFade, fadeOut, onDone, reduceMotion]);

  const avatarScale = bloom.interpolate({
    inputRange: [0, 1],
    outputRange: [0.82, 1],
  });
  const titleY = titleUp.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });
  const shimmerTranslate = shimmerX.interpolate({
    inputRange: [-1, 1],
    outputRange: [-120, 120],
  });

  return (
    <Animated.View
      style={{
        flex: 1,
        backgroundColor: CANVAS,
        alignItems: "center",
        justifyContent: "center",
        opacity: fadeOut,
      }}
    >
      {/* Avatar with shimmer */}
      <Animated.View
        style={{
          opacity: bloom,
          transform: [{ scale: avatarScale }],
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View
          style={{
            width: 148,
            height: 148,
            borderRadius: 74,
            overflow: "hidden",
            backgroundColor: "#EFE9DC",
          }}
        >
          <Image source={soraSource()} style={{ width: 148, height: 148 }} resizeMode="cover" />
          {/* Shimmer band, clipped to the avatar circle */}
          <Animated.View
            pointerEvents="none"
            style={{
              position: "absolute",
              top: -40,
              bottom: -40,
              width: 44,
              backgroundColor: "#FFFFFF",
              opacity: 0.45,
              transform: [{ translateX: shimmerTranslate }, { rotate: "18deg" }],
            }}
          />
        </View>
      </Animated.View>

      {/* Title */}
      <Animated.View
        style={{
          opacity: titleUp,
          transform: [{ translateY: titleY }],
          marginTop: 28,
          alignItems: "center",
        }}
      >
        <Animated.Text style={{ fontSize: 26, fontWeight: "800", color: INK, letterSpacing: 4 }}>
          我们的空间
        </Animated.Text>
        <Animated.View style={{ opacity: subFade, marginTop: 10 }}>
          <Animated.Text style={{ fontSize: 13, color: MUTED, letterSpacing: 2 }}>
            属于我们俩的地方
          </Animated.Text>
        </Animated.View>
      </Animated.View>

      {/* Quiet accent dot — a heartbeat */}
      <Animated.View
        style={{
          opacity: subFade,
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: ACCENT,
          marginTop: 26,
        }}
      />
    </Animated.View>
  );
}
