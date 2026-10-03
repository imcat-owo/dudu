/**
 * 我们的空间 — Our Space. The part of the app that belongs to the two of them.
 *
 * Five areas, ALL dialog-driven and AI-operated — she never edits manually:
 * - status:    my status (doing / background / stuck)
 * - diary:     my diary, written for the two of them
 * - timeline:  我们的时光 — shared moments, told like a story
 * - garden:    memory garden — blooming / sprouting / ask her, alive
 * - tellLater: 稍后告诉她 — queue she checks off
 *
 * Sora gray hand-drawn aesthetic: warm grays, soft asymmetric radii,
 * generous whitespace, quiet typography. Zero emoji — lucide icons only.
 * Every pixel earns its place; she judges with her eyes.
 */

import * as ImagePicker from "expo-image-picker";
import {
  Activity,
  Bell,
  BookOpen,
  CalendarHeart,
  Camera,
  Check,
  ChevronLeft,
  Flower2,
  Headphones,
  Heart,
  History,
  Images,
  MessageCircle,
  MessageCircleQuestion,
  MoonStar,
  Send,
  Sprout,
} from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { soraSource } from "./avatar-assets";
import { TText } from "./font";
import { type StringKey, t } from "./i18n";
import { memoryStore } from "./memory/instance";
import type { MemoryRecord } from "./memory/types";
import { gardenStateOf } from "./memory/types";
import { DUR, EASE, exitDuration, STAGGER } from "./motion";
import { MusicRoomPage } from "./music-ui";
import { ourSpaceStore } from "./our-space/instance";
import type {
  AiStatus,
  Anniversary,
  CoupleProfile,
  DiaryEntry,
  FeedAuthor,
  FeedPost,
  FeedReply,
  MemoryConfidence,
  TellLaterItem,
  TimelineEvent,
  WorkItem,
  WorkType,
} from "./our-space/store";
import { taskBuddyVideoStore } from "./our-space/task-buddy-video-instance";
import { TaskCards } from "./our-space/task-cards-ui";
import { taskProgressStore } from "./our-space/task-progress-instance";
import { SoraAmbient } from "./sora-ambient";
import { ambientVideoStore } from "./sora-ambient-video-instance";
import { useTheme } from "./theme/ThemeContext";
import { useColors } from "./ui";

type SpaceTab = "status" | "diary" | "timeline" | "garden" | "tellLater";

export function useOurSpaceVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => ourSpaceStore.subscribe(() => setV((x) => x + 1)), []);
  return v;
}

/** Soft fade-in when switching tabs or when content loads. */
export function FadeIn({ children }: { children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(8)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: DUR.normal,
        easing: Easing.bezier(...EASE.out),
        useNativeDriver: true,
      }),
      Animated.timing(translate, {
        toValue: 0,
        duration: DUR.normal,
        easing: Easing.bezier(...EASE.out),
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translate]);
  return (
    <Animated.View style={{ opacity, transform: [{ translateY: translate }] }}>
      {children}
    </Animated.View>
  );
}

/**
 * Staggered entrance for list items — 90ms apart (Apple's word-rhythm).
 * Makes the garden bloom and the timeline unfold like a story.
 */
export function StaggerIn({ index, children }: { index: number; children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(12)).current;
  useEffect(() => {
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: DUR.fast,
          easing: Easing.bezier(...EASE.out),
          useNativeDriver: true,
        }),
        Animated.timing(translate, {
          toValue: 0,
          duration: DUR.fast,
          easing: Easing.bezier(...EASE.out),
          useNativeDriver: true,
        }),
      ]).start();
    }, Math.min(index, 8) * STAGGER.item);
    return () => clearTimeout(t);
  }, [index, opacity, translate]);
  return (
    <Animated.View style={{ opacity, transform: [{ translateY: translate }] }}>
      {children}
    </Animated.View>
  );
}

/** Press feedback: gentle 0.97 scale (Apple HIG micro-interaction). */
export function PressableScale({
  children,
  onPress,
  accessibilityRole,
  accessibilityState,
  accessibilityLabel,
  style,
}: {
  children: React.ReactNode;
  onPress: () => void;
  accessibilityRole?: "tab" | "checkbox" | "button";
  accessibilityState?: { selected?: boolean; checked?: boolean };
  accessibilityLabel?: string;
  style?: object;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = () => {
    Animated.timing(scale, {
      toValue: 0.96,
      duration: DUR.instant,
      easing: Easing.bezier(...EASE.out),
      useNativeDriver: true,
    }).start();
  };
  const pressOut = () => {
    Animated.timing(scale, {
      toValue: 1,
      duration: exitDuration(DUR.instant),
      easing: Easing.bezier(...EASE.out),
      useNativeDriver: true,
    }).start();
  };
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityState={accessibilityState}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
    >
      <Animated.View style={[{ transform: [{ scale }] }, style]}>{children}</Animated.View>
    </Pressable>
  );
}

function timeAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return t("space.time.justNow");
  const m = Math.floor(s / 60);
  if (m < 60) return t("space.time.minutesAgo", { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("space.time.hoursAgo", { n: h });
  const d = Math.floor(h / 24);
  if (d < 30) return t("space.time.daysAgo", { n: d });
  return new Date(ts).toLocaleDateString();
}

function todayLine(): string {
  const d = new Date();
  const weekday = t(`space.time.weekday.${d.getDay()}` as StringKey);
  return t("space.time.dateLine", {
    month: d.getMonth() + 1,
    day: d.getDate(),
    weekday,
  });
}

/** Warm, inviting empty state — Sora waits with you instead of a dead icon. */
function EmptyState({ icon: Icon, text }: { icon: typeof Heart; text: string }) {
  const colors = useColors();
  void Icon;
  return (
    <View style={{ paddingVertical: 56, paddingHorizontal: 36, alignItems: "center" }}>
      <View style={{ marginBottom: 18 }}>
        <SoraAmbient video="idle" slot="ourspace" size={72} />
      </View>
      <TText
        style={{
          color: colors.muted,
          fontSize: 13.5,
          textAlign: "center",
          lineHeight: 23,
          letterSpacing: 0.2,
        }}
      >
        {text}
      </TText>
    </View>
  );
}

/** Hand-drawn card: soft asymmetric radii, hairline border, no hard shadow. */
export function SoftCard({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 20,
        borderTopLeftRadius: 22,
        borderBottomRightRadius: 24,
        borderWidth: 1,
        borderColor: colors.line,
        padding: 18,
      }}
    >
      {children}
    </View>
  );
}

// ---- Status: a living presence card ----

function StatusView() {
  const v = useOurSpaceVersion();
  const colors = useColors();
  const { tokens } = useTheme();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [now, setNow] = useState(Date.now());
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    void ourSpaceStore.getStatus().then(setStatus);
  }, [v]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!status) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.55, duration: 1600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      pulse.setValue(1);
    };
  }, [status, pulse]);

  useEffect(() => {
    void taskProgressStore.load().catch(() => null);
    void taskBuddyVideoStore.load().catch(() => null);
    void ambientVideoStore.load().catch(() => null);
  }, []);

  if (!status) return <EmptyState icon={Activity} text={t("space.status.empty")} />;
  return (
    <FadeIn>
      <SoftCard>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <Animated.View
            style={{
              width: 12,
              height: 12,
              borderRadius: 6,
              backgroundColor: tokens.accent.fg,
              opacity: pulse,
            }}
          />
          <TText style={{ color: colors.muted, fontSize: 12, letterSpacing: 1.5 }}>
            {t("space.status.title")}
          </TText>
        </View>
        <TText
          style={{
            color: colors.text,
            fontSize: 19,
            fontWeight: "700",
            lineHeight: 28,
            letterSpacing: 0.3,
            marginBottom: 8,
          }}
        >
          {status.text}
        </TText>
        {!!status.detail && (
          <TText style={{ color: colors.muted, fontSize: 13.5, lineHeight: 22, marginBottom: 12 }}>
            {status.detail}
          </TText>
        )}
        <TText style={{ color: colors.muted, fontSize: 12 }}>
          {t("space.status.updatedAgo")} · {timeAgo(status.updatedAt, now)}
        </TText>
      </SoftCard>
      <TaskCards />
    </FadeIn>
  );
}

// ---- Diary: journal rhythm — date, title, body ----

function DiaryView() {
  const v = useOurSpaceVersion();
  const colors = useColors();
  const [entries, setEntries] = useState<DiaryEntry[]>([]);

  useEffect(() => {
    void ourSpaceStore.listDiary(50).then(setEntries);
  }, [v]);

  if (entries.length === 0) return <EmptyState icon={BookOpen} text={t("space.diary.empty")} />;
  return (
    <FadeIn>
      <View style={{ gap: 20 }}>
        {entries.map((e, i) => (
          <StaggerIn key={e.id} index={i}>
            <View>
              <View
                style={{ flexDirection: "row", alignItems: "baseline", gap: 10, marginBottom: 8 }}
              >
                <TText
                  style={{
                    color: colors.muted,
                    fontSize: 12,
                    letterSpacing: 2,
                    fontWeight: "600",
                  }}
                >
                  {e.date}
                </TText>
                <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
              </View>
              <TText
                style={{
                  color: colors.text,
                  fontSize: 17,
                  fontWeight: "700",
                  lineHeight: 25,
                  letterSpacing: 0.3,
                  marginBottom: 8,
                }}
              >
                {e.title}
              </TText>
              <TText
                style={{ color: colors.text, fontSize: 14, lineHeight: 26, letterSpacing: 0.2 }}
              >
                {e.content}
              </TText>
            </View>
          </StaggerIn>
        ))}
      </View>
    </FadeIn>
  );
}

