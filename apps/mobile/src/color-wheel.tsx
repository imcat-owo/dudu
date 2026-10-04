/**
 * ColorWheel — a proper HSV color wheel picker (Phase 1b item 5).
 *
 * Built on react-native-svg (already a dependency) + PanResponder.
 * Hue around the wheel, saturation center→edge, with a separate
 * brightness slider. Augments (does not replace) the swatch row and
 * hex input — the hex field stays the precise path.
 */

import { useMemo, useRef, useState } from "react";
import { PanResponder, View } from "react-native";
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from "react-native-svg";
import { hexToHsv, hsvToHex } from "./color";
import { radii } from "./theme/radii";

const WHEEL_SIZE = 208;
const RADIUS = WHEEL_SIZE / 2;
const SEGMENTS = 72;

function WheelSvg({ h, s }: { h: number; s: number }) {
  const paths = useMemo(() => {
    const els = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const a0 = (i / SEGMENTS) * Math.PI * 2 - Math.PI / 2;
      const a1 = ((i + 1) / SEGMENTS) * Math.PI * 2 - Math.PI / 2;
      const x0 = RADIUS + RADIUS * Math.cos(a0);
      const y0 = RADIUS + RADIUS * Math.sin(a0);
      const x1 = RADIUS + RADIUS * Math.cos(a1);
      const y1 = RADIUS + RADIUS * Math.sin(a1);
      els.push(
        <Path
          key={i}
          d={`M ${RADIUS} ${RADIUS} L ${x0.toFixed(1)} ${y0.toFixed(1)} A ${RADIUS} ${RADIUS} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z`}
          fill={hsvToHex((i / SEGMENTS) * 360, 1, 1)}
          stroke="none"
        />,
      );
    }
    return els;
  }, []);
  // Indicator dot at the current hue/saturation.
  const rad = ((h - 90) * Math.PI) / 180;
  const dotR = s * (RADIUS - 6);
  const dotX = RADIUS + dotR * Math.cos(rad);
  const dotY = RADIUS + dotR * Math.sin(rad);
  return (
    <Svg width={WHEEL_SIZE} height={WHEEL_SIZE}>
      <Defs>
        <RadialGradient id="sat" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor="#ffffff" stopOpacity={1} />
          <Stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      {paths}
      <Circle cx={RADIUS} cy={RADIUS} r={RADIUS} fill="url(#sat)" />
      <Circle cx={dotX} cy={dotY} r={9} fill="none" stroke="#ffffff" strokeWidth={3} />
      <Circle cx={dotX} cy={dotY} r={9} fill="none" stroke="#00000055" strokeWidth={1} />
    </Svg>
  );
}

export function ColorWheel({
  color,
  onChange,
}: {
  /** Current color as #rrggbb. */
  color: string;
  /** Called with the new #rrggbb on tap/drag. */
  onChange: (hex: string) => void;
}) {
  const { h, s, v } = hexToHsv(color);
  const [value, setValue] = useState(v);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;

  const pickFromPoint = (x: number, y: number) => {
    const dx = x - RADIUS;
    const dy = y - RADIUS;
    const dist = Math.min(1, Math.sqrt(dx * dx + dy * dy) / (RADIUS - 6));
    let hue = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    hue = ((hue % 360) + 360) % 360;
    onChangeRef.current(hsvToHex(hue, dist, valueRef.current));
  };

  const wheelPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => pickFromPoint(e.nativeEvent.locationX, e.nativeEvent.locationY),
      onPanResponderMove: (e) => pickFromPoint(e.nativeEvent.locationX, e.nativeEvent.locationY),
    }),
  ).current;

  // Brightness slider: black -> full hue color.
  const barPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const t = Math.min(1, Math.max(0, e.nativeEvent.locationX / 208));
        setValue(t);
        onChangeRef.current(hsvToHex(h, s, t));
      },
      onPanResponderMove: (e) => {
        const t = Math.min(1, Math.max(0, e.nativeEvent.locationX / 208));
        setValue(t);
        onChangeRef.current(hsvToHex(h, s, t));
      },
    }),
  ).current;

  return (
    <View style={{ gap: 10, alignItems: "center" }}>
      <View
        {...wheelPan.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel="color wheel"
      >
        <WheelSvg h={h} s={s} />
      </View>
      <View
        {...barPan.panHandlers}
        style={{
          width: 208,
          height: 28,
          borderRadius: radii.md,
          backgroundColor: "#000000",
          overflow: "hidden",
          justifyContent: "center",
        }}
        accessibilityRole="adjustable"
        accessibilityLabel="brightness"
      >
        <View
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 208,
            backgroundColor: hsvToHex(h, s, 1),
            opacity: value,
          }}
        />
        <View
          style={{
            position: "absolute",
            left: value * 208 - 9,
            width: 18,
            height: 18,
            borderRadius: radii.sm,
            backgroundColor: "#ffffff",
            borderWidth: 1,
            borderColor: "#00000033",
          }}
        />
      </View>
    </View>
  );
}
