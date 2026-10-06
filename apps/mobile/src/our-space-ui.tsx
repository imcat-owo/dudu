/**
 * 我们的空间 — Our Space. The part of the app that belongs to the two of them.
 *
 * Five areas, dialog-driven and AI-operated — with one exception: she can
 * write diary entries herself (user P2-2), everything else he writes for them:
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
import AsyncStorage from "@react-native-async-storage/async-storage";
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
  Mail,
  MailOpen,
  MessageCircle,
  MessageCircleQuestion,
  MessagesSquare,
  MoonStar,
  Pencil,
  Plus,
  ScrollText,
  Send,
  Sprout,
  Trash2,
} from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Easing,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  TextInput,
  View,
} from "react-native";
import { useReduceMotion } from "./extras/reduce-motion";
import { TText } from "./font";
import { WebView } from "react-native-webview";
import { AnimatedAvatar, useLiveAvatarState } from "./animated-avatar";
import { triggerAnniversaryCelebration, triggerMilestoneCelebration } from "./avatar-celebration";
import "./avatar-celebration-instance";
import { getLocale, type StringKey, t } from "./i18n";
import { HandText, PaperGrain, type TapeColor, WashiTape } from "./journal-decor";
import { memoryStore } from "./memory/instance";
import {
  detectNewMilestones,
  intimacyPhase,
  loadCelebratedMilestones,
  saveCelebratedMilestones,
  type IntimacyPhase,
} from "./romance/intimacy";
import {
  QUESTION_STATE_KEY,
  dateKey,
  questionForDate,
  type DailyQuestion,
  type QuestionCategory,
  type QuestionState,
} from "./romance/questions";
import type { MemoryRecord } from "./memory/types";
import { gardenStateOf } from "./memory/types";
import { DUR, EASE, exitDuration, STAGGER } from "./motion";
import { MusicRoomPage } from "./music-ui";
import { getUpcomingAnniversaries } from "./our-space/anniversary-section";
import { ourSpaceStore } from "./our-space/instance";
import { OutreachFrequencySection } from "./outreach/outreach-ui";
import { InitiativeSection } from "./initiative/initiative-ui";
import { FollowupSection } from "./followup/followup-ui";
import { MoodcheckSection } from "./moodcheck/moodcheck-ui";
import { PhotoshareSection } from "./photoshare/photoshare-ui";
import { SelfpostSection } from "./selfpost/selfpost-ui";
import { getOnThisDay, type OnThisDayItem } from "./our-space/on-this-day";
import type {
  AiStatus,
  Anniversary,
  CoupleProfile,
  DiaryEntry,
  FeedAuthor,
  FeedPost,
  FeedReply,
  HerMood,
  LeftNote,
  LoveLetter,
  MemoryConfidence,
  TellLaterItem,
  TimelineEvent,
  WorkItem,
  WorkType,
} from "./our-space/store";
import { TaskCards } from "./our-space/task-cards-ui";
import { taskProgressStore } from "./our-space/task-progress-instance";
import { daysTogether, resolveTogetherSince } from "./our-space/together";
import { getCoupleCounters, type CoupleCounters } from "./our-space/couple-counters";
import { musicStore } from "./music/instance";
import { SoraAmbient } from "./sora-ambient";
import { ambientVideoStore } from "./sora-ambient-video-instance";
import { radii } from "./theme/radii";
import { BRAND_OCHRE } from "./theme/brand";
import { shadows } from "./theme/shadows";
import { useTheme } from "./theme/ThemeContext";
import { Button, useColors } from "./ui";

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
function EmptyState({ text }: { text: string }) {
  const colors = useColors();
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

/**
 * Small trash button with a confirm dialog. Every deletable entry in
 * Our Space uses this — she can remove anything, anywhere.
 */
function DeleteEntryButton({ onDelete }: { onDelete: () => Promise<unknown> }) {
  const colors = useColors();
  const confirm = () => {
    Alert.alert(t("space.entry.deleteTitle") as string, t("space.entry.deleteBody") as string, [
      { text: t("common.cancel") as string, style: "cancel" },
      {
        text: t("common.delete") as string,
        style: "destructive",
        onPress: () => void onDelete(),
      },
    ]);
  };
  return (
    <PressableScale
      onPress={confirm}
      accessibilityRole="button"
      accessibilityLabel={t("common.delete") as string}
    >
      <Trash2 size={15} color={colors.muted} strokeWidth={1.7} />
    </PressableScale>
  );
}

/** Small pencil button that opens the edit composer for an entry. */
function EditEntryButton({ onEdit }: { onEdit: () => void }) {
  const colors = useColors();
  return (
    <PressableScale
      onPress={onEdit}
      accessibilityRole="button"
      accessibilityLabel={t("common.edit") as string}
    >
      <Pencil size={15} color={colors.muted} strokeWidth={1.7} />
    </PressableScale>
  );
}

/** Hand-drawn card: soft asymmetric radii, hairline border, soft shadow. */
export function SoftCard({
  children,
  tape,
}: {
  children: React.ReactNode;
  /** Optional washi tape color pinned to the card's top edge. */
  tape?: TapeColor;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: radii.lg,
        borderTopLeftRadius: radii.lg,
        borderBottomRightRadius: radii.xl,
        borderWidth: 1,
        borderColor: colors.line,
        padding: 18,
        overflow: "hidden",
        ...shadows.card,
      }}
    >
      <PaperGrain />
      {tape ? <WashiTape color={tape} style={{ top: -9, left: 28 }} rotate={-7} /> : null}
      {children}
    </View>
  );
}

// ---- Her mood: how SHE is feeling, as she told him ----

function HerMoodView() {
  const v = useOurSpaceVersion();
  const colors = useColors();
  const [mood, setMood] = useState<HerMood | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    void ourSpaceStore.getHerMood().then(setMood);
  }, [v]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  if (!mood) return <EmptyState text={t("space.herMood.empty")} />;
  return (
    <FadeIn>
      <SoftCard>
        <TText style={{ color: colors.muted, fontSize: 12, letterSpacing: 1.5, marginBottom: 10 }}>
          {t("space.herMood.title")}
        </TText>
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
          {mood.mood}
        </TText>
        {!!mood.note && (
          <TText style={{ color: colors.muted, fontSize: 13.5, lineHeight: 22, marginBottom: 12 }}>
            {mood.note}
          </TText>
        )}
        <TText style={{ color: colors.muted, fontSize: 12 }}>
          {t("space.status.updatedAgo")} · {timeAgo(mood.updatedAt, now)}
        </TText>
      </SoftCard>
    </FadeIn>
  );
}

// ---- Status: a living presence card ----