// ---- Timeline: a story, grouped by month ----

function monthLabel(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
}

function TimelineView() {
  const v = useOurSpaceVersion();
  const colors = useColors();
  const { tokens } = useTheme();
  const [events, setEvents] = useState<TimelineEvent[]>([]);

  useEffect(() => {
    void ourSpaceStore.listTimeline(100).then(setEvents);
  }, [v]);

  if (events.length === 0) return <EmptyState icon={History} text={t("space.timeline.empty")} />;

  // Group newest-first by month, preserving order.
  const groups: { label: string; items: TimelineEvent[] }[] = [];
  for (const e of events) {
    const label = monthLabel(e.timestamp);
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.items.push(e);
    else groups.push({ label, items: [e] });
  }

  return (
    <FadeIn>
      <View style={{ gap: 26 }}>
        {groups.map((g) => (
          <View key={g.label}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <TText
                style={{ color: colors.muted, fontSize: 12, letterSpacing: 2, fontWeight: "600" }}
              >
                {g.label}
              </TText>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
            </View>
            <View style={{ paddingLeft: 6 }}>
              {g.items.map((e, i) => {
                const isMilestone = e.kind === "milestone";
                return (
                  <StaggerIn key={e.id} index={i}>
                    <View style={{ flexDirection: "row", gap: 14 }}>
                      <View style={{ alignItems: "center", width: 16 }}>
                        {isMilestone ? (
                          <MoonStar size={14} color={tokens.accent.fg} strokeWidth={1.8} />
                        ) : (
                          <View
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 4,
                              backgroundColor: colors.muted,
                              marginTop: 7,
                              opacity: 0.7,
                            }}
                          />
                        )}
                        {i < g.items.length - 1 && (
                          <View
                            style={{
                              width: 1.5,
                              flex: 1,
                              backgroundColor: colors.line,
                              marginVertical: 4,
                              opacity: 0.8,
                            }}
                          />
                        )}
                      </View>
                      <View style={{ flex: 1, paddingBottom: 20 }}>
                        <TText
                          style={{
                            color: colors.text,
                            fontSize: isMilestone ? 15.5 : 14,
                            fontWeight: isMilestone ? "700" : "600",
                            lineHeight: 22,
                            letterSpacing: 0.2,
                            marginBottom: 3,
                          }}
                        >
                          {e.title}
                        </TText>
                        {!!e.description && (
                          <TText style={{ color: colors.muted, fontSize: 13, lineHeight: 21 }}>
                            {e.description}
                          </TText>
                        )}
                        <TText
                          style={{ color: colors.muted, fontSize: 11, marginTop: 5, opacity: 0.8 }}
                        >
                          {new Date(e.timestamp).toLocaleDateString()}
                        </TText>
                      </View>
                    </View>
                  </StaggerIn>
                );
              })}
            </View>
          </View>
        ))}
      </View>
    </FadeIn>
  );
}

// ---- Memory garden: alive — bloom, sprout, ask ----

const GARDEN_SECTIONS: {
  confidence: MemoryConfidence;
  labelKey: StringKey;
  icon: typeof Flower2;
  blurb: StringKey | null;
}[] = [
  { confidence: "blooming", labelKey: "space.garden.blooming", icon: Flower2, blurb: null },
  { confidence: "sprouting", labelKey: "space.garden.sprouting", icon: Sprout, blurb: null },
  {
    confidence: "ask",
    labelKey: "space.garden.ask",
    icon: MessageCircleQuestion,
    blurb: "space.garden.askHint",
  },
];

