/**
 * Task progress widget cards — iOS-widget-style small cards in 我们的空间.
 *
 * One card per background task: name, animated progress bar (shimmer +
 * smooth easing), stage text, status. Card background: user-uploaded image
 * or AI-generated (Pollinations, free), stored per-card.
 *
 * ALL colors from theme tokens via useColors()/useTheme() — zero hardcoded hex.
 * Zero emoji — lucide icons only.
 */

import * as ImagePicker from "expo-image-picker";
import { Image as ImageIcon, Sparkles, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Easing,
  ImageBackground,
  Modal,
  Pressable,
  TextInput,
  View,
} from "react-native";
import { TText } from "../font";
import { type StringKey, t } from "../i18n";
import { buildImageUrl } from "../image-generation";
import { DUR, EASE, SPRING, STAGGER } from "../motion";
import { useTheme } from "../theme/ThemeContext";
import { useColors } from "../ui";
import { TaskBuddy } from "./task-buddy";
import type { BackgroundTask, TaskStatus } from "./task-progress";
import { taskProgressStore } from "./task-progress-instance";

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

/** Animated progress bar: smooth easing + shimmer sweep + cute blob tip. */
function ProgressBar({ progress, active }: { progress: number; active: boolean }) {
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

  return (
    <View
      style={{
        height: 10,
        borderRadius: 5,
        backgroundColor: colors.line,
      }}
    >
      <Animated.View
        style={{
          height: "100%",
          borderRadius: 5,
          backgroundColor: colors.blue,
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
              borderRadius: 5,
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
            right: -7,
            top: -2,
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: colors.blue,
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

function TaskCard({ task, index }: { task: BackgroundTask; index: number }) {
  const colors = useColors();
  const { tokens } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [genPrompt, setGenPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const pct = Math.round(task.progress * 100);

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
      // Generation failed — keep existing background.
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
        <TaskBuddy
          status={task.status}
          size={52}
          colors={{
            line: colors.text,
            fill: colors.sky,
            face: colors.text,
            accent: tokens.accent.fg,
          }}
        />
        <View style={{ flex: 1, gap: 2 }}>
          <TText style={{ color: colors.text, fontSize: 15, fontWeight: "700" }} numberOfLines={1}>
            {task.name}
          </TText>
          <TText style={{ color: colors.muted, fontSize: 11.5 }}>
            {t(statusLabel(task.status))} · {pct}%
          </TText>
        </View>
        <Pressable onPress={() => setMenuOpen(true)} hitSlop={8}>
          <ImageIcon size={16} color={colors.muted} />
        </Pressable>
        {task.status === "done" && (
          <Pressable onPress={dismissTask} hitSlop={8}>
            <X size={16} color={colors.muted} />
          </Pressable>
        )}
      </View>
      <ProgressBar progress={task.progress} active={task.status === "running"} />
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
          borderRadius: 22,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: colors.line,
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
          <View style={{ backgroundColor: colors.card }}>{cardContent}</View>
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
            <Pressable
              style={{ backgroundColor: colors.card, borderRadius: 20, padding: 20, gap: 12 }}
              onPress={(e) => e.stopPropagation()}
            >
              <TText style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>
                {t("space.tasks.bgTitle")}
              </TText>
              <Pressable
                onPress={pickBackground}
                style={{ backgroundColor: colors.secondaryBg, borderRadius: 12, padding: 14 }}
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
                    borderRadius: 12,
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
                    borderRadius: 12,
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
            </Pressable>
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