function StatusView() {
  const v = useOurSpaceVersion();
  const colors = useColors();
  const { tokens } = useTheme();
  const reduceMotion = useReduceMotion();
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
  // Living-presence dot pulse. Reduce Motion: parked at full opacity.
  useEffect(() => {
    if (!status) return;
    if (reduceMotion) {
      pulse.setValue(1);
      return;
    }
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
  }, [status, pulse, reduceMotion]);

  useEffect(() => {
    void taskProgressStore.load().catch(() => null);
    void ambientVideoStore.load().catch(() => null);
  }, []);

  // Task cards must not depend on the AI having set a status (P1-4):
  // background work (e.g. knowledge indexing) reports progress even when
  // no status exists yet.
  if (!status)
    return (
      <>
        <EmptyState text={t("space.status.empty")} />
        <TaskCards />
      </>
    );
  return (
    <FadeIn>
      <SoftCard>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <Animated.View
            style={{
              width: 12,
              height: 12,
              borderRadius: radii.xs,
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
// user P2-2: the diary nudge offers "你写还是我写？" — so she gets a real
// write path here, not just his entries. Same store, same AI tools.

function DiaryView({ autoCompose }: { autoCompose?: boolean }) {
  const v = useOurSpaceVersion();
  const colors = useColors();
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [composing, setComposing] = useState(false);
  const [dTitle, setDTitle] = useState("");
  const [dContent, setDContent] = useState("");
  const [dError, setDError] = useState("");

  useEffect(() => {
    void ourSpaceStore.listDiary(50).then(setEntries);
  }, [v]);
  useEffect(() => {
    if (autoCompose) setComposing(true);
  }, [autoCompose]);

  async function saveEntry() {
    setDError("");
    try {
      await ourSpaceStore.addDiary(dTitle, dContent);
      setDTitle("");
      setDContent("");
      setComposing(false);
    } catch {
      setDError(t("space.diary.fillBoth") as string);
    }
  }

  const writeButton = (
    <PressableScale
      onPress={() => {
        setDError("");
        setComposing((c) => !c);
      }}
      accessibilityRole="button"
      accessibilityLabel={t("space.diary.write") as string}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          alignSelf: "flex-start",
          gap: 6,
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: radii.lg,
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: colors.card,
        }}
      >
        <BookOpen size={15} color={colors.text} strokeWidth={1.8} />
        <TText style={{ color: colors.text, fontSize: 13.5, fontWeight: "600" }}>
          {t("space.diary.write")}
        </TText>
      </View>
    </PressableScale>
  );

  const composer = composing ? (
    <SoftCard>
      <TextInput
        value={dTitle}
        onChangeText={setDTitle}
        placeholder={t("space.diary.titlePlaceholder") as string}
        placeholderTextColor={colors.muted}
        style={{ color: colors.text, fontSize: 16, fontWeight: "700", marginBottom: 10 }}
      />
      <TextInput
        value={dContent}
        onChangeText={setDContent}
        placeholder={t("space.diary.contentPlaceholder") as string}
        placeholderTextColor={colors.muted}
        multiline
        style={{ color: colors.text, fontSize: 14, lineHeight: 24, minHeight: 90, textAlignVertical: "top" }}
      />
      {!!dError && (
        <TText style={{ color: colors.danger, fontSize: 12.5, marginTop: 8 }}>{dError}</TText>
      )}
      <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
        <PressableScale onPress={() => void saveEntry()} accessibilityRole="button">
          <View
            style={{
              paddingHorizontal: 18,
              paddingVertical: 9,
              borderRadius: radii.lg,
              backgroundColor: colors.text,
            }}
          >
            <TText style={{ color: colors.card, fontSize: 13.5, fontWeight: "700" }}>
              {t("space.diary.save")}
            </TText>
          </View>
        </PressableScale>
        <PressableScale
          onPress={() => {
            setComposing(false);
            setDError("");
          }}
          accessibilityRole="button"
        >
          <View style={{ paddingHorizontal: 14, paddingVertical: 9 }}>
            <TText style={{ color: colors.muted, fontSize: 13.5 }}>{t("common.cancel")}</TText>
          </View>
        </PressableScale>
      </View>
    </SoftCard>
  ) : null;

  if (entries.length === 0 && !composing)
    return (
      <View style={{ gap: 16 }}>
        <EmptyState text={t("space.diary.empty")} />
        {writeButton}
      </View>
    );
  return (
    <FadeIn>
      <View style={{ gap: 20 }}>
        {writeButton}
        {composer}
        {entries.map((e, i) => (
          <StaggerIn key={e.id} index={i}>
            <View>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}
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
                <DeleteEntryButton onDelete={() => ourSpaceStore.deleteDiary(e.id)} />
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
  return new Intl.DateTimeFormat(getLocale(), { year: "numeric", month: "numeric" }).format(
    new Date(ts),
  );
}

function TimelineView() {
  const v = useOurSpaceVersion();
  const colors = useColors();
  const { tokens } = useTheme();
  const [events, setEvents] = useState<TimelineEvent[]>([]);

  useEffect(() => {
    void ourSpaceStore.listTimeline(100).then(setEvents);
  }, [v]);

  if (events.length === 0) return <EmptyState text={t("space.timeline.empty")} />;

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
                              borderRadius: radii.xs,
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
                        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                          <TText
                            style={{
                              color: colors.text,
                              fontSize: isMilestone ? 15.5 : 14,
                              fontWeight: isMilestone ? "700" : "600",
                              lineHeight: 22,
                              letterSpacing: 0.2,
                              marginBottom: 3,
                              flex: 1,
                            }}
                          >
                            {e.title}
                          </TText>
                          <DeleteEntryButton onDelete={() => ourSpaceStore.deleteTimeline(e.id)} />
                        </View>
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
  const [autoExtract, setAutoExtract] = useState(true);

  // Garden reads from the canonical memory backend (one truth source).
  // gardenStateOf maps confident->blooming, unsure->sprouting, question->ask.
  useEffect(() => memoryStore.subscribe(() => setMv((x) => x + 1)), []);
  useEffect(() => {
    void memoryStore.listCurrent().then(setItems);
  }, [mv]);
  useEffect(() => {
    void memoryStore
      .getAutoExtract()
      .then(setAutoExtract)
      .catch(() => {});
  }, [mv]);

  const toggleAutoExtract = (v: boolean) => {
    setAutoExtract(v);
    void memoryStore.setAutoExtract(v).catch(() => setAutoExtract(!v));
  };

  // P3-4: wilted memories (replaced by newer ones) stay queryable — a
  // collapsed history section, read-only. Empty when nothing was replaced.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [wilted, setWilted] = useState<MemoryRecord[]>([]);
  useEffect(() => {
    if (!historyOpen) return;
    void memoryStore
      .listMemories()
      .then((all) => setWilted(all.filter((m) => m.validTo !== null)))
      .catch(() => {});
  }, [historyOpen, mv]);

  if (items.length === 0) return <EmptyState text={t("space.garden.empty")} />;

  return (
    <FadeIn>
      <View style={{ gap: 24 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            backgroundColor: colors.card,
            borderRadius: radii.lg,
            borderWidth: 1,
            borderColor: colors.line,
            paddingVertical: 10,
            paddingHorizontal: 14,
          }}
        >
          <View style={{ flex: 1 }}>
            <TText style={{ color: colors.text, fontSize: 13.5, fontWeight: "600" }}>
              {t("space.garden.autoExtract")}
            </TText>
            <TText style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
              {t("space.garden.autoExtractHint")}
            </TText>
          </View>
          <Switch value={autoExtract} onValueChange={toggleAutoExtract} />
        </View>
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
                    borderRadius: radii.lg,
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
                        borderRadius: radii.lg,
                        borderTopRightRadius: radii.lg,
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
                      {/* P2-4: sprouting memories can be confirmed right here —
                          "记对了" keeps the memory without her having to chat. */}
                      {sec.confidence === "sprouting" && (
                        <PressableScale
                          onPress={() =>
                            void (async () => {
                              await memoryStore.confirmMemory(m.id, "user");
                              setMv((x) => x + 1);
                            })()
                          }
                          accessibilityRole="button"
                          accessibilityLabel={t("space.garden.confirmRight") as string}
                        >
                          <Check size={16} color={colors.text} strokeWidth={2} />
                        </PressableScale>
                      )}
                      <DeleteEntryButton onDelete={() => memoryStore.deleteMemory(m.id)} />
                    </View>
                  </StaggerIn>
                ))}
              </View>
            </View>
          );
        })}
        {/* History: replaced memories, collapsed by default. */}
        <PressableScale
          onPress={() => setHistoryOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={t("space.garden.history") as string}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
            <View
              style={{
                width: 30,
                height: 30,
                borderRadius: radii.lg,
                backgroundColor: colors.sky,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <History size={16} color={colors.muted} strokeWidth={1.8} />
            </View>
            <TText style={{ color: colors.text, fontSize: 14, fontWeight: "700", letterSpacing: 0.5 }}>
              {t("space.garden.history")}
            </TText>
            <TText style={{ color: colors.muted, fontSize: 12 }}>
              {historyOpen ? t("agent.collapse") : t("common.expand")}
            </TText>
          </View>
        </PressableScale>
        {historyOpen && (
          <View style={{ gap: 10, marginTop: 6 }}>
            {wilted.length === 0 ? (
              <TText style={{ color: colors.muted, fontSize: 12.5, marginLeft: 39 }}>
                {t("space.garden.historyEmpty")}
              </TText>
            ) : (
              wilted.map((m) => (
                <View
                  key={m.id}
                  style={{
                    backgroundColor: colors.card,
                    borderRadius: radii.lg,
                    borderWidth: 1,
                    borderColor: colors.line,
                    padding: 15,
                    opacity: 0.75,
                  }}
                >
                  <TText style={{ color: colors.text, fontSize: 13.5, lineHeight: 22 }}>
                    {m.content}
                  </TText>
                </View>
              ))
            )}
          </View>
        )}
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

  // Proactive outreach frequency sits above the queue — the queue is what
  // outreach draws from, so the setting belongs here, always visible.
  // Proactive initiative （主动约定） sits here too: it shares the same
  // "AI reaches her" channel and daily cap.
  const freqSection = <OutreachFrequencySection />;
  const initiativeSection = <InitiativeSection />;
  const followupSection = <FollowupSection />;
  const moodcheckSection = <MoodcheckSection />;
  const photoshareSection = <PhotoshareSection />;

  if (items.length === 0)
    return (
      <View style={{ gap: 12 }}>
        {freqSection}
        {initiativeSection}
        {followupSection}
        {moodcheckSection}
        {photoshareSection}
        <EmptyState text={t("space.tellLater.empty")} />
      </View>
    );

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
            borderRadius: radii.md,
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
        <DeleteEntryButton onDelete={() => ourSpaceStore.deleteTellLater(item.id)} />
      </Pressable>
    </StaggerIn>
  );

  return (
    <FadeIn>
      <View style={{ gap: 20 }}>
        {freqSection}
        {initiativeSection}
        {followupSection}
        {moodcheckSection}
        {photoshareSection}
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
  | { type: "music" }
  | { type: "loveLetters" };

/** Couple header: her avatar + AI avatar overlapping, both customizable. */
function CoupleHeader() {
  const v = useOurSpaceVersion();
  const colors = useColors();
  const { bundle, applyBundle } = useTheme();
  const [profile, setProfile] = useState<CoupleProfile | null>(null);
  const [togetherDays, setTogetherDays] = useState<number | null>(null);
  const [counters, setCounters] = useState<CoupleCounters | null>(null);
  const [chatApplied, setChatApplied] = useState(false);
  // A3: the AI face in the couple header is alive — idle loop by default,
  // milestone_level_up clip briefly on task-done / anniversary day.
  const aiLiveState = useLiveAvatarState({ busy: false, running: false });

  useEffect(() => {
    void (async () => {
      const p = await ourSpaceStore.getCoupleProfile();
      setProfile(p);
      const anniversaries = await ourSpaceStore.listAnniversaries();
      const since = resolveTogetherSince(p, anniversaries);
      setTogetherDays(daysTogether(since));
      // A3: anniversary day → celebrate once that day (guarded + persisted inside).
      if (getUpcomingAnniversaries(anniversaries).some((a) => a.daysUntil === 0)) {
        await triggerAnniversaryCelebration(new Date().toDateString());
      }
      // "我们第 N 次" (xiaomeng P2-2): derived from real records only.
      const c = await getCoupleCounters({
        countTogetherListens: () => musicStore.countTogetherListens(),
        countLoveLetters: async () => (await ourSpaceStore.listLoveLetters()).length,
        countDiaryEntries: async () => (await ourSpaceStore.listDiary(1_000_000)).length,
      }).catch(() => null);
      setCounters(c);
      // D12 P2-1: intimacy milestones — 100/365 days together, 50th love
      // letter. Each fires once ever (persisted guard), reusing the P0-1
      // milestone celebration clip.
      try {
        const celebrated = await loadCelebratedMilestones(AsyncStorage);
        const fresh = detectNewMilestones(
          { days: daysTogether(since), loveLetters: c ? c.loveLetters : 0 },
          celebrated,
        );
        if (fresh.length > 0) {
          triggerMilestoneCelebration();
          await saveCelebratedMilestones(AsyncStorage, [...celebrated, ...fresh]);
        }
      } catch {
        // Best-effort: a milestone check must never break the home screen.
      }
    })();
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
        setChatApplied(false);
      }
    } catch {
      // Picker cancelled or failed — stay as-is.
    }
  };

  const herSource = profile?.herAvatarUri ? { uri: profile.herAvatarUri } : null;
  // A3: no custom AI avatar → the living face (idle loop, celebration clip
  // on milestones). A picked avatar renders as-is via the source branch.
  const aiSource: { uri: string } | number | null = profile?.aiAvatarUri
    ? { uri: profile.aiAvatarUri }
    : null;
  const aiFallback = <AnimatedAvatar state={aiLiveState} size={70} />;

  // Couple-avatar play (P3): one tap applies the couple avatars as the chat
  // avatars — her photo becomes the user avatar, his the AI avatar. Real
  // apply via the theme bundle (same path as Appearance → avatar), so chat
  // picks it up immediately. Only custom-picked avatars are applied; unset
  // sides are left alone rather than filled with placeholders.
  const hasCustomAvatar = !!(profile?.herAvatarUri || profile?.aiAvatarUri);
  const applyCoupleAvatarsToChat = async () => {
    const avatar = { ...(bundle.avatar ?? {}) };
    let changed = false;
    if (profile?.aiAvatarUri) {
      avatar.assistant = profile.aiAvatarUri;
      changed = true;
    }
    if (profile?.herAvatarUri) {
      avatar.user = profile.herAvatarUri;
      changed = true;
    }
    if (!changed) return;
    const res = await applyBundle({ ...bundle, avatar });
    if (res === "ok" || res === "local-only") setChatApplied(true);
  };

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
          borderRadius: radii.xl,
          backgroundColor: colors.sky,
          borderWidth: 3,
          borderColor: colors.card,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
          // Tiered shadow (card).
          ...shadows.card,
        }}
      >
        {source ? (
          <Image source={source} style={{ width: 70, height: 70, borderRadius: radii.xl }} />
        ) : (
          fallback
        )}
      </View>
    </PressableScale>
  );

  return (
    <View style={{ alignItems: "center", paddingTop: 26, paddingBottom: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <View style={{ alignItems: "center" }}>
          {avatar(
            herSource,
            <Camera size={26} color={colors.muted} strokeWidth={1.5} />,
            "her",
            t("space.couple.herAvatar"),
          )}
          {!!profile?.herNickname && (
            <TText style={{ color: colors.text, fontSize: 13, fontWeight: "700", marginTop: 6 }}>
              {profile.herNickname}
            </TText>
          )}
        </View>
        <View style={{ marginLeft: -18, marginRight: -18, zIndex: 2, marginTop: 21 }}>
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: radii.lg,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.line,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Heart size={16} color={BRAND_OCHRE} fill={BRAND_OCHRE} strokeWidth={1.8} />
          </View>
        </View>
        <View style={{ alignItems: "center" }}>
          {avatar(
            aiSource,
            aiFallback,
            "ai",
            t("space.couple.aiAvatar"),
          )}
          {!!profile?.aiNickname && (
            <TText style={{ color: colors.text, fontSize: 13, fontWeight: "700", marginTop: 6 }}>
              {profile.aiNickname}
            </TText>
          )}
        </View>
      </View>
      {hasCustomAvatar && (
        <PressableScale
          onPress={() => void applyCoupleAvatarsToChat()}
          accessibilityRole="button"
          accessibilityLabel={t("space.couple.useInChat")}
          style={{ marginTop: 10 }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 14,
              paddingVertical: 7,
              borderRadius: radii.lg,
              backgroundColor: chatApplied ? colors.sky : colors.card,
              borderWidth: 1,
              borderColor: colors.line,
            }}
          >
            {chatApplied ? (
              <Check size={13} color={colors.text} strokeWidth={2} />
            ) : (
              <MessagesSquare size={13} color={colors.text} strokeWidth={1.8} />
            )}
            <TText
              style={{
                color: colors.text,
                fontSize: 12.5,
                fontWeight: "700",
                marginLeft: 6,
                letterSpacing: 0.3,
              }}
            >
              {t(chatApplied ? "space.couple.usedInChat" : "space.couple.useInChat")}
            </TText>
          </View>
        </PressableScale>
      )}
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
      {togetherDays !== null && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginTop: 8,
            paddingHorizontal: 14,
            paddingVertical: 6,
            borderRadius: radii.lg,
            backgroundColor: colors.sky,
          }}
        >
          <Heart size={13} color={BRAND_OCHRE} fill={BRAND_OCHRE} strokeWidth={1.8} />
          <TText
            style={{
              color: colors.text,
              fontSize: 13,
              fontWeight: "700",
              marginLeft: 6,
              letterSpacing: 0.3,
            }}
          >
            {t("space.couple.daysTogether", { n: togetherDays })}
          </TText>
        </View>
      )}
      {counters !== null && (counters.togetherListens > 0 || counters.loveLetters > 0) && (
        <TText style={{ color: colors.muted, fontSize: 12, marginTop: 6, textAlign: "center" }}>
          {t("space.couple.counters", {
            listens: counters.togetherListens,
            letters: counters.loveLetters,
          })}
        </TText>
      )}
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
  { page: "loveLetters", labelKey: "space.cards.loveLetters", icon: ScrollText },
];

