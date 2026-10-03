import { Hct, hexFromArgb } from "@material/material-color-utilities";
import { ArrowUpRight, Check, ChevronRight, type LucideIcon, X } from "lucide-react-native";
import { type ReactNode, useMemo } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  type TextInputProps,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFontSizeSetting } from "./app-settings";
import { t } from "./i18n";
import { DEFAULT_MASCOT_INDEX } from "./mascot";
import { mascotSource } from "./mascot-assets";
import { clampFg, type ResolvedMode } from "./theme/derive";
import { useTheme } from "./theme/ThemeContext";
import type { SurfaceId, SurfaceTokens } from "./theme/types";
import { TText } from "./font";

/**
 * Legacy palette shape, now derived live from theme tokens.
 *
 * The old static `colors` export is gone: every field below is computed from
 * the 8 theme surfaces, so staging/applying a theme bundle repaints every
 * screen that reads these values. There are no hardcoded colors in this file.
 *
 * Mapping:
 * - canvas/card/text/muted/line come straight from the canvas/card/text surfaces.
 * - blue/blueDark are the accent surface (primary actions, links, brand icons).
 * - sky/green/lavender/orange are pastel tints mixed from the card background
 *   toward the theme's accent/success/warning hues — they keep their old hue
 *   identity but follow the active theme and light/dark mode.
 * - danger is an HCT-derived error red, clamped to 4.5:1 contrast on cards.
 * - Text colors come from tokens only, never pure black/white (derive() clamps).
 */
export type UIPalette = {
  canvas: string;
  card: string;
  text: string;
  muted: string;
  line: string;
  blue: string;
  blueDark: string;
  sky: string;
  green: string;
  lavender: string;
  orange: string;
  danger: string;
  /** Foreground for content drawn on `blue` (accent surface fg). */
  onBlue: string;
  /** Text-input background (input surface bg). */
  inputBg: string;
  /** Secondary (non-primary) button background. */
  secondaryBg: string;
  /** Modal scrim, alpha baked in. */
  scrim: string;
  /** Checkmark drawn inside a checked checkbox. */
  checkOn: string;
  /** Error-notice background: pastel tint toward danger. */
  errorBg: string;
};

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** Linear-RGB mix of two #rrggbb colors, t=0 -> a, t=1 -> b. */
function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const m = (x: number, y: number) => Math.round(x + (y - x) * t);
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(m(ar, br))}${h(m(ag, bg))}${h(m(ab, bb))}`;
}

/** Append an alpha byte to a #rrggbb color. */
function withAlpha(hex: string, alpha: number): string {
  return `${hex}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

/**
 * Map the 8 theme surfaces onto the legacy palette.
 * Pure function of (tokens, mode): same tokens in -> same palette out.
 */
export function paletteFromTokens(
  tokens: Record<SurfaceId, SurfaceTokens>,
  mode: ResolvedMode,
): UIPalette {
  const cardBg = tokens.card.bg;
  // Semantic hues via HCT (never hardcoded hex): error red, success green, warning amber.
  const vivid = (hue: number, chroma: number): string =>
    hexFromArgb(Hct.from(hue, chroma, mode === "dark" ? 78 : 45).toInt());
  const danger = clampFg(cardBg, vivid(12, 60));
  const pastel = (vividColor: string): string => mix(cardBg, vividColor, 0.16);
  return {
    canvas: tokens.canvas.bg,
    card: cardBg,
    text: tokens.text.fg,
    muted: tokens.text.accent,
    line: tokens.text.border ?? tokens.card.border ?? mix(tokens.text.fg, cardBg, 0.9),
    blue: tokens.accent.bg,
    blueDark: tokens.accent.bg,
    sky: pastel(tokens.accent.bg),
    lavender: pastel(tokens.aiBubble.accent),
    green: pastel(vivid(148, 52)),
    orange: pastel(vivid(72, 75)),
    danger,
    onBlue: tokens.accent.fg,
    inputBg: tokens.input.bg,
    secondaryBg: tokens.aiBubble.bg,
    scrim: withAlpha(tokens.text.fg, 0.22),
    checkOn: tokens.canvas.bg,
    errorBg: mix(cardBg, danger, 0.14),
  };
}

/**
 * Build the shared stylesheet from a palette + font scale.
 * Compact by default (owner direction 2026-10-03): tight paddings, small radii,
 * delicate type. Font sizes multiply by the user's font-size setting; the OS
 * text-size setting still applies via allowFontScaling (untouched).
 */
