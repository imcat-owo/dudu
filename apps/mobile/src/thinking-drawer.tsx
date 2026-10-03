/**
 * Thinking drawer: inline thinking status + bottom-sheet drawer.
 *
 * Her finalized design (2026-10-03):
 * 1. While the AI is thinking: an inline "thinking" status inside the
 *    message flow (never blocks/covers the chat).
 * 2. A cute little tappable button next to it.
 * 3. Tap -> a small drawer (bottom sheet) slides up from the bottom with
 *    the FULL thinking content card. Dismiss by swiping down or tapping
 *    outside.
 * 4. Sora gray hand-drawn aesthetic: gray tones, soft, refined, compact.
 *
 * Honesty rule: the button only appears when the model actually returned
 * thinking content. No thinking -> no button, no fake "thinking..." label.
 */

import { Sparkles, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { TText } from "./font";
import { t } from "./i18n";
import { useTheme } from "./theme/ThemeContext";

const SCREEN_H = Dimensions.get("window").height;
/** Max sheet height: 68% of the screen — a "small drawer", not a takeover. */
const SHEET_MAX_H = Math.round(SCREEN_H * 0.68);

/** Cute little circular button that opens the thinking drawer. */
export function ThinkingButton({ onPress }: { onPress: () => void }) {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("thinking.open")}
      onPress={onPress}
      hitSlop={8}
      style={{
        width: 26,
        height: 26,
        borderRadius: 13,
        backgroundColor: tokens.accent.bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Sparkles size={14} color={tokens.accent.fg} />
    </Pressable>
  );
}

/**
 * Inline thinking status inside the message flow. Renders nothing when
 * there is no thinking content (honest). While streaming it reads
 * "Thinking…"; after completion it reads "Thinking" (tap to re-open).
 */
export function ThinkingStatus({
  thinking,
  streaming,
  onOpen,
}: {
  thinking?: string;
  streaming: boolean;
  onOpen: () => void;
}) {
  const { tokens } = useTheme();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!streaming || !thinking) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.45, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [streaming, thinking, pulse]);

  if (!thinking) return null;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
        paddingVertical: 4,
      }}
    >
      <Animated.View style={{ opacity: pulse }}>
        <ThinkingButton onPress={onOpen} />
      </Animated.View>
      <Pressable onPress={onOpen} hitSlop={8}>
        <TText
          style={{
            fontSize: 12,
            color: tokens.text.fg,
            opacity: 0.65,
          }}
        >
          {streaming ? t("thinking.thinking") : t("thinking.title")}
        </TText>
      </Pressable>
    </View>
  );
}

/**
 * Bottom sheet drawer with the full thinking content.
 * Silky: spring entry (~300ms feel), native driver, ease-out exit.
 * Dismiss: swipe down on the sheet, or tap the backdrop.
 */
export function ThinkingDrawer({
  visible,
  thinking,
  onClose,
}: {
  visible: boolean;
  thinking: string;
  onClose: () => void;
}) {
  const { tokens } = useTheme();
  const translateY = useRef(new Animated.Value(SCREEN_H)).current;
  const backdrop = useRef(new Animated.Value(0)).current;
  const [closing, setClosing] = useState(false);
  const scrollY = useRef(0);

  const dismiss = () => {
    if (closing) return;
    setClosing(true);
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: SCREEN_H,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(backdrop, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      setClosing(false);
      onClose();
    });
  };

  useEffect(() => {
    if (visible) {
      translateY.setValue(SCREEN_H);
      backdrop.setValue(0);
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          tension: 130,
          friction: 16,
          useNativeDriver: true,
        }),
        Animated.timing(backdrop, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 10 && scrollY.current <= 0,
      onPanResponderMove: (_, gesture) => {
        if (gesture.dy > 0) translateY.setValue(gesture.dy);
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > 110 || gesture.vy > 0.7) {
          dismiss();
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            tension: 130,
            friction: 16,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;

  if (!visible) return null;
  return (
    <Modal transparent visible animationType="none" onRequestClose={dismiss}>
      <Animated.View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.35)",
          opacity: backdrop,
          justifyContent: "flex-end",
        }}
      >
        <Pressable style={{ flex: 1 }} onPress={dismiss} />
        <Animated.View
          {...pan.panHandlers}
          style={{
            transform: [{ translateY }],
            maxHeight: SHEET_MAX_H,
            backgroundColor: tokens.overlay.bg,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            paddingTop: 8,
            paddingBottom: 24,
            paddingHorizontal: 18,
          }}
        >
          {/* drag handle */}
          <View style={{ alignItems: "center", paddingBottom: 10 }}>
            <View
              style={{
                width: 38,
                height: 4,
                borderRadius: 2,
                backgroundColor: tokens.text.fg,
                opacity: 0.25,
              }}
            />
          </View>
          {/* header */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingBottom: 10,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Sparkles size={15} color={tokens.accent.fg} />
              <TText style={{ fontSize: 14, fontWeight: "600", color: tokens.text.fg }}>
                {t("thinking.title")}
              </TText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("common.close")}
              onPress={dismiss}
              hitSlop={10}
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                backgroundColor: tokens.aiBubble.bg,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <X size={15} color={tokens.text.fg} />
            </Pressable>
          </View>
          {/* full thinking content */}
          <ScrollView
            onScroll={(e) => {
              scrollY.current = e.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
          >
            <TText
              selectable
              style={{
                fontSize: 13,
                lineHeight: 20,
                color: tokens.text.fg,
                opacity: 0.85,
              }}
            >
              {thinking}
            </TText>
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