const TAPE_ROTATION: Record<string, TapeColor> = {
  feed: "pink",
  anniversary: "lavender",
  diary: "yellow",
  garden: "mint",
  status: "blue",
  tellLater: "pink",
  works: "yellow",
  music: "blue",
  loveLetters: "pink",
};

// ---- Today card: a quiet daily briefing — anniversaries, on-this-day, her mood ----

// D12 P2-1: intimacy phase copy, derived from real days-together only.
const INTIMACY_PHASE_KEY: Record<IntimacyPhase, StringKey> = {
  budding: "space.today.intimacy.budding",
  warming: "space.today.intimacy.warming",
  steady: "space.today.intimacy.steady",
  deep: "space.today.intimacy.deep",
};

function TodayCard() {
  const v = useOurSpaceVersion();
  const colors = useColors();
  const [rows, setRows] = useState<Array<{ key: string; icon: typeof Heart; text: string }>>([]);
  const [dateLine, setDateLine] = useState("");

  useEffect(() => {
    const locale = getLocale() === "zh-Hans" ? "zh-CN" : "en-US";
    setDateLine(
      new Date().toLocaleDateString(locale, { month: "long", day: "numeric", weekday: "long" }),
    );
    void (async () => {
      const [anniversaries, diary, timeline, mood, profile] = await Promise.all([
        ourSpaceStore.listAnniversaries(),
        ourSpaceStore.listDiary(),
        ourSpaceStore.listTimeline(),
        ourSpaceStore.getHerMood(),
        ourSpaceStore.getCoupleProfile(),
      ]);
      const next: Array<{ key: string; icon: typeof Heart; text: string }> = [];
      const togetherDays = daysTogether(resolveTogetherSince(profile, anniversaries));
      if (togetherDays !== null) {
        // D12 P2-1: quiet intimacy line — "在一起的第 N 天 · 热恋升温中".
        const phase = intimacyPhase(togetherDays);
        const base = t("space.today.togetherDays", { n: togetherDays });
        next.push({
          key: "together-days",
          icon: Heart,
          text: phase ? `${base} · ${t(INTIMACY_PHASE_KEY[phase])}` : base,
        });
      }
      for (const a of getUpcomingAnniversaries(anniversaries).slice(0, 2)) {
        next.push({
          key: `ann-${a.title}-${a.occurrence}`,
          icon: CalendarHeart,
          text:
            a.daysUntil === 0
              ? t("space.today.anniversaryToday", { title: a.title })
              : t("space.today.anniversarySoon", { title: a.title, n: a.daysUntil }),
        });
      }
      for (const item of getOnThisDay(diary, timeline, anniversaries).slice(0, 2)) {
        next.push({
          key: `otd-${item.kind}-${item.originalDate}-${item.title}`,
          icon: History,
          text: t("space.today.onThisDay", { title: item.title }),
        });
      }
      if (mood) {
        next.push({
          key: `mood-${mood.updatedAt}`,
          icon: Heart,
          text: t("space.today.herMood", { mood: mood.mood }),
        });
      }
      setRows(next);
    })();
  }, [v]);

  return (
    <View style={{ paddingTop: 14 }}>
      <SoftCard tape="mint">
        <View
          style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}
        >
          <HandText style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>
            {t("space.today.title")}
          </HandText>
          <TText style={{ color: colors.muted, fontSize: 12 }}>{dateLine}</TText>
        </View>
        <View style={{ gap: 10, marginTop: 12 }}>
          {rows.length === 0 ? (
            <TText style={{ color: colors.muted, fontSize: 13.5, lineHeight: 22 }}>
              {t("space.today.quiet")}
            </TText>
          ) : (
            rows.map((r) => {
              const Icon = r.icon;
              return (
                <View key={r.key} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Icon size={16} color={colors.muted} strokeWidth={1.8} />
                  <TText style={{ color: colors.text, fontSize: 13.5, flex: 1 }}>{r.text}</TText>
                </View>
              );
            })
          )}
        </View>
      </SoftCard>
    </View>
  );
}

