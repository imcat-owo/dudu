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

import {
  Activity,
  Bell,
  BookOpen,
  Check,
  Flower2,
  Heart,
  History,
  MessageCircleQuestion,
  MoonStar,
  Sprout,
} from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, ScrollView, View } from "react-native";
import { TText } from "./font";
import { type StringKey, t } from "./i18n";
import { DUR, EASE, exitDuration, STAGGER } from "./motion";
import { ourSpaceStore } from "./our-space/instance";
import type {
  AiStatus,
  DiaryEntry,
  MemoryConfidence,
  MemoryItem,
  TellLaterItem,
  TimelineEvent,
} from "./our-space/store";
import { useTheme } from "./theme/ThemeContext";
import { useColors } from "./ui";

type SpaceTab = "status" | "diary" | "timeline" | "garden" | "tellLater";

const TABS: { id: SpaceTab; labelKey: StringKey; icon: typeof Activity }[] = [
  { id: "status", labelKey: "space.tabs.status", icon: Activity },
  { id: "diary", labelKey: "space.tabs.diary", icon: BookOpen },
  { id: "timeline", labelKey: "space.tabs.timeline", icon: History },
  { id: "garden", labelKey: "space.tabs.garden", icon: Flower2 },
  { id: "tellLater", labelKey: "space.tabs.tellLater", icon: Bell },
];

function useOurSpaceVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => ourSpaceStore.subscribe(() => setV((x) => x + 1)), []);
  return v;
}

/** Soft fade-in when switching tabs or when content loads. */
function FadeIn({ children }: { children: React.ReactNode }) {
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
function StaggerIn({ index, children }: { index: number; children: React.ReactNode }) {
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
function PressableScale({
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

/** Warm, inviting empty state — each tab gets its own icon and breath. */
function EmptyState({ icon: Icon, text }: { icon: typeof Heart; text: string }) {
  const colors = useColors();
  const { tokens } = useTheme();
  return (
    <View style={{ paddingVertical: 56, paddingHorizontal: 36, alignItems: "center" }}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: colors.sky,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 18,
        }}
      >
        <Icon size={30} color={tokens.accent.fg} strokeWidth={1.4} />
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
function SoftCard({ children }: { children: React.ReactNode }) {
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
  const v = useOurSpaceVersion();
  const colors = useColors();
  const { tokens } = useTheme();
  const [items, setItems] = useState<MemoryItem[]>([]);

  useEffect(() => {
    void ourSpaceStore.listMemories().then(setItems);
  }, [v]);

  if (items.length === 0) return <EmptyState icon={Flower2} text={t("space.garden.empty")} />;

  return (
    <FadeIn>
      <View style={{ gap: 24 }}>
        {GARDEN_SECTIONS.map((sec) => {
          const list = items.filter((m) => m.confidence === sec.confidence);
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
                        {m.text}
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

export function OurSpaceScreen() {
  const colors = useColors();
  const { tokens } = useTheme();
  const [tab, setTab] = useState<SpaceTab>("status");

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 22, paddingTop: 18, paddingBottom: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 3 }}>
          <Heart size={20} color={tokens.accent.fg} strokeWidth={1.8} fill={tokens.accent.fg} />
          <TText
            style={{ color: colors.text, fontSize: 22, fontWeight: "800", letterSpacing: 0.5 }}
          >
            {t("space.title")}
          </TText>
        </View>
        <TText style={{ color: colors.muted, fontSize: 13, marginLeft: 30 }}>
          {t("space.subtitle")} · {todayLine()}
        </TText>
      </View>

      <View
        style={{
          flexDirection: "row",
          paddingHorizontal: 16,
          paddingVertical: 10,
          gap: 2,
        }}
      >
        {TABS.map((tb) => {
          const active = tab === tb.id;
          const Icon = tb.icon;
          return (
            <PressableScale
              key={tb.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={t(tb.labelKey)}
              onPress={() => setTab(tb.id)}
              style={{
                flex: 1,
                alignItems: "center",
                paddingVertical: 10,
                borderRadius: 16,
                backgroundColor: active ? colors.text : "transparent",
                gap: 4,
              }}
            >
              <Icon
                size={18}
                color={active ? colors.card : colors.muted}
                strokeWidth={active ? 2 : 1.6}
              />
              <TText
                style={{
                  color: active ? colors.card : colors.muted,
                  fontSize: 11,
                  fontWeight: active ? "700" : "400",
                  letterSpacing: 0.3,
                }}
              >
                {t(tb.labelKey)}
              </TText>
            </PressableScale>
          );
        })}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 10, paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
      >
        {tab === "status" && <StatusView />}
        {tab === "diary" && <DiaryView />}
        {tab === "timeline" && <TimelineView />}
        {tab === "garden" && <GardenView />}
        {tab === "tellLater" && <TellLaterView />}
      </ScrollView>
    </View>
  );
}

/** Re-exported for tests that only need the tab model. */
export const SPACE_TABS: SpaceTab[] = ["status", "diary", "timeline", "garden", "tellLater"];
