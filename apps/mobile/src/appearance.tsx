/**
 * AppearanceScreen — 设置 → 外观 (theme-design.md §5 items 1–5, §6).
 *
 * Safety model (the §6 four-piece, all required):
 *  - try-on: every edit builds a draft bundle and calls stageBundle() —
 *    in-memory only, never persisted (§6.1). A persistent banner offers
 *    Apply / Discard while staging.
 *  - confirm: Apply calls applyBundle() → persisted to AsyncStorage and
 *    PUT to /api/theme (§6.2).
 *  - rollback: one tap restores the last confirmed bundle (§6.3).
 *  - self-heal: a corrupt stored bundle is rebuilt by ThemeProvider (§6.4).
 * No version history list, no import/export — those are Phase 1b.
 *
 * Styling rule: no color literals in UI chrome — every fill, text and
 * border comes from useTheme() tokens. (SWATCHES below is picker *data*,
 * the palette the user picks from — not UI chrome.)
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import {
  ImagePlus,
  MonitorSmartphone,
  Moon,
  RotateCcw,
  Sun,
  Trash2,
  User,
  X,
} from "lucide-react-native";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { type FontSizeOption, useFontSizeSetting } from "./app-settings";
import { type StringKey, t } from "./i18n";
import { makeThemeBundle, normalizeHex } from "./theme/derive";
import { PRESETS } from "./theme/presets";
import { useTheme } from "./theme/ThemeContext";
import {
  isThemeBundle,
  type SurfaceId,
  type SurfaceTokens,
  type ThemeBundle,
  type ThemeMode,
} from "./theme/types";
import { Button, Card, Field, Mascot, SectionHeading, useColors } from "./ui";

type Tokens = Record<SurfaceId, SurfaceTokens>;

const CUSTOMS_KEY = "openmuse.theme.customPresets.v1";
const APPEARANCE_DIR = "openmuse/appearance";

/** Picker palette data — the colors the user chooses from. Not UI chrome. */
const SWATCHES = [
  "#3f9b8a",
  "#5b9bd5",
  "#9b8afb",
  "#b98aa5",
  "#cf6a4d",
  "#e0a458",
  "#8fbf6a",
  "#4d9b7a",
  "#5aa9c9",
  "#7a6ff0",
  "#c95a7a",
  "#6b7280",
] as const;

/** Built-in preset names are i18n keys; user-saved names are plain text. */
function displayName(bundle: ThemeBundle): string {
  return bundle.name.startsWith("theme.preset.")
    ? t(bundle.name as unknown as StringKey)
    : bundle.name;
}

function validHex(value: string): string | null {
  try {
    return normalizeHex(value);
  } catch {
    return null;
  }
}

type DraftSeed = { primary: string; secondary: string; accent: string };

function seedFromBundle(bundle: ThemeBundle): DraftSeed {
  return {
    primary: bundle.seed.primary,
    secondary: bundle.seed.secondary ?? bundle.seed.primary,
    accent: bundle.seed.tertiary ?? bundle.seed.primary,
  };
}

