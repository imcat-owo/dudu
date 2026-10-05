/**
 * Task progress widget cards — iOS-widget-style small cards in 我们的空间.
 *
 * One card per background task: name, animated progress bar (shimmer +
 * smooth easing), stage text, status. Card background: user-uploaded image
 * or AI-generated (Pollinations, free), stored per-card.
 *
 * ALL colors from theme tokens via useColors() — zero hardcoded hex.
 * Zero emoji — lucide icons only.
 */

import * as ImagePicker from "expo-image-picker";
import { AlertCircle, CheckCircle2, Image as ImageIcon, Sparkles, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Alert, Animated, ImageBackground, Modal, Pressable, TextInput, View } from "react-native";
import { TText } from "../font";
import { GlassView } from "../glass";
import { type StringKey, t } from "../i18n";
import { buildImageUrl } from "../image-generation";
import { SPRING, STAGGER } from "../motion";
import { ProgressBar } from "../progress-bar";
import { radii } from "../theme/radii";
import { shadows } from "../theme/shadows";
import { useColors } from "../ui";
import type { BackgroundTask, TaskCardAccent, TaskStatus } from "./task-progress";
import { TASK_CARD_ACCENTS } from "./task-progress";
import { taskProgressStore } from "./task-progress-instance";

/**
 * Accent key → theme palette field. Pastel washi-tape colors: visible on
 * cards yet derived from the active theme (light/dark safe). null/absent
 * accent falls back to the vivid theme blue (the card's original look).
 */
const ACCENT_TOKEN: Record<
  TaskCardAccent,
  "tapePink" | "tapeBlue" | "tapeMint" | "tapeYellow" | "tapeLavender"
> = {
  pink: "tapePink",
  blue: "tapeBlue",
  mint: "tapeMint",
  yellow: "tapeYellow",
  lavender: "tapeLavender",
};

function useTaskVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => taskProgressStore.subscribe(() => setV((x) => x + 1)), []);
  return v;
}

function statusLabel(status: TaskStatus): StringKey {
  switch (status) {
    case "done":
      return "space.tasks.status.done";
    case "stuck":
      return "space.tasks.status.stuck";
    default:
      return "space.tasks.status.running";
  }
}

