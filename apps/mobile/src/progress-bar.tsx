/**
 * ProgressBar — the global cute progress bar with the little blob tip.
 *
 * Extracted from the task progress cards (our-space/task-cards-ui.tsx),
 * where she loved the small round blob riding the fill tip. Now any
 * surface can use it: task cards, indexing progress, uploads, etc.
 *
 * - Smooth eased fill animation on progress change.
 * - Shimmer sweep while `active`.
 * - The blob tip: a round dot with a light rim that rides the fill tip,
 *   scales in as progress leaves 0, and hides at rest.
 *
 * All colors from theme tokens via useColors() — zero hardcoded hex.
 * Zero emoji — pure vector.
 */

import { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import { DUR, EASE } from "./motion";
import { radii } from "./theme/radii";
import { useColors } from "./ui";

export interface ProgressBarProps {
  /** 0..1 fill amount. */
  progress: number;
  /** While true: shimmer sweep runs and the blob tip shows. */
  active?: boolean;
  /** Fill color. Defaults to the theme blue. */
  color?: string;
  /** Track color. Defaults to the theme line color. */
  trackColor?: string;
  /** Bar height. Defaults to 10. */
  height?: number;
  /** Blob tip diameter. Defaults to 14. */
  blobSize?: number;
}

export function ProgressBar({
  progress,
  active = false,
  color,
  trackColor,
  height = 10,
  blobSize = 14,
}: ProgressBarProps) {
  const colors = useColors();
  const width = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(width, {
      toValue: progress,
      duration: DUR.normal,
      easing: Easing.bezier(...EASE.out),
      useNativeDriver: false,
    }).start();
  }, [progress, width]);

  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(shimmer, {
          toValue: 0,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      shimmer.setValue(0);
    };
  }, [active, shimmer]);

  const shimmerX = shimmer.interpolate({ inputRange: [0, 1], outputRange: [-70, 240] });
  const fillColor = color ?? colors.blue;
  const barTrack = trackColor ?? colors.line;
  const blobOffset = -blobSize / 2;
  const blobTop = -(blobSize - height) / 2;

  return (
    <View
      style={{
        height,
        borderRadius: radii.xs,
        backgroundColor: barTrack,
      }}
    >
      <Animated.View
        style={{
          height: "100%",
          borderRadius: radii.xs,
          backgroundColor: fillColor,
          width: width.interpolate({ inputRange: [0, 1], outputRange: ["2%", "100%"] }),
          overflow: "visible",
        }}
      >
        {active && (
          <View
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              right: 0,
              borderRadius: radii.xs,
              overflow: "hidden",
            }}
          >
            <Animated.View
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                width: 70,
                backgroundColor: colors.onBlue,
                opacity: 0.32,
                transform: [{ translateX: shimmerX }],
              }}
            />
          </View>
        )}
        {/* cute round blob riding the fill tip */}
        <Animated.View
          style={{
            position: "absolute",
            right: blobOffset,
            top: blobTop,
            width: blobSize,
            height: blobSize,
            borderRadius: radii.xs,
            backgroundColor: fillColor,
            borderWidth: 2.5,
            borderColor: colors.onBlue,
            opacity: width.interpolate({ inputRange: [0, 0.03], outputRange: [0, 1] }),
            transform: [
              { scale: width.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) },
            ],
          }}
        />
      </Animated.View>
    </View>
  );
}