export function createThemedStyles(p: UIPalette, scale: number) {
  const fs = (base: number): number => Math.round(base * scale * 10) / 10;
  return StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center" },
    between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    text: { color: p.text, fontSize: fs(15), lineHeight: fs(23) },
    muted: { color: p.muted, fontSize: fs(14), lineHeight: fs(21) },
    small: { color: p.muted, fontSize: fs(11), lineHeight: fs(17) },
    label: {
      color: p.muted,
      fontSize: fs(10),
      fontWeight: "700",
      letterSpacing: 1.4,
      textTransform: "uppercase",
    },
    title: { color: p.text, fontSize: fs(20), fontWeight: "600", letterSpacing: -0.5 },
    heading: { color: p.text, fontSize: fs(15), fontWeight: "600", letterSpacing: -0.25 },
    card: {
      backgroundColor: p.card,
      borderRadius: 18,
      borderWidth: 0,
      borderColor: p.line,
      padding: 16,
    },
    divider: { height: 1, backgroundColor: p.line, marginVertical: 14 },
    input: {
      borderWidth: 1,
      borderColor: p.line,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 10,
      color: p.text,
      fontSize: fs(15),
      backgroundColor: p.inputBg,
      minHeight: 42,
    },
    field: { gap: 7, marginBottom: 14 },
    button: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingHorizontal: 14,
      minHeight: 38,
      paddingVertical: 8,
      borderRadius: 19,
    },
    primary: { backgroundColor: p.blue },
    secondary: { backgroundColor: p.secondaryBg },
    buttonText: { fontSize: fs(13), fontWeight: "600" },
    chip: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 12,
      alignSelf: "flex-start",
      backgroundColor: p.canvas,
    },
    chipText: { fontSize: fs(10), fontWeight: "600", color: p.muted },
    iconBox: {
      width: 38,
      height: 38,
      borderRadius: 12,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: p.sky,
    },
    error: {
      padding: 12,
      borderRadius: 12,
      backgroundColor: p.errorBg,
      marginVertical: 8,
      gap: 4,
    },
    modalShade: {
      flex: 1,
      backgroundColor: p.scrim,
      justifyContent: "center",
      alignItems: "center",
      padding: 16,
    },
    sheet: {
      backgroundColor: p.canvas,
      borderRadius: 20,
      width: "100%",
      maxWidth: 790,
      maxHeight: "94%",
      overflow: "hidden",
      borderWidth: 1,
      borderColor: p.line,
    },
  });
}

export type ThemedStyles = ReturnType<typeof createThemedStyles>;

/**
 * Reactive palette: re-computed whenever the theme bundle or mode changes.
 * Replaces the old static `colors` export — call this inside a component and
 * all `colors.*` reads below stay working while following the live theme.
 */
export function useColors(): UIPalette {
  const { tokens, resolvedMode } = useTheme();
  return useMemo(() => paletteFromTokens(tokens, resolvedMode), [tokens, resolvedMode]);
}

/**
 * Reactive stylesheet: rebuilt when the palette or the font-size setting
 * changes. Replaces the old static `s` export.
 *
 * The font-size option lives in a shared module-level store (app-settings),
 * so changing the option in Settings propagates live to every consumer.
 */
export function useStyles(): ThemedStyles {
  const colors = useColors();
  const { scale } = useFontSizeSetting();
  return useMemo(() => createThemedStyles(colors, scale), [colors, scale]);
}