function GardenView() {
  const colors = useColors();
  const { tokens } = useTheme();
  const [items, setItems] = useState<MemoryRecord[]>([]);
  const [mv, setMv] = useState(0);

  // Garden reads from the canonical memory backend (one truth source).
  // gardenStateOf maps confident->blooming, unsure->sprouting, question->ask.
  useEffect(() => memoryStore.subscribe(() => setMv((x) => x + 1)), []);
  useEffect(() => {
    void memoryStore.listCurrent().then(setItems);
  }, [mv]);

  if (items.length === 0) return <EmptyState icon={Flower2} text={t("space.garden.empty")} />;

  return (
    <FadeIn>
      <View style={{ gap: 24 }}>
        {GARDEN_SECTIONS.map((sec) => {
          const list = items.filter((m) => gardenStateOf(m) === sec.confidence);
          if (list.length === 0) return null;
          const Icon = sec.icon;
          const isBloom = sec.confidence === "blooming";
          return (
            <View key={sec.confidence}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 4 }}>
                <View
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                    backgroundColor: isBloom ? tokens.accent.fg : colors.sky,
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: isBloom ? 0.92 : 1,
                  }}
                >
                  <Icon size={16} color={isBloom ? colors.card : colors.text} strokeWidth={1.8} />
                </View>
                <TText
                  style={{
                    color: colors.text,
                    fontSize: 14,
                    fontWeight: "700",
                    letterSpacing: 0.5,
                  }}
                >
                  {t(sec.labelKey)}
                </TText>
                <TText style={{ color: colors.muted, fontSize: 12 }}>{list.length}</TText>
              </View>
              {!!sec.blurb && (
                <TText
                  style={{ color: colors.muted, fontSize: 12.5, marginBottom: 10, marginLeft: 39 }}
                >
                  {t(sec.blurb)}
                </TText>
              )}
              <View style={{ gap: 10, marginTop: 6 }}>
                {list.map((m, mi) => (
                  <StaggerIn key={m.id} index={mi}>
                    <View
                      style={{
                        flexDirection: "row",
                        gap: 12,
                        backgroundColor: colors.card,
                        borderRadius: 16,
                        borderTopRightRadius: 20,
                        borderWidth: 1,
                        borderColor: colors.line,
                        padding: 15,
                        paddingLeft: 16,
                        // A living stem on the left, tinted by confidence.
                        borderLeftWidth: 3,
                        borderLeftColor: isBloom
                          ? tokens.accent.fg
                          : sec.confidence === "sprouting"
                            ? colors.muted
                            : colors.text,
                      }}
                    >
                      <TText
                        style={{ flex: 1, color: colors.text, fontSize: 13.5, lineHeight: 22 }}
                      >
                        {m.content}
                      </TText>
                    </View>
                  </StaggerIn>
                ))}
              </View>
            </View>
          );
        })}
      </View>
    </FadeIn>
  );
}

// ---- Tell-her-later: a gentle checklist ----

function TellLaterView() {
  const v = useOurSpaceVersion();
  const colors = useColors();
  const [items, setItems] = useState<TellLaterItem[]>([]);

  useEffect(() => {
    void ourSpaceStore.listTellLater(true).then(setItems);
  }, [v]);

  if (items.length === 0) return <EmptyState icon={Bell} text={t("space.tellLater.empty")} />;

  const pending = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);

  const row = (item: TellLaterItem, index: number) => (
    <StaggerIn key={item.id} index={index}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.done }}
        onPress={() => void ourSpaceStore.completeTellLater(item.id, !item.done)}
        style={{
          flexDirection: "row",
          gap: 13,
          alignItems: "flex-start",
          paddingVertical: 9,
          paddingHorizontal: 2,
        }}
      >
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            borderWidth: 1.5,
            borderColor: item.done ? colors.muted : colors.text,
            backgroundColor: item.done ? colors.text : "transparent",
            alignItems: "center",
            justifyContent: "center",
            marginTop: 1,
            opacity: item.done ? 0.55 : 1,
          }}
        >
          {item.done && <Check size={14} color={colors.card} strokeWidth={3} />}
        </View>
        <View style={{ flex: 1 }}>
          <TText
            style={{
              color: item.done ? colors.muted : colors.text,
              fontSize: 14,
              lineHeight: 22,
              textDecorationLine: item.done ? "line-through" : "none",
              opacity: item.done ? 0.7 : 1,
            }}
          >
            {item.text}
          </TText>
          <TText style={{ color: colors.muted, fontSize: 11, marginTop: 3, opacity: 0.75 }}>
            {timeAgo(item.createdAt, Date.now())}
          </TText>
        </View>
      </Pressable>
    </StaggerIn>
  );

  return (
    <FadeIn>
      <View style={{ gap: 20 }}>
        {pending.length > 0 && (
          <SoftCard>
            <TText
              style={{
                color: colors.muted,
                fontSize: 12,
                letterSpacing: 1.5,
                fontWeight: "600",
                marginBottom: 6,
              }}
            >
              {t("space.tellLater.pending")} · {pending.length}
            </TText>
            {pending.map((item, i) => row(item, i))}
          </SoftCard>
        )}
        {done.length > 0 && (
          <View>
            <TText
              style={{
                color: colors.muted,
                fontSize: 12,
                letterSpacing: 1.5,
                fontWeight: "600",
                marginBottom: 8,
                marginLeft: 4,
              }}
            >
              {t("space.tellLater.doneSection")} · {done.length}
            </TText>
            <SoftCard>{done.map((item, i) => row(item, i))}</SoftCard>
          </View>
        )}
      </View>
    </FadeIn>
  );
}

// ---- Screen ----

// ============ v2: couple space ============

type SpacePage =
  | { type: "home" }
  | { type: "feed" }
  | { type: "works" }
  | { type: "anniversary" }
  | { type: "diary" }
  | { type: "garden" }
  | { type: "status" }
  | { type: "tellLater" }
  | { type: "music" };