// ---- D12 P2-3: "今晚的问题" daily question card ----
// One light couple question per day (local bank, deterministic rotation).
// Her answer settles into 我们的时光 via addTimeline — pure local, no backend.

const QUESTION_CAT_KEY: Record<QuestionCategory, StringKey> = {
  icebreaker: "space.question.cat.icebreaker",
  memory: "space.question.cat.memory",
  future: "space.question.cat.future",
  intimate: "space.question.cat.intimate",
};

function QuestionCard() {
  const colors = useColors();
  const [question, setQuestion] = useState<DailyQuestion | null>(null);
  const [answered, setAnswered] = useState(false);
  const [answer, setAnswer] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const q = questionForDate(new Date());
    setQuestion(q);
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(QUESTION_STATE_KEY);
        if (!raw) return;
        const s = JSON.parse(raw) as Partial<QuestionState>;
        setAnswered(
          s.date === dateKey(new Date()) && s.questionId === q.id && s.answered === true,
        );
      } catch {
        // No saved state — fresh question.
      }
    })();
  }, []);

  const submit = () => {
    const text = answer.trim();
    if (!text || !question || saving) return;
    setSaving(true);
    void (async () => {
      try {
        const qText = getLocale() === "en" ? question.en : question.zh;
        await ourSpaceStore.addTimeline(
          t("space.question.timelineTitle") as string,
          `${qText}\n${text}`,
          "moment",
        );
        const state: QuestionState = {
          date: dateKey(new Date()),
          questionId: question.id,
          answered: true,
        };
        await AsyncStorage.setItem(QUESTION_STATE_KEY, JSON.stringify(state));
        setAnswered(true);
        setAnswer("");
      } catch {
        // Keep the draft; she can retry.
      } finally {
        setSaving(false);
      }
    })();
  };

  if (!question) return null;
  const qText = getLocale() === "en" ? question.en : question.zh;
  const canSubmit = !saving && answer.trim().length > 0;

  return (
    <View style={{ marginTop: 14 }}>
      <SoftCard tape="pink">
        <View
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <MessageCircleQuestion size={16} color={colors.muted} strokeWidth={1.8} />
            <HandText style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>
              {t("space.question.title")}
            </HandText>
          </View>
          <TText style={{ color: colors.muted, fontSize: 12 }}>
            {t(QUESTION_CAT_KEY[question.category])}
          </TText>
        </View>
        <TText style={{ color: colors.text, fontSize: 14.5, lineHeight: 23, marginTop: 10 }}>
          {qText}
        </TText>
        {answered ? (
          <TText style={{ color: colors.muted, fontSize: 13, marginTop: 10 }}>
            {t("space.question.answered")}
          </TText>
        ) : (
          <View style={{ marginTop: 10 }}>
            <TextInput
              value={answer}
              onChangeText={setAnswer}
              placeholder={t("space.question.placeholder") as string}
              placeholderTextColor={colors.muted}
              multiline
              style={{
                color: colors.text,
                fontSize: 14,
                lineHeight: 22,
                minHeight: 64,
                textAlignVertical: "top",
              }}
            />
            <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 10 }}>
              <PressableScale onPress={submit} accessibilityRole="button">
                <View
                  style={{
                    backgroundColor: colors.blue,
                    borderRadius: radii.md,
                    paddingHorizontal: 18,
                    paddingVertical: 10,
                    opacity: canSubmit ? 1 : 0.5,
                  }}
                >
                  <TText style={{ color: colors.onBlue, fontSize: 14, fontWeight: "600" }}>
                    {t("space.question.submit")}
                  </TText>
                </View>
              </PressableScale>
            </View>
          </View>
        )}
      </SoftCard>
    </View>
  );
}

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
                  borderRadius: radii.lg,
                  borderTopLeftRadius: radii.lg,
                  borderBottomRightRadius: radii.xl,
                  borderWidth: 1,
                  borderColor: colors.line,
                  padding: 16,
                  alignItems: "center",
                  gap: 8,
                  minHeight: 108,
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                <PaperGrain />
                <WashiTape
                  color={TAPE_ROTATION[card.page] ?? "pink"}
                  style={{ top: -8, right: 14 }}
                  rotate={i % 2 === 0 ? 8 : -8}
                  width={64}
                />
                <Icon size={26} color={colors.text} strokeWidth={1.5} />
                <HandText style={{ color: colors.text, fontSize: 13, fontWeight: "600" }}>
                  {t(card.labelKey)}
                </HandText>
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
        <PressableScale onPress={onBack} accessibilityRole="button" accessibilityLabel={t("a11y.back")}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: radii.lg,
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
        <HandText style={{ color: colors.text, fontSize: 18, fontWeight: "700", marginLeft: 4 }}>
          {title}
        </HandText>
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
        borderRadius: radii.lg,
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
          style={{ width: "100%", height: 160, borderRadius: radii.md, marginTop: 8 }}
          resizeMode="cover"
        />
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 10, gap: 8 }}>
        <PressableScale onPress={() => void pickImage()} accessibilityRole="button">
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: radii.lg,
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
              backgroundColor: tokens.accent.bg,
              borderRadius: 999,
              paddingHorizontal: 18,
              paddingVertical: 9,
              opacity: !text.trim() && !imageUri ? 0.45 : 1,
            }}
          >
            <Send size={14} color={tokens.accent.fg} strokeWidth={2} />
            <TText style={{ color: tokens.accent.fg, fontSize: 13, fontWeight: "700" }}>
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
              borderRadius: radii.lg,
              backgroundColor: post.author === "ai" ? tokens.accent.bg : colors.sky,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <TText style={{ fontSize: 13, fontWeight: "700", color: colors.text }}>
              {post.author === "ai" ? "AI" : t("space.feed.authorHer")}
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
          <DeleteEntryButton
            onDelete={async () => {
              await ourSpaceStore.deleteFeedPost(post.id);
              onChanged();
            }}
          />
        </View>

        {post.text ? (
          <TText style={{ color: colors.text, fontSize: 14.5, lineHeight: 23 }}>{post.text}</TText>
        ) : null}
        {post.imageUri ? (
          <Image
            source={{ uri: post.imageUri }}
            style={{ width: "100%", height: 220, borderRadius: radii.md }}
            resizeMode="cover"
          />
        ) : null}

        {replies.length > 0 && (
          <View
            style={{
              backgroundColor: colors.sky,
              borderRadius: radii.md,
              padding: 10,
              gap: 6,
            }}
          >
            {replies.map((r) => (
              <View key={r.id} style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                <TText style={{ color: tokens.accent.fg, fontSize: 12.5, fontWeight: "700" }}>
                  {r.author === "ai" ? t("space.couple.aiAvatar") : t("space.couple.herAvatar")}:
                </TText>
                <TText style={{ color: colors.text, fontSize: 12.5, flex: 1 }}>{r.text}</TText>
                <DeleteEntryButton
                  onDelete={async () => {
                    await ourSpaceStore.deleteReply(r.id);
                    const updated = await ourSpaceStore.listReplies(post.id);
                    setReplies(updated);
                  }}
                />
              </View>
            ))}
          </View>
        )}

        <View style={{ flexDirection: "row", alignItems: "center", gap: 16, marginTop: 2 }}>
          <PressableScale onPress={() => void toggleLike("her")} accessibilityRole="button">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Heart
                size={17}
                color={post.likedByHer ? BRAND_OCHRE : colors.muted}
                fill={post.likedByHer ? BRAND_OCHRE : "transparent"}
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
                  borderRadius: radii.lg,
                  backgroundColor: tokens.accent.bg,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Send size={15} color={tokens.accent.fg} strokeWidth={2} />
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
        <SelfpostSection />
        <FeedComposer onPosted={() => setTick((x) => x + 1)} />
        <EmptyState text={t("space.feed.empty")} />
      </>
    );
  }

  return (
    <View style={{ gap: 14 }}>
      <SelfpostSection />
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
  const { tokens, stageBundle } = useTheme();
  const [works, setWorks] = useState<WorkItem[]>([]);
  const [viewer, setViewer] = useState<WorkItem | null>(null);
  const [workNotice, setWorkNotice] = useState("");

  // P2-9: theme works stage as a try-on (she confirms in 外观 if she likes it).
  async function applyWorkTheme(uri: string) {
    setWorkNotice("");
    try {
      const FileSystem = await import("expo-file-system/legacy");
      const bundle = JSON.parse(await FileSystem.readAsStringAsync(uri));
      if (stageBundle(bundle)) setWorkNotice(t("space.works.themeApplied") as string);
      else setWorkNotice(t("space.works.actionFailed") as string);
    } catch {
      setWorkNotice(t("space.works.actionFailed") as string);
    }
  }

  // P2-9: file works open through the system share sheet.
  async function openWorkFile(uri: string) {
    setWorkNotice("");
    try {
      const Sharing = await import("expo-sharing");
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
      else setWorkNotice(t("space.works.actionFailed") as string);
    } catch {
      setWorkNotice(t("space.works.actionFailed") as string);
    }
  }

  useEffect(() => {
    void ourSpaceStore.listWorks().then(setWorks);
  }, [v]);

  return (
    <View>
      {works.length === 0 ? (
        <EmptyState text={t("space.works.empty")} />
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
                    borderRadius: radii.xs,
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
                  style={{ width: "100%", aspectRatio: 1, borderRadius: radii.md }}
                  resizeMode="contain"
                />
              ) : viewer.type === "html" ? (
                // P2-9: HTML works preview in a real WebView, not a URI line.
                <View
                  style={{
                    height: 440,
                    borderRadius: radii.md,
                    overflow: "hidden",
                    backgroundColor: colors.card,
                  }}
                >
                  <WebView source={{ uri: viewer.uri }} style={{ flex: 1 }} />
                </View>
              ) : (
                <View
                  style={{
                    backgroundColor: colors.card,
                    borderRadius: radii.lg,
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
                  {/* P2-9: theme works get a try-on button; files get open/share.
                      Every work type now does something — no dead ends. */}
                  {viewer.type === "theme" ? (
                    <Button small primary onPress={() => void applyWorkTheme(viewer.uri)}>
                      {t("space.works.tryTheme")}
                    </Button>
                  ) : viewer.type === "file" ? (
                    <Button small onPress={() => void openWorkFile(viewer.uri)}>
                      {t("space.works.openFile")}
                    </Button>
                  ) : null}
                  {!!workNotice && (
                    <TText style={{ color: colors.muted, fontSize: 12, textAlign: "center" }}>
                      {workNotice}
                    </TText>
                  )}
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
              <View style={{ alignItems: "center", marginTop: 12 }}>
                <PressableScale
                  onPress={() => {
                    Alert.alert(
                      t("space.entry.deleteTitle") as string,
                      t("space.entry.deleteBody") as string,
                      [
                        { text: t("common.cancel") as string, style: "cancel" },
                        {
                          text: t("common.delete") as string,
                          style: "destructive",
                          onPress: () =>
                            void ourSpaceStore.deleteWork(viewer.id).then(() => setViewer(null)),
                        },
                      ],
                    );
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t("common.delete") as string}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Trash2 size={15} color="rgba(255,255,255,0.75)" strokeWidth={1.7} />
                    <TText style={{ color: "rgba(255,255,255,0.75)", fontSize: 13 }}>
                      {t("common.delete")}
                    </TText>
                  </View>
                </PressableScale>
              </View>
            </View>
          )}
        </Pressable>
      </Modal>
    </View>
  );
}

// ---- v2: anniversaries ----

// ---- On this day: what happened on today's month-day in past years ----
function OnThisDayView() {
  const v = useOurSpaceVersion();
  const colors = useColors();
  const { tokens } = useTheme();
  const [items, setItems] = useState<OnThisDayItem[]>([]);

  useEffect(() => {
    void Promise.all([
      ourSpaceStore.listDiary(200),
      ourSpaceStore.listTimeline(200),
      ourSpaceStore.listAnniversaries(),
    ]).then(([diary, timeline, anniversaries]) => {
      setItems(getOnThisDay(diary, timeline, anniversaries));
    });
  }, [v]);

  if (items.length === 0) return null;

  const kindLabel: Record<OnThisDayItem["kind"], string> = {
    diary: t("space.diary.title"),
    timeline: t("space.timeline.title"),
    anniversary: t("space.anniversary.title"),
  };

  return (
    <View style={{ marginBottom: 8 }}>
      <TText
        style={{
          color: colors.muted,
          fontSize: 13,
          fontWeight: "700",
          marginBottom: 12,
          letterSpacing: 0.4,
        }}
      >
        {t("space.onThisDay.title")}
      </TText>
      {items.map((item, i) => (
        <StaggerIn key={`${item.kind}-${item.originalDate}-${item.title}`} index={i}>
          <SoftCard>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: radii.xl,
                  backgroundColor: tokens.accent.bg,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <History size={24} color={tokens.accent.fg} strokeWidth={1.6} />
              </View>
              <View style={{ flex: 1 }}>
                <TText style={{ color: colors.text, fontSize: 15, fontWeight: "700" }}>
                  {item.title}
                </TText>
                {item.subtitle ? (
                  <TText style={{ color: colors.muted, fontSize: 12.5, marginTop: 2 }}>
                    {item.subtitle}
                  </TText>
                ) : null}
                <TText style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
                  {t("space.onThisDay.yearsAgo", { n: item.yearsAgo })} · {kindLabel[item.kind]}
                </TText>
              </View>
            </View>
          </SoftCard>
        </StaggerIn>
      ))}
    </View>
  );
}

function AnniversaryPage() {
  const v = useOurSpaceVersion();
  const colors = useColors();
  const { tokens } = useTheme();
  const [items, setItems] = useState<Anniversary[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Anniversary | null>(null);
  const [fTitle, setFTitle] = useState("");
  const [fDate, setFDate] = useState("");
  const [fDesc, setFDesc] = useState("");
  const [fError, setFError] = useState("");

  useEffect(() => {
    void ourSpaceStore.listAnniversaries().then(setItems);
  }, [v]);

  const openAdd = () => {
    setFTitle("");
    setFDate("");
    setFDesc("");
    setFError("");
    setEditing(null);
    setAdding(true);
  };

  const openEdit = (a: Anniversary) => {
    setFTitle(a.title);
    setFDate(a.date);
    setFDesc(a.description);
    setFError("");
    setAdding(false);
    setEditing(a);
  };

  const closeComposer = () => {
    setAdding(false);
    setEditing(null);
    setFError("");
  };

  const saveAnniversary = async () => {
    const title = fTitle.trim();
    const date = fDate.trim();
    if (!title) {
      setFError(t("space.anniversary.titleRequired") as string);
      return;
    }
    try {
      if (editing) {
        await ourSpaceStore.updateAnniversary(editing.id, { title, date, description: fDesc });
      } else {
        await ourSpaceStore.addAnniversary(title, date, fDesc);
      }
      closeComposer();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setFError(
        (/date/i.test(msg)
          ? t("space.anniversary.badDate")
          : t("space.anniversary.titleRequired")) as string,
      );
    }
  };

  const addButton = (
    <PressableScale
      onPress={() => (adding || editing ? closeComposer() : openAdd())}
      accessibilityRole="button"
      accessibilityLabel={t("space.anniversary.add") as string}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          alignSelf: "flex-start",
          gap: 6,
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: radii.lg,
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: colors.card,
        }}
      >
        <Plus size={15} color={colors.text} strokeWidth={1.8} />
        <TText style={{ color: colors.text, fontSize: 13.5, fontWeight: "600" }}>
          {t("space.anniversary.add")}
        </TText>
      </View>
    </PressableScale>
  );

  const composer =
    adding || editing ? (
      <SoftCard>
        <TextInput
          value={fTitle}
          onChangeText={setFTitle}
          placeholder={t("space.anniversary.titlePlaceholder") as string}
          placeholderTextColor={colors.muted}
          style={{ color: colors.text, fontSize: 16, fontWeight: "700", marginBottom: 10 }}
        />
        <TextInput
          value={fDate}
          onChangeText={setFDate}
          placeholder={t("space.anniversary.datePlaceholder") as string}
          placeholderTextColor={colors.muted}
          keyboardType="numbers-and-punctuation"
          style={{ color: colors.text, fontSize: 14, marginBottom: 10 }}
        />
        <TextInput
          value={fDesc}
          onChangeText={setFDesc}
          placeholder={t("space.anniversary.descriptionPlaceholder") as string}
          placeholderTextColor={colors.muted}
          multiline
          style={{
            color: colors.text,
            fontSize: 14,
            lineHeight: 24,
            minHeight: 60,
            textAlignVertical: "top",
          }}
        />
        {!!fError && (
          <TText style={{ color: colors.danger, fontSize: 12.5, marginTop: 8 }}>{fError}</TText>
        )}
        <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
          <PressableScale onPress={() => void saveAnniversary()} accessibilityRole="button">
            <View
              style={{
                paddingHorizontal: 18,
                paddingVertical: 9,
                borderRadius: radii.lg,
                backgroundColor: colors.text,
              }}
            >
              <TText style={{ color: colors.card, fontSize: 13.5, fontWeight: "700" }}>
                {t("common.save")}
              </TText>
            </View>
          </PressableScale>
          <PressableScale onPress={closeComposer} accessibilityRole="button">
            <View style={{ paddingHorizontal: 14, paddingVertical: 9 }}>
              <TText style={{ color: colors.muted, fontSize: 13.5 }}>{t("common.cancel")}</TText>
            </View>
          </PressableScale>
        </View>
      </SoftCard>
    ) : null;

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
      {addButton}
      {composer}
      {items.length === 0 && !adding && !editing ? (
        <EmptyState text={t("space.anniversary.empty")} />
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
                      borderRadius: radii.xl,
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
                  <EditEntryButton onEdit={() => openEdit(a)} />
                  <DeleteEntryButton onDelete={() => ourSpaceStore.deleteAnniversary(a.id)} />
                </View>
              </SoftCard>
            </StaggerIn>
          );
        })
      )}
      <OnThisDayView />
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

