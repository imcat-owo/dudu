/**
 * LocalApp — the pure client-side shell (dual-mode "local", the default).
 *
 * No backend, no login, no CopilotKit. The phone talks directly to the
 * user's configured API group. Only three sections exist here:
 *   chat        — ChatScreen with the LocalAgent (direct SSE)
 *   connections — ApiSettingsScreen (mode switch + API groups CRUD)
 *   appearance  — AppearanceScreen (already local-first from Phase 1)
 *
 * Backend-coupled contexts get honest stubs:
 * - WorkspaceContext: a minimal local Workspace (empty files/browsers,
 *   richThreads=false) + NullMuseApi (throws "cloudModeRequired" on any
 *   call — a loud failure, never a silent one).
 * - AgentWorkspace: LocalAgentWorkspaceProvider (undefined data, noop refresh).
 * - Threads: the real ThreadsProvider works with richThreads=false
 *   (it skips all backend calls when disabled).
 */

import {
  Heart,
  type LucideIcon,
  MessageCircle,
  Plug,
  SlidersHorizontal,
} from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { AppState, Dimensions, Pressable, Text, View } from "react-native";
import type { Section, Workspace } from "../../../packages/domain/src";
import { LocalAgentWorkspaceProvider } from "./agent-workspace";
import { MuseApi } from "./api";
import { ApiSettingsScreen } from "./api-groups/api-settings";
import { useChatMode } from "./api-groups/mode";
import { type FontSizeOption, setFontSizeOption } from "./app-settings";
import { AppearanceScreen } from "./appearance";
import AIBrowserView from "./browser/AIBrowserView";
import { ChatScreen } from "./chat";
import { CrossDialogTraceSheet } from "./chat/cross-dialog-ui";
import { ErrorBoundary } from "./error-boundary";
import { FontProvider } from "./font";
import { GlassView } from "./glass";
import { t, type StringKey } from "./i18n";
import type { NotificationPort, OutreachTriggerKind } from "./outreach/notify";
import { notificationDeepLink } from "./outreach/notify";
import { IncognitoProvider } from "./incognito";
import { PdfExtractBridge } from "./knowledge/pdf-bridge";
import { canOpenDetail } from "./local-detail-routing";
import { OurSpaceScreen, type OurSpaceStartPage } from "./our-space-ui";
import { registerFontSizeHandler } from "./settings/tools";
import { radii } from "./theme/radii";
import { shadows } from "./theme/shadows";
import { ThemeProvider } from "./theme/ThemeContext";
import { ThemeTransition } from "./theme-transition";
import { ThreadsProvider } from "./threads";
import { useColors } from "./ui";
import type { Detail } from "./workspace";
import { WorkspaceContext } from "./workspace";

type LocalSection = "chat" | "connections" | "appearance" | "space";