/** Couple header: her avatar + AI avatar overlapping, both customizable. */
function CoupleHeader() {
  const v = useOurSpaceVersion();
  const colors = useColors();
  const [profile, setProfile] = useState<CoupleProfile | null>(null);

  useEffect(() => {
    void ourSpaceStore.getCoupleProfile().then(setProfile);
  }, [v]);

  const pickAvatar = async (who: "her" | "ai") => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: "images",
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (!res.canceled && res.assets[0]) {
        const updated = await ourSpaceStore.setAvatar(who, res.assets[0].uri);
        setProfile(updated);
      }
    } catch {
      // Picker cancelled or failed — stay as-is.
    }
  };

  const herSource = profile?.herAvatarUri ? { uri: profile.herAvatarUri } : null;
  const aiSource: { uri: string } | number | null = profile?.aiAvatarUri
    ? { uri: profile.aiAvatarUri }
    : (soraSource() as { uri: string } | number);

  const avatar = (
    source: { uri: string } | number | null,
    fallback: React.ReactNode,
    who: "her" | "ai",
    label: string,
  ) => (
    <PressableScale
      onPress={() => void pickAvatar(who)}
      accessibilityRole="button"
      accessibilityLabel={`${label} · ${t("space.couple.changeAvatar")}`}
    >
      <View
        style={{
          width: 76,
          height: 76,
          borderRadius: 38,
          backgroundColor: colors.sky,
          borderWidth: 3,
          borderColor: colors.card,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
          shadowColor: "#000",
          shadowOpacity: 0.08,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
        }}
      >
        {source ? (
          <Image source={source} style={{ width: 70, height: 70, borderRadius: 35 }} />
        ) : (
          fallback
        )}
      </View>
    </PressableScale>
  );

  return (
    <View style={{ alignItems: "center", paddingTop: 26, paddingBottom: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        {avatar(
          herSource,
          <Camera size={26} color={colors.muted} strokeWidth={1.5} />,
          "her",
          t("space.couple.herAvatar"),
        )}
        <View style={{ marginLeft: -18, marginRight: -18, zIndex: 2 }}>
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: 17,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.line,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Heart size={16} color="#C15F3C" fill="#C15F3C" strokeWidth={1.8} />
          </View>
        </View>
        {avatar(
          aiSource,
          <Heart size={26} color={colors.muted} strokeWidth={1.5} />,
          "ai",
          t("space.couple.aiAvatar"),
        )}
      </View>
      <TText
        style={{
          color: colors.text,
          fontSize: 20,
          fontWeight: "800",
          letterSpacing: 0.5,
          marginTop: 12,
        }}
      >
        {t("space.title")}
      </TText>
      <TText style={{ color: colors.muted, fontSize: 12.5, marginTop: 3 }}>
        {t("space.subtitle")} · {todayLine()}
      </TText>
    </View>
  );
}

interface CardDef {
  page: Exclude<SpacePage, { type: "home" }>["type"];
  labelKey: StringKey;
  icon: typeof Heart;
  blurbKey?: StringKey;
}

const CARDS: CardDef[] = [
  { page: "feed", labelKey: "space.cards.feed", icon: MessageCircle },
  { page: "anniversary", labelKey: "space.cards.anniversary", icon: CalendarHeart },
  { page: "diary", labelKey: "space.tabs.diary", icon: BookOpen },
  { page: "garden", labelKey: "space.tabs.garden", icon: Flower2 },
  { page: "status", labelKey: "space.tabs.status", icon: Activity },
  { page: "tellLater", labelKey: "space.tabs.tellLater", icon: Bell },
  { page: "works", labelKey: "space.cards.works", icon: Images },
  { page: "music", labelKey: "space.cards.music", icon: Headphones },
];

function CardGrid({ onOpen }: { onOpen: (p: SpacePage) => void }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, paddingTop: 14 }}>
      {CARDS.map((card, i) => {
        const Icon = card.icon;
        return (
          <StaggerIn key={card.page} index={i}>
            <PressableScale
              onPress={() => onOpen({ type: card.page })}
              accessibilityRole="button"
              accessibilityLabel={t(card.labelKey)}
              style={{ width: "100%" }}
            >
              <View
                style={{
                  backgroundColor: colors.card,
                  borderRadius: 20,
                  borderTopLeftRadius: 22,
                  borderBottomRightRadius: 24,
                  borderWidth: 1,
                  borderColor: colors.line,
                  padding: 16,
                  alignItems: "center",
                  gap: 8,
                  minHeight: 108,
                  justifyContent: "center",
                }}
              >
                <Icon size={26} color={colors.text} strokeWidth={1.5} />
                <TText style={{ color: colors.text, fontSize: 13, fontWeight: "600" }}>
                  {t(card.labelKey)}
                </TText>
              </View>
            </PressableScale>
          </StaggerIn>
        );
      })}
    </View>
  );
}

