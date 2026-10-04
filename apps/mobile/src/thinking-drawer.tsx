/**
 * Activity drawer: inline thinking/tool status + bottom-sheet drawer.
 *
 * Her finalized design v2 (2026-10-03, verified against the real Claude app):
 * 1. While the AI is thinking: an inline "thinking" status inside the
 *    message flow (never blocks/covers the chat) + a cute little button.
 * 2. Tap -> a small drawer (bottom sheet) slides up from the bottom,
 *    default HALF height, draggable. Two content modes:
 *    - thinking only (no tools): the FULL thinking text, directly.
 *    - with tools: an ACTION LIST (one row per tool call: name + status).
 * 3. Tapping an action pushes a NEW PAGE (same drawer height, not expanding
 *    in place): title centered, status below it, INPUTS listed by name,
 *    full OUTPUT, all expanded, never folded. Top-left back returns to the
 *    list; top-right X closes.
 * 4. Sora gray hand-drawn aesthetic: warm grays, soft, refined, compact.
 *
 * Honesty rule: the button only appears when the model actually returned
 * thinking content or real tool calls. No data -> no button, no fakes.
 *
 * Global emoji ban (2026-10-03): every icon here is a lucide vector icon.
 * No emoji anywhere in this file.
 */

import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  LoaderCircle,
  Sparkles,
  Wrench,
  X,
} from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import type { DrawerActionStatus, DrawerToolAction } from "./activity-drawer-model";
import { TText } from "./font";
import { t } from "./i18n";
import { DUR, SPRING } from "./motion";
import { radii } from "./theme/radii";
import { useTheme } from "./theme/ThemeContext";
import { useColors } from "./ui";

const SCREEN = Dimensions.get("window");
/** Default half height — a "small drawer", not a takeover. */
const SHEET_H = Math.round(SCREEN.height * 0.5);
const SHEET_W = SCREEN.width;

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
        borderRadius: radii.md,
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
  // 0 → 1 → 0 "breath". Drives the brand-color halo ping + a gentle button
  // scale — livelier than a plain opacity blink, still subtle (motion.ts:
  // purposeful motion only; the halo answers "the AI is working right now").
  // Ambient loop: keeps its physical 900ms period, not a transition token.
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!streaming || !thinking) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      pulse.setValue(0);
    };
  }, [streaming, pulse, thinking]);

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
      <View
        style={{
          width: 26,
          height: 26,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {streaming ? (
          <Animated.View
            style={{
              position: "absolute",
              width: 26,
              height: 26,
              borderRadius: 13,
              backgroundColor: tokens.accent.bg,
              opacity: pulse.interpolate({
                inputRange: [0, 1],
                outputRange: [0.5, 0],
              }),
              transform: [
                {
                  scale: pulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.7, 1.7],
                  }),
                },
              ],
            }}
          />
        ) : null}
        <Animated.View
          style={
            streaming
              ? {
                  transform: [
                    {
                      scale: pulse.interpolate({
                        inputRange: [0, 1],
                        outputRange: [1, 1.1],
                      }),
                    },
                  ],
                }
              : undefined
          }
        >
          <ThinkingButton onPress={onOpen} />
        </Animated.View>
      </View>
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
 * Inline tool-actions entry in the message flow. Renders nothing when there
 * are no tool calls (honest). Tapping opens the drawer on the action list.
 */
export function ToolActionsStatus({ count, onOpen }: { count: number; onOpen: () => void }) {
  const { tokens } = useTheme();
  if (count <= 0) return null;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
        paddingVertical: 4,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("thinking.openActions")}
        onPress={onOpen}
        hitSlop={8}
        style={{
          width: 26,
          height: 26,
          borderRadius: radii.md,
          backgroundColor: tokens.accent.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Wrench size={14} color={tokens.accent.fg} />
      </Pressable>
      <Pressable
        onPress={onOpen}
        hitSlop={8}
        style={{ flexDirection: "row", alignItems: "center", gap: 1 }}
      >
        <TText
          style={{
            fontSize: 12,
            color: tokens.text.fg,
            opacity: 0.65,
          }}
        >
          {t("thinking.nActions", { n: count })}
        </TText>
        <ChevronRight size={13} color={tokens.text.fg} style={{ opacity: 0.4 }} />
      </Pressable>
    </View>
  );
}

/** Status icon for an action row / detail header. Vector only, no emoji. */
function ActionStatusIcon({ status }: { status: DrawerActionStatus }) {
  const { tokens } = useTheme();
  const colors = useColors();
  if (status === "done") {
    return <Check size={14} color={tokens.accent.fg} />;
  }
  if (status === "error") {
    return <CircleAlert size={14} color={colors.danger} />;
  }
  return <LoaderCircle size={14} color={tokens.accent.fg} />;
}