// ---- Notes he left for her: shown first when she opens Our Space ----
function LeftNoteView() {
  const v = useOurSpaceVersion();
  const colors = useColors();
  const { tokens } = useTheme();
  const [notes, setNotes] = useState<LeftNote[]>([]);

  useEffect(() => {
    void ourSpaceStore.getUnseenNotes().then(setNotes);
  }, [v]);

  if (notes.length === 0) return null;

  const note = notes[0];
  const dismiss = () => {
    void ourSpaceStore.markNoteSeen(note.id);
  };

  return (
    <FadeIn>
      <View style={{ marginBottom: 18 }}>
        <SoftCard>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: radii.xl,
                backgroundColor: tokens.accent.bg,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <MailOpen size={22} color={tokens.accent.fg} strokeWidth={1.6} />
            </View>
            <View style={{ flex: 1 }}>
              <TText
                style={{
                  color: colors.muted,
                  fontSize: 11,
                  fontWeight: "700",
                  letterSpacing: 1.5,
                  marginBottom: 4,
                }}
              >
                {t("space.leftNote.title")}
              </TText>
              <TText style={{ color: colors.text, fontSize: 15, lineHeight: 22 }}>
                {note.text}
              </TText>
            </View>
          </View>
          <Pressable
            onPress={dismiss}
            style={{
              marginTop: 14,
              paddingVertical: 10,
              borderRadius: radii.md,
              backgroundColor: tokens.accent.bg,
              alignItems: "center",
            }}
          >
            <TText style={{ color: tokens.accent.fg, fontSize: 14, fontWeight: "700" }}>
              {t("space.leftNote.dismiss")}
            </TText>
          </Pressable>
        </SoftCard>
        {notes.length > 1 && (
          <TText style={{ color: colors.muted, fontSize: 11, marginTop: 8, textAlign: "center" }}>
            +{notes.length - 1}
          </TText>
        )}
      </View>
    </FadeIn>
  );
}