/** Page shell with back button for card detail pages. */
function PageShell({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 14,
          paddingTop: 14,
          paddingBottom: 6,
          gap: 6,
        }}
      >
        <PressableScale onPress={onBack} accessibilityRole="button" accessibilityLabel="Back">
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.line,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ChevronLeft size={20} color={colors.text} strokeWidth={1.8} />
          </View>
        </PressableScale>
        <TText style={{ color: colors.text, fontSize: 18, fontWeight: "700", marginLeft: 4 }}>
          {title}
        </TText>
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 8, paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
      >
        <FadeIn>{children}</FadeIn>
      </ScrollView>
    </View>
  );
}

// ---- v2: social feed (Moments-style) ----

function FeedComposer({ onPosted }: { onPosted: () => void }) {
  const colors = useColors();
  const { tokens } = useTheme();
  const [text, setText] = useState("");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pickImage = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: "images",
        quality: 0.8,
      });
      if (!res.canceled && res.assets[0]) setImageUri(res.assets[0].uri);
    } catch {
      // Stay as-is.
    }
  };

  const post = async () => {
    if ((!text.trim() && !imageUri) || busy) return;
    setBusy(true);
    try {
      await ourSpaceStore.addFeedPost("her", text.trim(), imageUri ?? undefined);
      setText("");
      setImageUri(null);
      onPosted();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: colors.line,
        padding: 14,
        marginBottom: 16,
      }}
    >
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={t("space.feed.postHint")}
        placeholderTextColor={colors.muted}
        multiline
        style={{ color: colors.text, fontSize: 14, minHeight: 40, textAlignVertical: "top" }}
      />
      {imageUri ? (
        <Image
          source={{ uri: imageUri }}
          style={{ width: "100%", height: 160, borderRadius: 12, marginTop: 8 }}
          resizeMode="cover"
        />
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 10, gap: 8 }}>
        <PressableScale onPress={() => void pickImage()} accessibilityRole="button">
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: colors.sky,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Camera size={18} color={colors.muted} strokeWidth={1.6} />
          </View>
        </PressableScale>
        <View style={{ flex: 1 }} />
        <PressableScale onPress={() => void post()} accessibilityRole="button">
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              backgroundColor: tokens.accent.fg,
              borderRadius: 999,
              paddingHorizontal: 18,
              paddingVertical: 9,
              opacity: !text.trim() && !imageUri ? 0.45 : 1,
            }}
          >
            <Send size={14} color="#fff" strokeWidth={2} />
            <TText style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}>
              {t("space.feed.post")}
            </TText>
          </View>
        </PressableScale>
      </View>
    </View>
  );
}

function FeedPostCard({ post, onChanged }: { post: FeedPost; onChanged: () => void }) {
  const colors = useColors();
  const { tokens } = useTheme();
  const [replies, setReplies] = useState<FeedReply[]>([]);
  const [replyText, setReplyText] = useState("");
  const [showReply, setShowReply] = useState(false);
  const now = Date.now();

  useEffect(() => {
    void ourSpaceStore.listReplies(post.id).then(setReplies);
  }, [post.id]);

  const toggleLike = async (who: FeedAuthor) => {
    await ourSpaceStore.toggleFeedLike(post.id, who);
    onChanged();
  };

  const sendReply = async () => {
    if (!replyText.trim()) return;
    await ourSpaceStore.addReply(post.id, "her", replyText.trim());
    setReplyText("");
    setShowReply(false);
    const updated = await ourSpaceStore.listReplies(post.id);
    setReplies(updated);
  };

  const likeCount = (post.likedByHer ? 1 : 0) + (post.likedByAi ? 1 : 0);

  return (
    <SoftCard>
      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: 17,
              backgroundColor: post.author === "ai" ? tokens.accent.bg : colors.sky,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <TText style={{ fontSize: 13, fontWeight: "700", color: colors.text }}>
              {post.author === "ai" ? "AI" : "她"}
            </TText>
          </View>
          <View style={{ flex: 1 }}>
            <TText style={{ color: colors.text, fontSize: 13.5, fontWeight: "600" }}>
              {post.author === "ai" ? t("space.couple.aiAvatar") : t("space.couple.herAvatar")}
            </TText>
            <TText style={{ color: colors.muted, fontSize: 11.5 }}>
              {timeAgo(post.createdAt, now)}
            </TText>
          </View>
        </View>

        {post.text ? (
          <TText style={{ color: colors.text, fontSize: 14.5, lineHeight: 23 }}>{post.text}</TText>
        ) : null}
        {post.imageUri ? (
          <Image
            source={{ uri: post.imageUri }}
            style={{ width: "100%", height: 220, borderRadius: 14 }}
            resizeMode="cover"
          />
        ) : null}

        {replies.length > 0 && (
          <View
            style={{
              backgroundColor: colors.sky,
              borderRadius: 12,
              padding: 10,
              gap: 6,
            }}
          >
            {replies.map((r) => (
              <View key={r.id} style={{ flexDirection: "row", gap: 6 }}>
                <TText style={{ color: tokens.accent.fg, fontSize: 12.5, fontWeight: "700" }}>
                  {r.author === "ai" ? t("space.couple.aiAvatar") : t("space.couple.herAvatar")}:
                </TText>
                <TText style={{ color: colors.text, fontSize: 12.5, flex: 1 }}>{r.text}</TText>
              </View>
            ))}
          </View>
        )}

        <View style={{ flexDirection: "row", alignItems: "center", gap: 16, marginTop: 2 }}>
          <PressableScale onPress={() => void toggleLike("her")} accessibilityRole="button">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Heart
                size={17}
                color={post.likedByHer ? "#C15F3C" : colors.muted}
                fill={post.likedByHer ? "#C15F3C" : "transparent"}
                strokeWidth={1.7}
              />
              <TText style={{ color: colors.muted, fontSize: 12 }}>
                {likeCount > 0 ? likeCount : ""}
              </TText>
            </View>
          </PressableScale>
          <PressableScale onPress={() => setShowReply((s) => !s)} accessibilityRole="button">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <MessageCircle size={17} color={colors.muted} strokeWidth={1.7} />
              <TText style={{ color: colors.muted, fontSize: 12 }}>
                {replies.length > 0 ? replies.length : ""}
              </TText>
            </View>
          </PressableScale>
        </View>

        {showReply && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <TextInput
              value={replyText}
              onChangeText={setReplyText}
              placeholder={t("space.feed.replyHint")}
              placeholderTextColor={colors.muted}
              style={{
                flex: 1,
                color: colors.text,
                fontSize: 13,
                backgroundColor: colors.sky,
                borderRadius: 999,
                paddingHorizontal: 14,
                paddingVertical: 8,
              }}
            />
            <PressableScale onPress={() => void sendReply()} accessibilityRole="button">
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  backgroundColor: tokens.accent.fg,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Send size={15} color="#fff" strokeWidth={2} />
              </View>
            </PressableScale>
          </View>
        )}
      </View>
    </SoftCard>
  );
}

