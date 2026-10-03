/**
 * TaskBuddy — cute round Q-version SVG companion for task progress cards.
 *
 * Her art direction (verbatim): "svg画的可爱点哦。喜欢圆润的Q版的，
 * 粗线条但不要太粗，动画效果那些也不含糊。"
 *
 * - Round blob body, thick-but-not-too-thick outline (strokeWidth 3 on 56px)
 * - Simple dot eyes + small mouth, expression changes per task status
 * - running: determined face + bounce animation + motion lines
 * - stuck:   dizzy spiral eyes + tilted, gentle wobble
 * - done:    big happy smile + star sparkles + pop-in
 *
 * Colors passed in as props (theme tokens from the caller) — no hardcoded hex.
 * Zero emoji.
 */

import { useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";
import Svg, { Circle, G, Path } from "react-native-svg";
import { SPRING } from "../motion";
import type { TaskStatus } from "./task-progress";

interface BuddyColors {
  /** Outline color (thick line). */
  line: string;
  /** Body fill. */
  fill: string;
  /** Face features. */
  face: string;
  /** Accent for sparkles / motion lines. */
  accent: string;
}

function RunningFace({ c }: { c: BuddyColors }) {
  return (
    <G>
      {/* determined eyes: dots with angled brows */}
      <Circle cx={21} cy={25} r={3.2} fill={c.face} />
      <Circle cx={35} cy={25} r={3.2} fill={c.face} />
      <Path d="M16 17 L24 19.5" stroke={c.face} strokeWidth={2.6} strokeLinecap="round" />
      <Path d="M40 17 L32 19.5" stroke={c.face} strokeWidth={2.6} strokeLinecap="round" />
      {/* small open smile */}
      <Path
        d="M23 34 Q28 39 33 34"
        stroke={c.face}
        strokeWidth={2.6}
        strokeLinecap="round"
        fill="none"
      />
      {/* motion lines */}
      <Path d="M6 22 L2 22" stroke={c.accent} strokeWidth={2.4} strokeLinecap="round" />
      <Path d="M7 32 L3 33" stroke={c.accent} strokeWidth={2.4} strokeLinecap="round" />
      <Path d="M50 22 L54 22" stroke={c.accent} strokeWidth={2.4} strokeLinecap="round" />
      {/* sweat drop of effort */}
      <Path
        d="M45 12 Q47.5 16 45 18.5 Q42.5 16 45 12"
        fill={c.accent}
        stroke={c.line}
        strokeWidth={1.6}
      />
    </G>
  );
}

function StuckFace({ c }: { c: BuddyColors }) {
  return (
    <G>
      {/* dizzy spiral eyes */}
      <Path
        d="M18 25 m-3 0 a3 3 0 1 0 6 0 a2 2 0 1 1 -4 0"
        stroke={c.face}
        strokeWidth={2.2}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M32 25 m-3 0 a3 3 0 1 1 6 0 a2 2 0 1 0 -4 0"
        stroke={c.face}
        strokeWidth={2.2}
        strokeLinecap="round"
        fill="none"
      />
      {/* wavy uneasy mouth */}
      <Path
        d="M23 35 Q25.5 33 28 35 Q30.5 37 33 35"
        stroke={c.face}
        strokeWidth={2.6}
        strokeLinecap="round"
        fill="none"
      />
      {/* question mark */}
      <Path
        d="M44 10 Q48 10 48 14 Q48 17 45.5 18 L45 20"
        stroke={c.accent}
        strokeWidth={2.8}
        strokeLinecap="round"
        fill="none"
      />
      <Circle cx={45} cy={24} r={1.8} fill={c.accent} />
    </G>
  );
}

function DoneFace({ c }: { c: BuddyColors }) {
  return (
    <G>
      {/* happy closed eyes: little arcs */}
      <Path
        d="M17 25 Q21 21 25 25"
        stroke={c.face}
        strokeWidth={2.8}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M31 25 Q35 21 39 25"
        stroke={c.face}
        strokeWidth={2.8}
        strokeLinecap="round"
        fill="none"
      />
      {/* big open smile */}
      <Path d="M22 32 Q28 40 34 32 Q28 35.5 22 32" fill={c.face} />
      {/* blush */}
      <Circle cx={16} cy={31} r={2.6} fill={c.accent} opacity={0.55} />
      <Circle cx={40} cy={31} r={2.6} fill={c.accent} opacity={0.55} />
      {/* star sparkles */}
      <Path
        d="M48 8 L49.2 11.2 L52.5 12.5 L49.2 13.8 L48 17 L46.8 13.8 L43.5 12.5 L46.8 11.2 Z"
        fill={c.accent}
      />
      <Path
        d="M8 12 L8.8 14 L10.8 14.8 L8.8 15.6 L8 17.6 L7.2 15.6 L5.2 14.8 L7.2 14 Z"
        fill={c.accent}
        opacity={0.8}
      />
    </G>
  );
}

export function TaskBuddy({
  status,
  colors,
  size = 56,
}: {
  status: TaskStatus;
  colors: BuddyColors;
  size?: number;
}) {
  const bob = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(status === "done" ? 0.6 : 1)).current;

  useEffect(() => {
    if (status === "running") {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(bob, {
            toValue: -4,
            duration: 420,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(bob, {
            toValue: 0,
            duration: 420,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    if (status === "stuck") {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(bob, {
            toValue: 2,
            duration: 700,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(bob, {
            toValue: -2,
            duration: 700,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    bob.setValue(0);
    return undefined;
  }, [status, bob]);

  useEffect(() => {
    if (status === "done") {
      Animated.spring(pop, { ...SPRING.snappy, toValue: 1, useNativeDriver: true }).start();
    } else {
      pop.setValue(1);
    }
  }, [status, pop]);

  return (
    <Animated.View style={{ transform: [{ translateY: bob }, { scale: pop }] }}>
      <Svg width={size} height={size} viewBox="0 0 56 56">
        {/* round Q-version body, thick outline */}
        <Circle cx={28} cy={29} r={22} fill={colors.fill} stroke={colors.line} strokeWidth={3} />
        {/* little feet */}
        <Circle cx={20} cy={50} r={4.5} fill={colors.fill} stroke={colors.line} strokeWidth={2.6} />
        <Circle cx={36} cy={50} r={4.5} fill={colors.fill} stroke={colors.line} strokeWidth={2.6} />
        {status === "running" && <RunningFace c={colors} />}
        {status === "stuck" && <StuckFace c={colors} />}
        {status === "done" && <DoneFace c={colors} />}
      </Svg>
    </Animated.View>
  );
}