/** Unread love letters, shown front and center when she opens Our Space. */
function LoveLetterView() {
  const v = useOurSpaceVersion();
  const colors = useColors();
  const { tokens } = useTheme();
  const [letters, setLetters] = useState<LoveLetter[]>([]);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    void ourSpaceStore.getUnseenLoveLetters().then((ls) => {
      setLetters(ls);
      setOpened(false);
    });
  }, [v]);

  if (letters.length === 0) return null;

  const letter = letters[0];
  const dismiss = () => {
    void ourSpaceStore.markLoveLetterSeen(letter.id);
  };

  return (
    <FadeIn>
      <View style={{ marginBottom: 18 }}>
        <SoftCard>
          {!opened ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("space.loveLetter.tapToRead")}
              onPress={() => setOpened(true)}
              style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
            >
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: radii.xl,
                  backgroundColor: tokens.accent.bg,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Mail size={22} color={tokens.accent.fg} strokeWidth={1.6} />
              </View>
              <View style={{ flex: 1 }}>
                <TText
                  style={{
                    color: colors.text,
                    fontSize: 15,
                    fontWeight: "700",
                  }}
                >
                  {t("space.loveLetter.unreadBanner")}
                </TText>
                <TText style={{ color: colors.muted, fontSize: 12.5, marginTop: 3 }}>
                  {t("space.loveLetter.tapToRead")}
                </TText>
              </View>
            </Pressable>
          ) : (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: radii.xl,
                    backgroundColor: tokens.accent.bg,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <MailOpen size={22} color={tokens.accent.fg} strokeWidth={1.6} />
                </View>
                <View style={{ flex: 1 }}>
                  <TText
                    style={{
                      color: colors.muted,
                      fontSize: 11,
                      fontWeight: "700",
                      letterSpacing: 1.5,
                      marginBottom: 4,
                    }}
                  >
                    {t("space.loveLetter.title")}
                  </TText>
                  <TText style={{ color: colors.text, fontSize: 15, lineHeight: 22 }}>
                    {letter.text}
                  </TText>
                </View>
              </View>
              <Pressable
                onPress={dismiss}
                style={{
                  marginTop: 14,
                  paddingVertical: 10,
                  borderRadius: radii.md,
                  backgroundColor: tokens.accent.bg,
                  alignItems: "center",
                }}
              >
                <TText style={{ color: tokens.accent.fg, fontSize: 14, fontWeight: "700" }}>
                  {t("space.loveLetter.dismiss")}
                </TText>
              </Pressable>
            </>
          )}
        </SoftCard>
        {letters.length > 1 && (
          <TText style={{ color: colors.muted, fontSize: 11, marginTop: 8, textAlign: "center" }}>
            +{letters.length - 1}
          </TText>
        )}
      </View>
    </FadeIn>
  );
}