export function AppearanceScreen() {
  const { bundle, staging, tokens, stageBundle, cancelStage, applyBundle, rollback } = useTheme();
  const colors = useColors();
  const { option: fontOption, setOption: setFontOption, scale: fontScale } = useFontSizeSetting();
  const [customs, setCustoms] = useState<ThemeBundle[]>([]);
  const [draft, setDraft] = useState<DraftSeed>(() => seedFromBundle(bundle));
  const [customName, setCustomName] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  // Load user-saved custom presets (after the built-ins).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(CUSTOMS_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        const list = Array.isArray(parsed) ? parsed.filter(isThemeBundle) : [];
        if (!cancelled) setCustoms(list);
      } catch {
        // Corrupt customs list: start empty, never break the screen.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-sync the color draft when the user picks a different base
  // (preset tap, saved custom, rollback, apply).
  useEffect(() => {
    setDraft(seedFromBundle(bundle));
  }, [bundle.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const tryOn = useCallback(
    (next: ThemeBundle) => {
      setNotice("");
      stageBundle(next);
    },
    [stageBundle],
  );

  const setMode = (mode: ThemeMode) => {
    if (mode !== bundle.mode) tryOn({ ...bundle, mode });
  };

  const withSeed = (seed: DraftSeed): ThemeBundle =>
    makeThemeBundle({
      id: bundle.id,
      name: bundle.name,
      seed: { primary: seed.primary, secondary: seed.secondary, tertiary: seed.accent },
      mode: bundle.mode,
      ...(bundle.wallpaper ? { wallpaper: bundle.wallpaper } : {}),
      ...(bundle.avatar ? { avatar: bundle.avatar } : {}),
    });

  const commitColor = (key: keyof DraftSeed, text: string) => {
    const next = { ...draft, [key]: text };
    setDraft(next);
    const p = validHex(next.primary);
    const s = validHex(next.secondary);
    const a = validHex(next.accent);
    if (!p || !s || !a) return; // wait until every field is a valid hex
    tryOn(withSeed({ primary: p, secondary: s, accent: a }));
  };

  const saveCustom = async () => {
    const name = customName.trim();
    if (!name) {
      setNotice(t("appearance.nameRequired"));
      return;
    }
    const p = validHex(draft.primary) ?? bundle.seed.primary;
    const s = validHex(draft.secondary) ?? p;
    const a = validHex(draft.accent) ?? p;
    const saved = makeThemeBundle({
      id: `custom-${Date.now()}`,
      name,
      seed: { primary: p, secondary: s, tertiary: a },
      mode: bundle.mode,
      ...(bundle.wallpaper ? { wallpaper: bundle.wallpaper } : {}),
      ...(bundle.avatar ? { avatar: bundle.avatar } : {}),
    });
    setBusy(true);
    try {
      const next = [...customs, saved];
      await AsyncStorage.setItem(CUSTOMS_KEY, JSON.stringify(next));
      setCustoms(next);
      setCustomName("");
      setNotice(t("appearance.saved"));
      tryOn(saved);
    } catch {
      setNotice(t("appearance.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const tryPreset = (preset: ThemeBundle) => {
    tryOn({
      ...preset,
      ...(bundle.wallpaper ? { wallpaper: bundle.wallpaper } : {}),
      ...(bundle.avatar ? { avatar: bundle.avatar } : {}),
    });
  };

  const pickImage = useCallback(async (): Promise<string | null> => {
    setNotice("");
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setNotice(t("appearance.permissionDenied"));
      return null;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 0.85,
    });
    const src = !res.canceled ? res.assets?.[0]?.uri : undefined;
    if (!src) return null;
    const dir = `${FileSystem.documentDirectory ?? ""}${APPEARANCE_DIR}/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    const dest = `${dir}${Date.now()}.jpg`;
    await FileSystem.copyAsync({ from: src, to: dest });
    return dest;
  }, []);

  const pickWallpaper = async () => {
    try {
      const uri = await pickImage();
      if (!uri) return;
      tryOn({
        ...bundle,
        wallpaper: { uri, fit: "cover", dim: bundle.wallpaper?.dim ?? 0.35 },
      });
    } catch {
      setNotice(t("appearance.saveFailed"));
    }
  };

  const removeWallpaper = () => {
    const next = { ...bundle };
    delete next.wallpaper;
    tryOn(next);
  };

  const setDim = (dim: number) => {
    if (!bundle.wallpaper) return;
    const clamped = Math.min(1, Math.max(0, Math.round(dim * 100) / 100));
    tryOn({ ...bundle, wallpaper: { ...bundle.wallpaper, dim: clamped } });
  };

  const pickAvatar = async (who: "user" | "assistant") => {
    try {
      const uri = await pickImage();
      if (!uri) return;
      tryOn({ ...bundle, avatar: { ...(bundle.avatar ?? {}), [who]: uri } });
    } catch {
      setNotice(t("appearance.saveFailed"));
    }
  };

  const restoreAvatar = (who: "user" | "assistant") => {
    const avatar = { ...(bundle.avatar ?? {}) };
    delete avatar[who];
    const next = { ...bundle };
    if (avatar.user || avatar.assistant) {
      next.avatar = avatar;
    } else {
      delete next.avatar;
    }
    tryOn(next);
  };

  const fg = tokens.text.fg;

  return (
    <View style={{ gap: 26 }}>
      {notice ? <Text style={{ color: fg, fontSize: 13 }}>{notice}</Text> : null}

      {staging ? (
        <View
          style={{
            backgroundColor: tokens.accent.bg,
            borderRadius: 14,
            padding: 14,
            gap: 10,
          }}
        >
          <Text style={{ color: tokens.accent.fg, fontSize: 14, fontWeight: "600" }}>
            {t("appearance.tryOn")}
          </Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button
              small
              primary
              onPress={() => {
                void applyBundle(bundle).then((result) => {
                  setNotice(
                    result === "ok"
                      ? t("appearance.applied")
                      : result === "local-only"
                        ? t("appearance.appliedLocal")
                        : t("appearance.saveFailed"),
                  );
                });
              }}
            >
              {t("appearance.apply")}
            </Button>
            <Button
              small
              icon={X}
              onPress={() => {
                cancelStage();
                setNotice(t("appearance.discarded"));
              }}
            >
              {t("appearance.discard")}
            </Button>
          </View>
        </View>
      ) : null}

      <View>
        <SectionHeading title={t("appearance.modeLabel")} />
        <View style={{ flexDirection: "row", gap: 8 }}>
          {(
            [
              { mode: "system", icon: MonitorSmartphone, label: t("appearance.mode.system") },
              { mode: "light", icon: Sun, label: t("appearance.mode.light") },
              { mode: "dark", icon: Moon, label: t("appearance.mode.dark") },
            ] as const
          ).map((item) => {
            const selected = bundle.mode === item.mode;
            const Icon = item.icon;
            return (
              <Pressable
                key={item.mode}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={item.label}
                onPress={() => setMode(item.mode)}
                style={{
                  flex: 1,
                  alignItems: "center",
                  gap: 6,
                  paddingVertical: 12,
                  borderRadius: 12,
                  backgroundColor: selected ? tokens.accent.bg : tokens.card.bg,
                }}
              >
                <Icon size={20} color={selected ? tokens.accent.fg : fg} />
                <Text
                  style={{
                    color: selected ? tokens.accent.fg : fg,
                    fontSize: 12,
                    fontWeight: selected ? "600" : "400",
                  }}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View>
        <SectionHeading title={t("appearance.fontSizeLabel")} />
        <View style={{ flexDirection: "row", gap: 8 }}>
          {(
            [
              { option: "system", label: t("appearance.fontSize.system"), preview: 11 },
              { option: "small", label: t("appearance.fontSize.small"), preview: 10 },
              { option: "standard", label: t("appearance.fontSize.standard"), preview: 13 },
              { option: "large", label: t("appearance.fontSize.large"), preview: 16 },
            ] as const
          ).map((item) => {
            const selected = fontOption === item.option;
            return (
              <Pressable
                key={item.option}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={item.label}
                onPress={() => void setFontOption(item.option as FontSizeOption)}
                style={{
                  flex: 1,
                  alignItems: "center",
                  gap: 4,
                  paddingVertical: 10,
                  borderRadius: 12,
                  backgroundColor: selected ? tokens.accent.bg : tokens.card.bg,
                }}
              >
                <Text
                  style={{
                    color: selected ? tokens.accent.fg : fg,
                    fontSize: item.preview,
                    fontWeight: "700",
                  }}
                >
                  A
                </Text>
                <Text
                  style={{
                    color: selected ? tokens.accent.fg : fg,
                    fontSize: 11,
                    fontWeight: selected ? "600" : "400",
                  }}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View>
        <SectionHeading title={t("appearance.presetsLabel")} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: "row", gap: 12, paddingRight: 4 }}>
            {[...PRESETS, ...customs].map((preset) => {
              const selected = bundle.id === preset.id;
              return (
                <Pressable
                  key={preset.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={displayName(preset)}
                  onPress={() => tryPreset(preset)}
                  style={{
                    alignItems: "center",
                    gap: 8,
                    padding: 12,
                    borderRadius: 14,
                    minWidth: 92,
                    backgroundColor: tokens.card.bg,
                    borderWidth: selected ? 2 : 1,
                    borderColor: selected
                      ? tokens.accent.accent
                      : (tokens.card.border ?? tokens.card.bg),
                  }}
                >
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      backgroundColor: preset.seed.primary,
                    }}
                  />
                  <Text
                    style={{ color: fg, fontSize: 12, fontWeight: selected ? "600" : "400" }}
                    numberOfLines={1}
                  >
                    {displayName(preset)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>

      <View>
        <SectionHeading title={t("appearance.customLabel")} />
        <Card style={{ gap: 14 }}>
          {(
            [
              { key: "primary", label: t("appearance.primary") },
              { key: "secondary", label: t("appearance.secondary") },
              { key: "accent", label: t("appearance.accent") },
            ] as const
          ).map((row) => (
            <View key={row.key} style={{ gap: 8 }}>
              <Text style={{ color: fg, fontSize: 13, fontWeight: "600" }}>{row.label}</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {SWATCHES.map((hex) => {
                  const selected = validHex(draft[row.key]) === hex;
                  return (
                    <Pressable
                      key={hex}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      accessibilityLabel={`${row.label} ${hex}`}
                      onPress={() => commitColor(row.key, hex)}
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        backgroundColor: hex,
                        borderWidth: selected ? 3 : 1,
                        borderColor: selected
                          ? tokens.accent.accent
                          : (tokens.card.border ?? tokens.card.bg),
                      }}
                    />
                  );
                })}
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <TextInput
                  value={draft[row.key]}
                  onChangeText={(text) => commitColor(row.key, text)}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={t("appearance.hexHint")}
                  placeholderTextColor={tokens.input.fg}
                  accessibilityLabel={`${row.label} hex`}
                  style={{
                    flex: 1,
                    color: fg,
                    fontSize: 14,
                    paddingVertical: 9,
                    paddingHorizontal: 12,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: tokens.input.border ?? tokens.card.border ?? tokens.card.bg,
                    backgroundColor: tokens.input.bg,
                  }}
                />
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    backgroundColor: validHex(draft[row.key]) ?? tokens.card.bg,
                    borderWidth: 1,
                    borderColor: tokens.card.border ?? tokens.card.bg,
                  }}
                />
              </View>
            </View>
          ))}

          <View style={{ gap: 8 }}>
            <Text style={{ color: fg, fontSize: 13, fontWeight: "600" }}>
              {t("appearance.preview")}
            </Text>
            <View style={{ gap: 8 }}>
              <View
                style={{
                  alignSelf: "flex-start",
                  maxWidth: "85%",
                  backgroundColor: tokens.aiBubble.bg,
                  borderRadius: tokens.aiBubble.radius ?? 16,
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                }}
              >
                <Text style={{ color: tokens.aiBubble.fg, fontSize: Math.round(14 * fontScale) }}>
                  {t("appearance.sampleAi")}
                </Text>
              </View>
              <View
                style={{
                  alignSelf: "flex-end",
                  maxWidth: "85%",
                  backgroundColor: tokens.userBubble.bg,
                  borderRadius: tokens.userBubble.radius ?? 16,
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                }}
              >
                <Text style={{ color: tokens.userBubble.fg, fontSize: Math.round(14 * fontScale) }}>
                  {t("appearance.sampleUser")}
                </Text>
              </View>
            </View>
          </View>

          <Field
            label={t("appearance.nameLabel")}
            value={customName}
            onChangeText={setCustomName}
            placeholder={t("appearance.namePlaceholder")}
          />
          <Button busy={busy} primary onPress={() => void saveCustom()}>
            {t("appearance.save")}
          </Button>
        </Card>
      </View>

      <View>
        <SectionHeading title={t("appearance.wallpaperLabel")} />
        <Card style={{ gap: 14 }}>
          {bundle.wallpaper ? (
            <View style={{ borderRadius: 12, overflow: "hidden" }}>
              <Image
                source={{ uri: bundle.wallpaper.uri }}
                style={{ width: "100%", height: 140 }}
                resizeMode="cover"
              />
              <View
                pointerEvents="none"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: colors.scrim,
                  opacity: bundle.wallpaper.dim,
                }}
              />
            </View>
          ) : null}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button small icon={ImagePlus} onPress={() => void pickWallpaper()}>
              {t("appearance.pickWallpaper")}
            </Button>
            {bundle.wallpaper ? (
              <Button small danger icon={Trash2} onPress={removeWallpaper}>
                {t("appearance.removeWallpaper")}
              </Button>
            ) : null}
          </View>
          {bundle.wallpaper ? (
            <View style={{ gap: 6 }}>
              <Text style={{ color: fg, fontSize: 13, fontWeight: "600" }}>
                {t("appearance.dimLabel")} · {Math.round(bundle.wallpaper.dim * 100)}%
              </Text>
              <DimSlider value={bundle.wallpaper.dim} onChange={setDim} tokens={tokens} />
            </View>
          ) : null}
        </Card>
      </View>

      <View>
        <SectionHeading title={t("appearance.avatarLabel")} />
        <Card style={{ gap: 16 }}>
          <AvatarRow
            label={t("appearance.myAvatar")}
            uri={bundle.avatar?.user}
            tokens={tokens}
            fallback={
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  backgroundColor: tokens.card.bg,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1,
                  borderColor: tokens.card.border ?? tokens.card.bg,
                }}
              >
                <User size={22} color={fg} />
              </View>
            }
            onPick={() => void pickAvatar("user")}
            onRestore={() => restoreAvatar("user")}
            canRestore={!!bundle.avatar?.user}
          />
          <AvatarRow
            label={t("appearance.aiAvatar")}
            uri={bundle.avatar?.assistant}
            tokens={tokens}
            fallback={<Mascot size={48} />}
            onPick={() => void pickAvatar("assistant")}
            onRestore={() => restoreAvatar("assistant")}
            canRestore={!!bundle.avatar?.assistant}
          />
        </Card>
      </View>

      <View>
        <SectionHeading title={t("appearance.safetyTitle")} />
        <Card style={{ gap: 12 }}>
          <Text style={{ color: fg, fontSize: 13 }}>{t("appearance.rollbackNote")}</Text>
          <Button small icon={RotateCcw} onPress={() => void rollback()}>
            {t("appearance.rollback")}
          </Button>
        </Card>
      </View>
    </View>
  );
}

function DimSlider({
  value,
  onChange,
  tokens,
}: {
  value: number;
  onChange: (v: number) => void;
  tokens: Tokens;
}) {
  const [width, setWidth] = useState(0);
  return (
    <Pressable
      accessibilityRole="adjustable"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
      accessibilityLabel={t("appearance.dimLabel")}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      onPress={(e) => {
        if (width > 0) onChange(e.nativeEvent.locationX / width);
      }}
      style={{ height: 36, justifyContent: "center" }}
    >
      <View
        style={{
          height: 8,
          borderRadius: 4,
          backgroundColor: tokens.card.bg,
          borderWidth: 1,
          borderColor: tokens.card.border ?? tokens.card.bg,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            width: `${Math.round(value * 100)}%`,
            height: "100%",
            backgroundColor: tokens.accent.accent,
          }}
        />
      </View>
      <View
        style={{
          position: "absolute",
          left: `${Math.round(value * 100)}%`,
          marginLeft: -9,
          width: 18,
          height: 18,
          borderRadius: 9,
          backgroundColor: tokens.accent.accent,
        }}
      />
    </Pressable>
  );
}

function AvatarRow({
  label,
  uri,
  tokens,
  fallback,
  onPick,
  onRestore,
  canRestore,
}: {
  label: string;
  uri?: string;
  tokens: Tokens;
  fallback: ReactNode;
  onPick: () => void;
  onRestore: () => void;
  canRestore: boolean;
}) {
  const fg = tokens.text.fg;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      {uri ? (
        <Image source={{ uri }} style={{ width: 48, height: 48, borderRadius: 24 }} />
      ) : (
        fallback
      )}
      <Text style={{ flex: 1, color: fg, fontSize: 14, fontWeight: "500" }}>{label}</Text>
      <Button small icon={ImagePlus} onPress={onPick}>
        {t("appearance.changeImage")}
      </Button>
      {canRestore ? (
        <Button small onPress={onRestore}>
          {t("appearance.restoreDefault")}
        </Button>
      ) : null}
    </View>
  );
}