function statusText(status: DrawerActionStatus): string {
  if (status === "done") return t("thinking.statusDone");
  if (status === "error") return t("thinking.statusError");
  return t("thinking.statusRunning");
}

function SectionHeader({ children }: { children: string }) {
  const { tokens } = useTheme();
  return (
    <TText
      style={{
        fontSize: 12,
        fontWeight: "700",
        color: tokens.text.fg,
        opacity: 0.45,
        letterSpacing: 1,
        marginTop: 14,
        marginBottom: 6,
      }}
    >
      {children}
    </TText>
  );
}

/**
 * Bottom sheet drawer: thinking text, or the tool action list with a
 * push-in detail page per action.
 *
 * Silky: spring entry (~300ms feel), native driver. The list->detail push
 * is a horizontal slide at the same sheet height. Dismiss: swipe down on
 * the sheet (drag handle), or tap the backdrop — from both levels.
 */
export function ThinkingDrawer({
  visible,
  thinking,
  actions,
  onClose,
}: {
  visible: boolean;
  thinking: string;
  actions: DrawerToolAction[];
  onClose: () => void;
}) {
  const { tokens } = useTheme();
  const translateY = useRef(new Animated.Value(SCREEN.height)).current;
  const backdrop = useRef(new Animated.Value(0)).current;
  const slideX = useRef(new Animated.Value(0)).current;
  const [closing, setClosing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const scrollY = useRef(0);
  // Drag-handle "breathing": a slow, calm paw-print pulse. Subtle on purpose —
  // the handle is chrome, not content (motion.ts: purposeful motion only).
  // Ambient loop: keeps its physical 1400ms period, not a transition token.
  const breathe = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breathe]);

  const hasActions = actions.length > 0;
  // Live lookup: the selected action re-reads from `actions` every render,
  // so running -> done transitions show while the detail page is open.
  const selected = selectedId ? (actions.find((a) => a.id === selectedId) ?? null) : null;

  const dismiss = () => {
    if (closing) return;
    setClosing(true);
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: SCREEN.height,
        duration: DUR.fast,
        useNativeDriver: true,
      }),
      Animated.timing(backdrop, { toValue: 0, duration: DUR.fast, useNativeDriver: true }),
    ]).start(() => {
      setClosing(false);
      onClose();
    });
  };

  useEffect(() => {
    if (visible) {
      setSelectedId(null);
      slideX.setValue(0);
      translateY.setValue(SCREEN.height);
      backdrop.setValue(0);
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          ...SPRING.gentle,
          useNativeDriver: true,
        }),
        Animated.timing(backdrop, { toValue: 1, duration: DUR.fast, useNativeDriver: true }),
      ]).start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const openAction = (action: DrawerToolAction) => {
    setSelectedId(action.id);
    slideX.setValue(SHEET_W);
    Animated.timing(slideX, {
      toValue: 0,
      duration: DUR.normal,
      useNativeDriver: true,
    }).start();
  };

  const backToList = () => {
    Animated.timing(slideX, {
      toValue: SHEET_W,
      duration: DUR.normal,
      useNativeDriver: true,
    }).start(() => setSelectedId(null));
  };

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
            ...SPRING.gentle,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;

  const trackScroll = (e: { nativeEvent: { contentOffset: { y: number } } }) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
  };

  if (!visible) return null;

  const sheetStyle = {
    transform: [{ translateY }] as const,
    height: SHEET_H,
    backgroundColor: tokens.overlay.bg,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingTop: 8,
    paddingBottom: 24,
    paddingHorizontal: 18,
  };

  const closeButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("common.close")}
      onPress={dismiss}
      hitSlop={10}
      style={{
        width: 28,
        height: 28,
        borderRadius: radii.md,
        backgroundColor: tokens.aiBubble.bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <X size={15} color={tokens.text.fg} />
    </Pressable>
  );

  // Paw-print drag handle: keeps the iOS 38pt hit width, but the visual is a
  // little paw (main pad + three toe beans) instead of a plain bar. Zero
  // emoji — pure Views/SVG shapes. Breathes gently while the drawer is open.
  const dragHandle = (() => {
    const pad = tokens.text.fg;
    const bean = (size: number, left: number, top: number, key: string) => (
      <Animated.View
        key={key}
        style={{
          position: "absolute",
          left,
          top,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: pad,
          opacity: breathe.interpolate({
            inputRange: [0, 1],
            outputRange: [0.22, 0.4],
          }),
          transform: [
            {
              scale: breathe.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 1.08],
              }),
            },
          ],
        }}
      />
    );
    return (
      <View style={{ alignItems: "center", paddingVertical: 8 }}>
        <View
          style={{ width: 38, height: 26, alignItems: "center", justifyContent: "center" }}
          accessibilityRole="adjustable"
          accessibilityLabel={t("thinking.dragHandle")}
        >
          {bean(7, 4, 0, "t1")}
          {bean(8, 15, -2, "t2")}
          {bean(7, 27, 0, "t3")}
          <Animated.View
            style={{
              position: "absolute",
              left: 9,
              top: 10,
              width: 20,
              height: 15,
              borderRadius: radii.sm,
              backgroundColor: pad,
              opacity: breathe.interpolate({
                inputRange: [0, 1],
                outputRange: [0.22, 0.4],
              }),
              transform: [
                {
                  scale: breathe.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, 1.08],
                  }),
                },
              ],
            }}
          />
        </View>
      </View>
    );
  })();

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
        <Animated.View {...pan.panHandlers} style={sheetStyle}>
          {dragHandle}
          {hasActions ? (
            <>
              {/* action list header */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingBottom: 6,
                }}
              >
                <View style={{ width: 28 }} />
                <TText style={{ fontSize: 14, fontWeight: "600", color: tokens.text.fg }}>
                  {t("thinking.actionsTitle")}
                </TText>
                {closeButton}
              </View>
              <ScrollView
                onScroll={trackScroll}
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={false}
              >
                <View style={{ gap: 8, paddingTop: 4 }}>
                  {actions.map((action) => (
                    <Pressable
                      key={action.id}
                      accessibilityRole="button"
                      onPress={() => openAction(action)}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                        backgroundColor: tokens.aiBubble.bg,
                        borderRadius: radii.md,
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                      }}
                    >
                      <ActionStatusIcon status={action.status} />
                      <View style={{ flex: 1 }}>
                        <TText
                          style={{ fontSize: 13, fontWeight: "600", color: tokens.text.fg }}
                          numberOfLines={1}
                        >
                          {action.title}
                        </TText>
                        <TText style={{ fontSize: 11, color: tokens.text.fg, opacity: 0.55 }}>
                          {statusText(action.status)}
                        </TText>
                      </View>
                      <ChevronRight size={15} color={tokens.text.fg} style={{ opacity: 0.4 }} />
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            </>
          ) : (
            <>
              {/* thinking-only header */}
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
                {closeButton}
              </View>
              {/* full thinking content */}
              <ScrollView
                onScroll={trackScroll}
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
            </>
          )}

          {/* action detail page: pushed in at the same sheet height */}
          {selected && (
            <Animated.View
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: tokens.overlay.bg,
                borderTopLeftRadius: radii.lg,
                borderTopRightRadius: radii.lg,
                paddingTop: 8,
                paddingBottom: 24,
                paddingHorizontal: 18,
                transform: [{ translateX: slideX }],
              }}
            >
              {dragHandle}
              {/* header: back | centered title | close */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingBottom: 2,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("thinking.backToList")}
                  onPress={backToList}
                  hitSlop={10}
                  style={{
                    width: 28,
                    height: 28,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <ChevronLeft size={17} color={tokens.text.fg} style={{ opacity: 0.6 }} />
                </Pressable>
                <TText
                  style={{ fontSize: 14, fontWeight: "600", color: tokens.text.fg }}
                  numberOfLines={1}
                >
                  {selected.title}
                </TText>
                {closeButton}
              </View>
              <TText
                style={{
                  textAlign: "center",
                  fontSize: 12,
                  color: tokens.text.fg,
                  opacity: 0.55,
                  marginBottom: 2,
                }}
              >
                {statusText(selected.status)}
              </TText>
              <ScrollView
                onScroll={trackScroll}
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={false}
              >
                <SectionHeader>{t("thinking.input")}</SectionHeader>
                <View
                  style={{
                    backgroundColor: tokens.aiBubble.bg,
                    borderRadius: radii.sm,
                    paddingHorizontal: 12,
                    paddingVertical: 9,
                  }}
                >
                  {selected.inputs.length === 0 ? (
                    <TText style={{ fontSize: 12.5, color: tokens.text.fg, opacity: 0.5 }}>—</TText>
                  ) : (
                    selected.inputs.map((input) => (
                      <TText
                        key={input.name}
                        selectable
                        style={{ fontSize: 12.5, lineHeight: 24, color: tokens.text.fg }}
                      >
                        <TText style={{ fontWeight: "700", color: tokens.text.fg }}>
                          {input.name}
                        </TText>
                        <TText style={{ opacity: 0.8 }}> {input.value || "—"}</TText>
                      </TText>
                    ))
                  )}
                </View>
                <SectionHeader>{t("thinking.output")}</SectionHeader>
                <View
                  style={{
                    backgroundColor: tokens.aiBubble.bg,
                    borderRadius: radii.sm,
                    paddingHorizontal: 12,
                    paddingVertical: 9,
                  }}
                >
                  <TText
                    selectable
                    style={{ fontSize: 12.5, lineHeight: 21, color: tokens.text.fg, opacity: 0.85 }}
                  >
                    {selected.output || "—"}
                  </TText>
                </View>
              </ScrollView>
            </Animated.View>
          )}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