/** All love letters, kept as a collection. */
function LoveLettersPage() {
  const v = useOurSpaceVersion();
  const colors = useColors();
  const [letters, setLetters] = useState<LoveLetter[]>([]);

  useEffect(() => {
    void ourSpaceStore.listLoveLetters().then(setLetters);
  }, [v]);

  if (letters.length === 0) {
    return (
      <View style={{ paddingTop: 40, alignItems: "center" }}>
        <TText style={{ color: colors.muted, fontSize: 14, textAlign: "center", lineHeight: 22 }}>
          {t("space.loveLetter.empty")}
        </TText>
      </View>
    );
  }

  return (
    <View style={{ gap: 14 }}>
      {letters.map((letter) => (
        <SoftCard key={letter.id}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
            <ScrollText size={18} color={colors.muted} strokeWidth={1.6} style={{ marginTop: 2 }} />
            <View style={{ flex: 1 }}>
              <TText style={{ color: colors.text, fontSize: 15, lineHeight: 24 }}>
                {letter.text}
              </TText>
              <TText style={{ color: colors.muted, fontSize: 11, marginTop: 8 }}>
                {new Date(letter.createdAt).toLocaleDateString()}
              </TText>
            </View>
            <DeleteEntryButton onDelete={() => ourSpaceStore.deleteLoveLetter(letter.id)} />
          </View>
        </SoftCard>
      ))}
    </View>
  );
}