function TaskCard({ task, index }: { task: BackgroundTask; index: number }) {
  const colors = useColors();
  const [menuOpen, setMenuOpen] = useState(false);
  const [genPrompt, setGenPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const pct = Math.round(task.progress * 100);

  // Card accent: curated pastel key → theme token. null = vivid theme blue
  // (the card's original look — existing cards don't change).
  const accentColor = task.accent ? colors[ACCENT_TOKEN[task.accent]] : colors.blue;
  // Status tint: stuck reads as a warning (danger), otherwise the accent.
  const statusColor = task.status === "stuck" ? colors.danger : accentColor;

  // Cute springy entrance, staggered per card.
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const id = setTimeout(() => {
      Animated.spring(enter, { ...SPRING.gentle, toValue: 1, useNativeDriver: true }).start();
    }, STAGGER.item * index);
    return () => clearTimeout(id);
  }, [enter, index]);

  const pickBackground = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: "images",
        allowsEditing: true,
        aspect: [16, 10],
        quality: 0.8,
      });
      if (!res.canceled && res.assets[0]) {
        await taskProgressStore.setBackground(task.id, res.assets[0].uri);
        await taskProgressStore.saveIndex();
      }
    } catch {
      // Picker cancelled — stay as-is.
    } finally {
      setMenuOpen(false);
    }
  };

  const generateBackground = async () => {
    const prompt = genPrompt.trim() || task.name;
    setGenerating(true);
    try {
      const url = buildImageUrl(prompt, { width: 800, height: 500, seed: Date.now() % 1000000 });
      await taskProgressStore.setBackground(task.id, url);
      await taskProgressStore.saveIndex();
    } catch {
      // Generation/storage failed — tell her, don't just stop the spinner.
      Alert.alert(
        t("space.tasks.bgFailedTitle") as string,
        t("space.tasks.bgFailedBody") as string,
        [{ text: t("common.confirm") as string, style: "cancel" }],
      );
    } finally {
      setGenerating(false);
      setMenuOpen(false);
      setGenPrompt("");
    }
  };

  const clearBackground = async () => {
    await taskProgressStore.setBackground(task.id, null);
    await taskProgressStore.saveIndex();
    setMenuOpen(false);
  };

  const setAccent = async (accent: TaskCardAccent | null) => {
    await taskProgressStore.setAccent(task.id, accent);
    await taskProgressStore.saveIndex();
    setMenuOpen(false);
  };

  const dismissTask = () => {
    Alert.alert(t("space.tasks.dismissTitle") as string, t("space.tasks.dismissBody") as string, [
      { text: t("common.cancel") as string, style: "cancel" },
      {
        text: t("common.confirm") as string,
        style: "destructive",
        onPress: () => {
          void taskProgressStore.remove(task.id).then(() => taskProgressStore.saveIndex());
        },
      },
    ]);
  };

  const cardContent = (
    <View style={{ padding: 16, gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <TText style={{ color: colors.text, fontSize: 15, fontWeight: "700" }} numberOfLines={1}>
            {task.name}
          </TText>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            {task.status === "done" ? (
              <CheckCircle2 size={12} color={accentColor} />
            ) : task.status === "stuck" ? (
              <AlertCircle size={12} color={colors.danger} />
            ) : null}
            <TText style={{ color: statusColor, fontSize: 11.5, fontWeight: "600" }}>
              {t(statusLabel(task.status))} · {pct}%
            </TText>
          </View>
          {/* P3-8: a stuck card used to say only "卡住了" + delete. Say
              what happened in human words. */}
          {task.status === "stuck" ? (
            <TText style={{ color: colors.muted, fontSize: 11.5 }}>
              {t("space.tasks.stuckHint")}
            </TText>
          ) : null}
        </View>
        <Pressable onPress={() => setMenuOpen(true)} hitSlop={8}>
          <ImageIcon size={16} color={colors.muted} />
        </Pressable>
        <Pressable onPress={dismissTask} hitSlop={8}>
          <X size={16} color={colors.muted} />
        </Pressable>
      </View>
      <ProgressBar
        progress={task.progress}
        active={task.status === "running"}
        color={accentColor}
      />
      {!!task.stage && (
        <TText style={{ color: colors.muted, fontSize: 12.5, lineHeight: 18 }} numberOfLines={2}>
          {task.stage}
        </TText>
      )}
    </View>
  );

  return (
    <Animated.View
      style={{
        opacity: enter,
        transform: [
          { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) },
          { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
        ],
      }}
    >
      <View
        style={{
          borderRadius: radii.lg,
          overflow: "hidden",
          borderWidth: 1,
          // A finished card gets a soft accent ring — a quiet little celebration.
          borderColor: task.status === "done" ? accentColor : colors.line,
          marginBottom: 12,
        }}
      >
        {task.backgroundUri ? (
          <ImageBackground
            source={{ uri: task.backgroundUri }}
            style={{ width: "100%" }}
            imageStyle={{ opacity: 0.28 }}
          >
            <View style={{ backgroundColor: colors.scrim }}>{cardContent}</View>
          </ImageBackground>
        ) : (
          <GlassView intensity={40} style={{ borderRadius: radii.lg, ...shadows.card }}>
            {cardContent}
          </GlassView>
        )}

        <Modal
          visible={menuOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setMenuOpen(false)}
        >
          <Pressable
            style={{
              flex: 1,
              backgroundColor: colors.scrim,
              justifyContent: "center",
              padding: 32,
            }}
            onPress={() => setMenuOpen(false)}
          >
            <GlassView
              intensity={64}
              style={{ borderRadius: radii.lg, padding: 20, gap: 12, ...shadows.modal }}
            >
              <Pressable onPress={(e) => e.stopPropagation()}>
                <TText style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>
                  {t("space.tasks.bgTitle")}
                </TText>
                <Pressable
                  onPress={pickBackground}
                  style={{
                    backgroundColor: colors.secondaryBg,
                    borderRadius: radii.md,
                    padding: 14,
                  }}
                >
                  <TText style={{ color: colors.text, fontSize: 14 }}>
                    {t("space.tasks.bgUpload")}
                  </TText>
                </Pressable>
                <View style={{ gap: 8 }}>
                  <TextInput
                    value={genPrompt}
                    onChangeText={setGenPrompt}
                    placeholder={t("space.tasks.bgPromptHint") as string}
                    placeholderTextColor={colors.muted}
                    style={{
                      backgroundColor: colors.inputBg,
                      borderRadius: radii.md,
                      padding: 12,
                      color: colors.text,
                      fontSize: 14,
                    }}
                  />
                  <Pressable
                    onPress={generateBackground}
                    disabled={generating}
                    style={{
                      backgroundColor: colors.blue,
                      borderRadius: radii.md,
                      padding: 14,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      opacity: generating ? 0.6 : 1,
                    }}
                  >
                    <Sparkles size={15} color={colors.onBlue} />
                    <TText style={{ color: colors.onBlue, fontSize: 14, fontWeight: "600" }}>
                      {generating ? t("space.tasks.bgGenerating") : t("space.tasks.bgGenerate")}
                    </TText>
                  </Pressable>
                </View>
                {task.backgroundUri && (
                  <Pressable onPress={clearBackground}>
                    <TText style={{ color: colors.danger, fontSize: 14, textAlign: "center" }}>
                      {t("space.tasks.bgClear")}
                    </TText>
                  </Pressable>
                )}
                <TText style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>
                  {t("space.tasks.accentTitle")}
                </TText>
                <View
                  style={{ flexDirection: "row", gap: 10, alignItems: "center", flexWrap: "wrap" }}
                >
                  {(["default", ...TASK_CARD_ACCENTS] as const).map((key) => {
                    const selected = (task.accent ?? "default") === key;
                    const isDefault = key === "default";
                    return (
                      <Pressable
                        key={key}
                        onPress={() => void setAccent(isDefault ? null : key)}
                        hitSlop={6}
                        accessibilityLabel={t(`space.tasks.accent.${key}` as StringKey) as string}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 16,
                          backgroundColor: isDefault ? colors.card : colors[ACCENT_TOKEN[key]],
                          borderWidth: selected ? 2.5 : 1.5,
                          borderColor: selected ? colors.text : colors.line,
                        }}
                      />
                    );
                  })}
                </View>
              </Pressable>
            </GlassView>
          </Pressable>
        </Modal>
      </View>
    </Animated.View>
  );
}

/** Widget-style task cards section for 我们的空间 → 状态 tab. */
export function TaskCards() {
  useTaskVersion();
  const tasks = taskProgressStore.list();
  if (tasks.length === 0) return null;
  return (
    <View style={{ marginTop: 16 }}>
      {tasks.map((task, i) => (
        <TaskCard key={task.id} task={task} index={i} />
      ))}
    </View>
  );
}