function FeedPage() {
  const v = useOurSpaceVersion();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    void ourSpaceStore.listFeed().then(setPosts);
  }, [v, tick]);

  if (posts.length === 0) {
    return (
      <>
        <FeedComposer onPosted={() => setTick((x) => x + 1)} />
        <EmptyState icon={MessageCircle} text={t("space.feed.empty")} />
      </>
    );
  }

  return (
    <View style={{ gap: 14 }}>
      <FeedComposer onPosted={() => setTick((x) => x + 1)} />
      {posts.map((p, i) => (
        <StaggerIn key={p.id} index={i}>
          <FeedPostCard post={p} onChanged={() => setTick((x) => x + 1)} />
        </StaggerIn>
      ))}
    </View>
  );
}

// ---- v2: works drawer (Instagram-style) ----

const WORK_ICONS: Record<WorkType, typeof Heart> = {
  image: Camera,
  html: MessageCircle,
  theme: Heart,
  file: BookOpen,
};

function WorksPage() {
  const v = useOurSpaceVersion();
  const colors = useColors();
  const { tokens } = useTheme();
  const [works, setWorks] = useState<WorkItem[]>([]);
  const [viewer, setViewer] = useState<WorkItem | null>(null);

  useEffect(() => {
    void ourSpaceStore.listWorks().then(setWorks);
  }, [v]);

  return (
    <View>
      {works.length === 0 ? (
        <EmptyState icon={Images} text={t("space.works.empty")} />
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 3 }}>
          {works.map((w) => {
            const thumb = w.thumbnailUri ?? (w.type === "image" ? w.uri : undefined);
            const Icon = WORK_ICONS[w.type];
            return (
              <PressableScale
                key={w.id}
                onPress={() => setViewer(w)}
                accessibilityRole="button"
                accessibilityLabel={w.title}
                style={{ width: "32.5%" }}
              >
                <View
                  style={{
                    aspectRatio: 1,
                    borderRadius: 6,
                    backgroundColor: colors.sky,
                    overflow: "hidden",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {thumb ? (
                    <Image
                      source={{ uri: thumb }}
                      style={{ width: "100%", height: "100%" }}
                      resizeMode="cover"
                    />
                  ) : (
                    <Icon size={26} color={colors.muted} strokeWidth={1.5} />
                  )}
                </View>
              </PressableScale>
            );
          })}
        </View>
      )}

      <Modal
        visible={!!viewer}
        transparent
        animationType="fade"
        onRequestClose={() => setViewer(null)}
      >
        <Pressable
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.85)",
            justifyContent: "center",
            alignItems: "center",
          }}
          onPress={() => setViewer(null)}
        >
          {viewer && (
            <View style={{ width: "92%", maxHeight: "84%" }} onStartShouldSetResponder={() => true}>
              {viewer.type === "image" && viewer.uri ? (
                <Image
                  source={{ uri: viewer.uri }}
                  style={{ width: "100%", aspectRatio: 1, borderRadius: 12 }}
                  resizeMode="contain"
                />
              ) : (
                <View
                  style={{
                    backgroundColor: colors.card,
                    borderRadius: 16,
                    padding: 22,
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  {(() => {
                    const Icon = WORK_ICONS[viewer.type];
                    return <Icon size={40} color={tokens.accent.fg} strokeWidth={1.4} />;
                  })()}
                  <TText
                    style={{
                      color: colors.text,
                      fontSize: 16,
                      fontWeight: "700",
                      textAlign: "center",
                    }}
                  >
                    {viewer.title}
                  </TText>
                  {viewer.description ? (
                    <TText style={{ color: colors.muted, fontSize: 13, textAlign: "center" }}>
                      {viewer.description}
                    </TText>
                  ) : null}
                  <TText style={{ color: colors.muted, fontSize: 11 }} selectable>
                    {viewer.uri}
                  </TText>
                </View>
              )}
              <TText
                style={{
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: "600",
                  textAlign: "center",
                  marginTop: 14,
                }}
              >
                {viewer.title}
              </TText>
            </View>
          )}
        </Pressable>
      </Modal>
    </View>
  );
}