export type OurSpaceStartPage = Exclude<SpacePage, { type: "home" }>["type"];

/**
 * user P2-1: proactive notification taps deep-link here.
 * startPage opens that page; startCompose opens the diary composer
 * straight away (the diary nudge offers "你写" — it must be real).
 * deepLinkId re-applies the link when it arrives after mount.
 */
export function OurSpaceScreen({
  startPage,
  startCompose,
  deepLinkId,
}: {
  startPage?: OurSpaceStartPage;
  startCompose?: boolean;
  deepLinkId?: number;
}) {
  const [page, setPage] = useState<SpacePage>(
    startPage ? { type: startPage } : { type: "home" },
  );
  const [composeDiary, setComposeDiary] = useState(false);
  useEffect(() => {
    if (deepLinkId == null) return;
    if (startPage) setPage({ type: startPage });
    setComposeDiary(startPage === "diary" && startCompose === true);
  }, [deepLinkId, startPage, startCompose]);
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
      loveLetters: t("space.cards.loveLetters"),
    };
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        <PageShell title={titles[page.type]} onBack={() => setPage({ type: "home" })}>
          {page.type === "feed" && <FeedPage />}
          {page.type === "works" && <WorksPage />}
          {page.type === "anniversary" && <AnniversaryPage />}
          {page.type === "diary" && <DiaryView autoCompose={composeDiary} />}
          {page.type === "garden" && <GardenView />}
          {page.type === "status" && (
            <>
              <StatusView />
              <HerMoodView />
            </>
          )}
          {page.type === "tellLater" && <TellLaterView />}
          {page.type === "loveLetters" && <LoveLettersPage />}
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
        <LeftNoteView />
        <LoveLetterView />
        <FadeIn>
          <CoupleHeader />
        </FadeIn>
        <FadeIn>
          <TodayCard />
        </FadeIn>
        <FadeIn>
          <QuestionCard />
        </FadeIn>
        <CardGrid onOpen={setPage} />
      </ScrollView>
    </View>
  );
}

/** Re-exported for tests that only need the tab model. */
export const SPACE_TABS: SpaceTab[] = ["status", "diary", "timeline", "garden", "tellLater"];