export function Button({
  children,
  onPress,
  icon: Icon,
  primary,
  disabled,
  busy,
  small,
  danger,
  style,
}: {
  children: ReactNode;
  onPress: () => void;
  icon?: LucideIcon;
  primary?: boolean;
  disabled?: boolean;
  busy?: boolean;
  small?: boolean;
  danger?: boolean;
  style?: ViewStyle;
}) {
  const colors = useColors();
  const s = useStyles();
  const fg = primary ? colors.onBlue : danger ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        primary ? s.primary : s.secondary,
        small && { minHeight: 34, paddingVertical: 6, paddingHorizontal: 12 },
        (disabled || busy) && { opacity: 0.5 },
        pressed && { transform: [{ scale: 0.98 }] },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} size="small" />
      ) : Icon ? (
        <Icon size={15} color={fg} />
      ) : null}
      <TText style={[s.buttonText, { color: fg }]}>{children}</TText>
    </Pressable>
  );
}
export function IconButton({
  icon: Icon,
  label,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        {
          width: 40,
          height: 40,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 20,
          backgroundColor: pressed ? colors.line : colors.card,
        },
      ]}
    >
      <Icon size={20} strokeWidth={1.8} color={colors.text} />
    </Pressable>
  );
}
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const s = useStyles();
  return <View style={[s.card, style]}>{children}</View>;
}
export function Chip({ children, tint }: { children: ReactNode; tint?: string }) {
  const s = useStyles();
  return (
    <View style={[s.chip, tint ? { backgroundColor: tint } : null]}>
      <TText style={s.chipText}>{children}</TText>
    </View>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const colors = useColors();
  const s = useStyles();
  return (
    <View style={s.field}>
      <TText style={[s.small, { fontWeight: "600", color: colors.text }]}>{label}</TText>
      <TextInput
        placeholderTextColor={colors.muted}
        accessibilityLabel={label}
        {...props}
        style={[
          s.input,
          props.multiline && { minHeight: 120, textAlignVertical: "top" },
          props.style,
        ]}
      />
    </View>
  );
}
export function Empty({
  icon: Icon,
  title,
  detail,
  children,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
  children?: ReactNode;
}) {
  const colors = useColors();
  const s = useStyles();
  return (
    <View style={{ alignItems: "center", padding: 40, gap: 13 }}>
      <View style={[s.iconBox, { width: 55, height: 55, borderRadius: 18 }]}>
        <Icon size={24} color={colors.blueDark} />
      </View>
      <TText style={s.heading}>{title}</TText>
      <TText style={[s.muted, { textAlign: "center", maxWidth: 360 }]}>{detail}</TText>
      {children}
    </View>
  );
}
export function ErrorNotice({ error }: { error?: string }) {
  const colors = useColors();
  const s = useStyles();
  return error ? (
    <View accessibilityRole="alert" style={s.error}>
      <TText style={[s.text, { color: colors.danger }]}>{error}</TText>
    </View>
  ) : null;
}
export function Sheet({
  title,
  subtitle,
  children,
  onClose,
  wide,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const colors = useColors();
  const s = useStyles();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width < 600;
  return (
    <Modal transparent animationType={compact ? "slide" : "fade"} visible onRequestClose={onClose}>
      <View style={[s.modalShade, compact && { padding: 0, justifyContent: "flex-end" }]}>
        <View
          accessibilityViewIsModal
          style={[
            s.sheet,
            wide && { maxWidth: 1050 },
            compact && {
              borderBottomLeftRadius: 0,
              borderBottomRightRadius: 0,
              paddingBottom: Math.max(insets.bottom, 12),
              maxHeight: "94%",
            },
          ]}
        >
          {compact && (
            <View
              style={{
                alignSelf: "center",
                width: 34,
                height: 4,
                borderRadius: 3,
                backgroundColor: colors.line,
                marginTop: 10,
              }}
            />
          )}
          <View
            style={[
              s.between,
              { padding: compact ? 20 : 24, borderBottomWidth: 1, borderBottomColor: colors.line },
            ]}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <TText style={s.title}>{title}</TText>
              {!!subtitle && <TText style={s.muted}>{subtitle}</TText>}
            </View>
            <IconButton icon={X} label={t("ui.closeDetails")} onPress={onClose} />
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: compact ? 20 : 24 }}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
export function CheckRow({
  label,
  checked,
  onPress,
}: {
  label: string;
  checked: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const s = useStyles();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onPress}
      style={[s.row, { gap: 10, paddingVertical: 9 }]}
    >
      <View
        style={{
          width: 19,
          height: 19,
          borderRadius: 5,
          borderWidth: 1,
          borderColor: checked ? colors.text : colors.line,
          backgroundColor: checked ? colors.text : colors.card,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked && <Check size={13} color={colors.checkOn} />}
      </View>
      <TText style={[s.text, { flex: 1 }]}>{label}</TText>
    </Pressable>
  );
}
export function SectionHeading({
  title,
  action,
  onPress,
}: {
  title: string;
  action?: string;
  onPress?: () => void;
}) {
  const colors = useColors();
  const s = useStyles();
  return (
    <View style={[s.between, { marginBottom: 19 }]}>
      <TText style={s.heading}>{title}</TText>
      {action && onPress && (
        <Pressable accessibilityRole="button" onPress={onPress} style={[s.row, { gap: 5 }]}>
          <TText style={[s.small, { color: colors.text }]}>{action}</TText>
          <ArrowUpRight size={13} color={colors.muted} />
        </Pressable>
      )}
    </View>
  );
}
export function LinkRow({
  title,
  detail,
  onPress,
  icon: Icon,
  tint,
}: {
  title: string;
  detail?: string;
  onPress: () => void;
  icon: LucideIcon;
  tint?: string;
}) {
  const colors = useColors();
  const s = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        { paddingVertical: 13, gap: 14, borderRadius: 10 },
        pressed && { backgroundColor: colors.canvas },
      ]}
    >
      <View style={[s.iconBox, { backgroundColor: tint || colors.sky }]}>
        <Icon size={19} color={colors.text} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <TText style={[s.text, { fontWeight: "500" }]}>{title}</TText>
        {!!detail && <TText style={s.small}>{detail}</TText>}
      </View>
      <ChevronRight size={15} color={colors.muted} />
    </Pressable>
  );
}
/** The owner's devil sticker mascot — the default assistant face, shared by every assistant surface. */
export function Mascot({
  size = 42,
  index = DEFAULT_MASCOT_INDEX,
}: {
  size?: number;
  index?: number;
}) {
  return (
    <Image
      accessibilityRole="image"
      accessibilityLabel={t("a11y.aiAvatar")}
      source={mascotSource(index)}
      resizeMode="cover"
      style={{ width: size, height: size, borderRadius: size / 2 }}
    />
  );
}
export function dateLabel(value: string, options?: Intl.DateTimeFormatOptions) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, options || { month: "short", day: "numeric" });
}
export function timeLabel(value: string, timeZone?: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone });
}
export function relativeDate(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  return diff < 60_000
    ? t("date.justNow")
    : diff < 3600_000
      ? t("date.minAgo", { count: Math.floor(diff / 60_000) })
      : diff < 86400_000
        ? t("date.hourAgo", { count: Math.floor(diff / 3600_000) })
        : dateLabel(value);
}

export function resultSummary(value: string) {
  return /^Saved to (?:sample|local) sent mail(?: · .+)?$/.test(value)
    ? t("mail.replySaved")
    : value;
}