// ---- v2: anniversaries ----

function AnniversaryPage() {
  const v = useOurSpaceVersion();
  const colors = useColors();
  const { tokens } = useTheme();
  const [items, setItems] = useState<Anniversary[]>([]);

  useEffect(() => {
    void ourSpaceStore.listAnniversaries().then(setItems);
  }, [v]);

  const dayCount = (dateStr: string): { label: string; past: boolean } => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const target = new Date(y, m - 1, d);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    target.setHours(0, 0, 0, 0);
    const diff = Math.round((now.getTime() - target.getTime()) / 86400000);
    if (diff === 0) return { label: t("space.anniversary.today"), past: true };
    if (diff > 0) return { label: t("space.anniversary.daysTogether", { n: diff }), past: true };
    return { label: t("space.anniversary.countdown", { n: -diff }), past: false };
  };

  return (
    <View style={{ gap: 14 }}>
      {items.length === 0 ? (
        <EmptyState icon={CalendarHeart} text={t("space.anniversary.empty")} />
      ) : (
        items.map((a, i) => {
          const dc = dayCount(a.date);
          return (
            <StaggerIn key={a.id} index={i}>
              <SoftCard>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 26,
                      backgroundColor: tokens.accent.bg,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <CalendarHeart size={24} color={tokens.accent.fg} strokeWidth={1.6} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TText style={{ color: colors.text, fontSize: 15, fontWeight: "700" }}>
                      {a.title}
                    </TText>
                    <TText style={{ color: colors.muted, fontSize: 12.5, marginTop: 2 }}>
                      {a.date}
                      {a.description ? ` · ${a.description}` : ""}
                    </TText>
                  </View>
                  <TText
                    style={{
                      color: tokens.accent.fg,
                      fontSize: 13,
                      fontWeight: "700",
                    }}
                  >
                    {dc.label}
                  </TText>
                </View>
              </SoftCard>
            </StaggerIn>
          );
        })
      )}
      <TText
        style={{
          color: colors.muted,
          fontSize: 13,
          fontWeight: "700",
          marginTop: 8,
          letterSpacing: 0.4,
        }}
      >
        {t("space.timeline.title")}
      </TText>
      <TimelineView />
    </View>
  );
}

// ---- v2 main screen ----

export function OurSpaceScreen() {
  const [page, setPage] = useState<SpacePage>({ type: "home" });
  const colors = useColors();

  if (page.type !== "home") {
    const titles: Record<Exclude<SpacePage, { type: "home" }>["type"], string> = {
      feed: t("space.feed.title"),
      works: t("space.works.title"),
      anniversary: t("space.anniversary.title"),
      diary: t("space.diary.title"),
      garden: t("space.garden.title"),
      status: t("space.status.title"),
      tellLater: t("space.tellLater.title"),
      music: t("music.title"),
    };
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        <PageShell title={titles[page.type]} onBack={() => setPage({ type: "home" })}>
          {page.type === "feed" && <FeedPage />}
          {page.type === "works" && <WorksPage />}
          {page.type === "anniversary" && <AnniversaryPage />}
          {page.type === "diary" && <DiaryView />}
          {page.type === "garden" && <GardenView />}
          {page.type === "status" && <StatusView />}
          {page.type === "tellLater" && <TellLaterView />}
          {page.type === "music" && <MusicRoomPage />}
        </PageShell>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
      >
        <FadeIn>
          <CoupleHeader />
        </FadeIn>
        <CardGrid onOpen={setPage} />
      </ScrollView>
    </View>
  );
}

/** Re-exported for tests that only need the tab model. */
export const SPACE_TABS: SpaceTab[] = ["status", "diary", "timeline", "garden", "tellLater"];