/** Bottom tab button. */
function TabButton({
  label,
  icon: Icon,
  active,
  onPress,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        flex: 1,
        height: 58,
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        backgroundColor: active ? colors.sky : "transparent",
        borderRadius: radii.xl,
      }}
    >
      <Icon size={22} strokeWidth={1.8} color={colors.text} />
      {/* P2-3: icons alone are guesswork — every tab gets a small label. */}
      <Text style={{ fontSize: 10, lineHeight: 12, color: colors.text }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Any backend call in local mode is a bug — fail loudly, not silently. */
class NullMuseApi extends MuseApi {
  constructor() {
    super("");
  }
  override request<T>(): Promise<T> {
    return Promise.reject(new Error("cloudModeRequired"));
  }
  override url(path: string): string {
    void path;
    throw new Error("cloudModeRequired");
  }
}

const LOCAL_WORKSPACE: Workspace = {
  mode: "sample",
  profile: { name: "", email: "" },
  mail: [],
  events: [],
  files: [],
  browsers: [],
  actions: [],
  activity: [],
  connections: [],
  runtime: { provider: "sample", configured: false, openbotConfigured: false, richThreads: false },
};

export function LocalApp() {
  const colors = useColors();
  const [section, setSection] = useState<LocalSection>("chat");
  const [toast, setToast] = useState("");
  // remount discipline for useChatAgent: ChatScreen must remount when the
  // chat mode flips (hook sets differ between cloud and local agent).
  const mode = useChatMode();
  const [prompt, setPrompt] = useState<{ id: number; text: string }>();
  // Detail sheets in local mode. Only crossDialogTrace is wired today —
  // the promised cross-dialog audit log must be openable in the mode she
  // actually uses (P1-2). Other detail types stay unhandled (no-op).
  const [detail, setDetail] = useState<Detail | null>(null);
  const api = useMemo(() => new NullMuseApi(), []);
  // user P2-1: proactive notification taps deep-link into the right screen.
  const [spaceLink, setSpaceLink] = useState<{
    id: number;
    page: OurSpaceStartPage;
    compose?: boolean;
  }>();

  // Wire the AI "set_font_size" tool to immediate apply.
  useEffect(() => {
    registerFontSizeHandler(async (option) => {
      await setFontSizeOption(option as FontSizeOption);
    });
  }, []);

  // user P2-1: tapping a proactive notification lands on the screen it is
  // about — the letter, the diary (composer open), the anniversary, the
  // tell-later queue — instead of whatever was open last. Never throws.
  useEffect(() => {
    let alive = true;
    let sub: { remove(): void } | null = null;
    const route = (data: unknown) => {
      try {
        const kind = (data as Record<string, unknown> | null | undefined)?.kind;
        const known =
          kind === "anniversary" ||
          kind === "tell_later" ||
          kind === "love_letter" ||
          kind === "silence" ||
          kind === "diary_nudge" ||
          kind === "on_this_day";
        const link = known
          ? notificationDeepLink(kind as OutreachTriggerKind)
          : { section: "chat" as const };
        if (link.section === "space" && link.page) {
          setSpaceLink({ id: Date.now(), page: link.page, compose: link.compose });
          setSection("space");
        } else {
          setSection("chat");
        }
      } catch {
        setSection("chat");
      }
    };
    void import("expo-notifications").then((m) => {
      if (!alive) return;
      sub = m.addNotificationResponseReceivedListener((response) => {
        route(response?.notification?.request?.content?.data);
      });
      // Cold start: the app was launched from the notification itself.
      void m
        .getLastNotificationResponseAsync()
        .then((response) => {
          if (alive && response) route(response.notification.request.content.data);
        })
        .catch(() => {});
    });
    return () => {
      alive = false;
      sub?.remove();
    };
  }, []);

  // Quietly sweep stale synthesized-speech caches (P2-24). Never blocks startup.
  useEffect(() => {
    void import("./voice/cache-cleanup").then((m) => m.cleanVoiceCache()).catch(() => {});
  }, []);

  // Proactive outreach (主动触达) lifecycle — local-first.
  // Foreground: cancel any scheduled nudge (she's here now), record presence.
  // Background: evaluate triggers and schedule AT MOST ONE notification.
  // No trigger = no message, ever. Never throws — lifecycle bookkeeping
  // must never break the app.
  useEffect(() => {
    let alive = true;
    void import("./outreach/instances").then((m) => {
      if (alive) void m.outreachStore.markOpened().catch(() => {});
    });
    const sub = AppState.addEventListener("change", (state) => {
      void (async () => {
        try {
          const [
            { outreachStore },
            { evaluateAndScheduleOutreach, cancelScheduledOutreach },
            notificationsModule,
            { crossDialogTraceStore },
            { ourSpaceStore },
          ] = await Promise.all([
            import("./outreach/instances"),
            import("./outreach/notify"),
            import("expo-notifications"),
            import("./chat/cross-dialog-instance"),
            import("./our-space/instance"),
          ]);
          if (!alive) return;
          // Adapter: expo-notifications module → NotificationPort. Keeps
          // notify.ts free of native imports (unit-testable in node).
          const notifPort: NotificationPort = {
            getPermissionsAsync: () => notificationsModule.getPermissionsAsync(),
            cancelScheduledNotificationAsync: (id: string) =>
              notificationsModule.cancelScheduledNotificationAsync(id),
            scheduleNotificationAsync: (req) =>
              notificationsModule.scheduleNotificationAsync({
                identifier: req.identifier,
                content: req.content,
                trigger: {
                  type: notificationsModule.SchedulableTriggerInputTypes.TIME_INTERVAL,
                  seconds: req.trigger.seconds,
                },
              }),
          };
          if (state === "background") {
            await evaluateAndScheduleOutreach({
              store: outreachStore,
              notifications: notifPort,
              trace: crossDialogTraceStore,
              data: {
                listAnniversaries: () => ourSpaceStore.listAnniversaries(),
                listPendingTellLater: async () =>
                  (await ourSpaceStore.listTellLater(false))
                    .filter((i) => !i.done)
                    .map((i) => ({ id: i.id, text: i.text })),
                countUnreadLoveLetters: async () =>
                  (await ourSpaceStore.getUnseenLoveLetters()).length,
                // Diary nudge (xiaomeng P2-1): last entry time + a real
                // anchor — the latest timeline event within 7 days. No
                // anchor = no nudge, ever.
                getDiaryNudgeInput: async () => {
                  const diary = await ourSpaceStore.listDiary(1).catch(() => []);
                  const lastEntryAt = diary.length > 0 ? diary[0].createdAt : null;
                  const timeline = await ourSpaceStore.listTimeline(5).catch(() => []);
                  const fresh = timeline.find(
                    (e) => Date.now() - e.timestamp < 7 * 86_400_000 && e.title.trim().length > 0,
                  );
                  return { lastEntryAt, anchor: fresh ? fresh.title.trim() : "" };
                },
                // on_this_day trigger (Fixer D, xiaomeng P1-1): "去年今日"
                // items — real memories from this date in past years.
                listOnThisDay: async () => {
                  const { getOnThisDay } = await import("./our-space/on-this-day");
                  const [diary, timeline, anniversaries] = await Promise.all([
                    ourSpaceStore.listDiary(200).catch(() => []),
                    ourSpaceStore.listTimeline(200).catch(() => []),
                    ourSpaceStore.listAnniversaries().catch(() => []),
                  ]);
                  return getOnThisDay(diary, timeline, anniversaries, new Date()).map((i) => ({
                    title: i.title,
                    subtitle: i.subtitle,
                    yearsAgo: i.yearsAgo,
                  }));
                },
                // Mood suppression (Fixer D, xiaomeng P2-4): no diary nudge
                // on top of a fresh "难过".
                getHerMood: () => ourSpaceStore.getHerMood().catch(() => null),
              },
              copy: (key, params) => t(key as StringKey, params),
            });
          } else if (state === "active") {
            // She's back — the nudge is no longer needed.
            await cancelScheduledOutreach(notifPort);
            await outreachStore.markOpened();
          }
        } catch {
          // Bookkeeping must never break the app lifecycle.
        }
      })();
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  const nav: { id: LocalSection; label: string; icon: LucideIcon }[] = [
    { id: "chat", label: t("tab.chat"), icon: MessageCircle },
    { id: "space", label: t("tab.space"), icon: Heart },
    { id: "connections", label: t("section.connections.title"), icon: Plug },
    { id: "appearance", label: t("appearance.title"), icon: SlidersHorizontal },
  ];

  const value = useMemo(
    () => ({
      workspace: LOCAL_WORKSPACE,
      api,
      section: section as Section,
      navigate: (next: Section) => {
        if (next === "chat" || next === "connections" || next === "appearance" || next === "space")
          setSection(next as LocalSection);
      },
      // Local shell has no goals/apps/activity screens — keep dead-button
      // suggestions out of the chat welcome card (P1-1).
      supportedSections: ["chat", "space", "connections", "appearance"] as Section[],
      refresh: () => Promise.resolve(),
      open: (d: Detail) => {
        if (canOpenDetail(d)) setDetail(d);
      },
      close: () => setDetail(null),
      notify: (message: string) => {
        setToast(message);
        setTimeout(() => setToast(""), 4000);
      },
      ask: (text: string) => {
        setPrompt({ id: Date.now(), text });
        setSection("chat");
      },
    }),
    [api, section],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      <ThreadsProvider>
        <LocalAgentWorkspaceProvider>
          <IncognitoProvider>
            <ThemeProvider>
              <FontProvider>
                <ThemeTransition>
                  <View style={{ flex: 1, backgroundColor: colors.canvas }}>
                    {/* AI browser WebView — always mounted (hidden) so the AI
                        browser tools work from any screen. The controller
                        requires a mounted WebView; without this the tools
                        throw "Browser is not ready". Kept off-screen at full
                        screen size (not 1x1) so browser_screenshot captures
                        a real page image instead of a 1px waste. */}
                    <View
                      style={{
                        position: "absolute",
                        left: -10000,
                        top: 0,
                        width: Dimensions.get("window").width,
                        height: Dimensions.get("window").height,
                        opacity: 0,
                        pointerEvents: "none",
                      }}
                    >
                      <AIBrowserView visible />
                    </View>
                    {/* PDF text extraction bridge for the AI knowledge_add_file
                        tool — hidden, mounts the pdf.js WebView on demand. */}
                    <PdfExtractBridge />
                    <View style={{ flex: 1 }}>
                      <ErrorBoundary resetKey={section} label={section}>
                        {section === "chat" ? (
                          <ChatScreen key={mode} prompt={prompt} active={true} />
                        ) : section === "space" ? (
                          <OurSpaceScreen
                            startPage={spaceLink?.page}
                            startCompose={spaceLink?.compose}
                            deepLinkId={spaceLink?.id}
                          />
                        ) : section === "connections" ? (
                          <ApiSettingsScreen />
                        ) : (
                          <AppearanceScreen />
                        )}
                      </ErrorBoundary>
                    </View>
                    {!!toast && (
                      <View
                        pointerEvents="box-none"
                        style={{
                          position: "absolute",
                          bottom: 94,
                          left: 20,
                          right: 20,
                          alignItems: "center",
                        }}
                      >
                        <View
                          style={{
                            padding: 14,
                            backgroundColor: colors.text,
                            borderRadius: radii.lg,
                            maxWidth: 560,
                          }}
                        >
                          <Text style={{ color: colors.canvas }}>{toast}</Text>
                        </View>
                      </View>
                    )}
                    <View style={{ paddingHorizontal: 20, paddingBottom: 24, paddingTop: 8 }}>
                      <GlassView
                        intensity={60}
                        style={{
                          borderRadius: radii.xl,
                          flexDirection: "row",
                          paddingHorizontal: 10,
                          paddingVertical: 8,
                          gap: 8,
                          // Tiered shadow (float): bottom nav bar.
                          ...shadows.float,
                        }}
                      >
                        {nav.map((item) => (
                          <TabButton
                            key={item.id}
                            label={item.label}
                            icon={item.icon}
                            active={section === item.id}
                            onPress={() => setSection(item.id)}
                          />
                        ))}
                      </GlassView>
                    </View>
                    {detail?.type === "crossDialogTrace" && <CrossDialogTraceSheet />}
                  </View>
                </ThemeTransition>
              </FontProvider>
            </ThemeProvider>
          </IncognitoProvider>
        </LocalAgentWorkspaceProvider>
      </ThreadsProvider>
    </WorkspaceContext.Provider>
  );
}
