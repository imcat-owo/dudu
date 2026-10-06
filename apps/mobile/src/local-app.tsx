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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Dimensions, Pressable, View } from "react-native";
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
import { extrasPrefsReady, subscribeNewChat } from "./extras/prefs";
import { FontProvider, TText } from "./font";
import { GlassView } from "./glass";
import { type StringKey, t } from "./i18n";
import { IncognitoProvider, useIncognito } from "./incognito";
import { PdfExtractBridge } from "./knowledge/pdf-bridge";
import { canOpenDetail } from "./local-detail-routing";
import { createOurSpaceTools } from "./our-space/tools";
import { OurSpaceScreen, type OurSpaceStartPage } from "./our-space-ui";
import type { FeedNudgePost } from "./outreach/feed-nudge";
import type { NotificationPort, OutreachTriggerKind } from "./outreach/notify";
import { notificationDeepLink } from "./outreach/notify";
import { scheduledTaskDeepLink } from "./platform/scheduled-tasks";
import { registerFontSizeHandler } from "./settings/tools";
import { radii } from "./theme/radii";
import { shadows } from "./theme/shadows";
import { ThemeProvider } from "./theme/ThemeContext";
import { ThemeTransition } from "./theme-transition";
import { ThreadsProvider } from "./threads";
import { useColors } from "./ui";
import { VoiceCallBridge } from "./voice-call/ring-bridge";
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
      <TText style={{ fontSize: 10, lineHeight: 12, color: colors.text }} numberOfLines={1}>
        {label}
      </TText>
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

/**
 * AI self-post trigger （自发帖触发器） — foreground loop bridge.
 * Lives INSIDE IncognitoProvider (unlike the initiative loop) because the
 * self-post gate hard-blocks in incognito — the loop needs the live toggle.
 * Never blocks startup, never throws.
 */
function SelfpostLoopBridge() {
  const { incognito } = useIncognito();
  const incognitoRef = useRef(incognito);
  incognitoRef.current = incognito;
  useEffect(() => {
    let alive = true;
    let stop: (() => void) | null = null;
    void Promise.all([import("./selfpost/instances"), import("./selfpost/foreground-loop")])
      .then(([im, sm]) => {
        if (!alive) return;
        stop = sm.startSelfpostForegroundLoop(() =>
          im.buildSelfpostDeps({ isIncognito: () => incognitoRef.current }),
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
      try {
        stop?.();
      } catch {
        // ignore
      }
    };
  }, []);
  return null;
}

export function LocalApp() {
  const colors = useColors();
  const [section, setSection] = useState<LocalSection>("chat");
  const [toast, setToast] = useState("");
  // remount discipline for useChatAgent: ChatScreen must remount when the
  // chat mode flips (hook sets differ between cloud and local agent).
  const mode = useChatMode();
  const [prompt, setPrompt] = useState<{ id: number; text: string }>();
  // B2: share-extension intake target — drop shared content into the chat
  // prompt, same destination the cloud shell uses. Stable identity so the
  // intake effects below don't resubscribe.
  const askLocal = useCallback((text: string) => {
    setPrompt({ id: Date.now(), text });
    setSection("chat");
  }, []);
  // Gap fill A (local multi-dialog): which local dialog is open.
  // "local-main" is the legacy default. The ChatScreen remounts per thread
  // so each dialog gets its own agent/history lifecycle.
  const [localThreadId, setLocalThreadId] = useState("local-main");
  const newLocalThread = () => setLocalThreadId(`local-${Date.now().toString(36)}`);
  // Batch 7 I10: new-chat behavior prefs.
  useEffect(() => {
    // On launch: start fresh when the pref is on (prefs load async).
    let alive = true;
    void extrasPrefsReady().then((p) => {
      if (alive && p.newChatOnLaunch) newLocalThread();
    });
    // Cross-component "start a new chat" signal (dialog delete, persona
    // switch) — fired by dialog-ui.tsx when the matching pref is on.
    const unsub = subscribeNewChat(() => {
      if (alive) newLocalThread();
    });
    return () => {
      alive = false;
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
  // D10: scheduled-task notification taps deep-link into the tasks section
  // of settings (mirrors the spaceLink pattern above).
  const [appearanceLink, setAppearanceLink] = useState<{
    id: number;
    sectionId: string;
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
        // D10: a scheduled-task notification tap lands on the tasks section
        // of settings — the task's real page — instead of whatever was
        // open last.
        if (kind === "scheduled_task") {
          const link = scheduledTaskDeepLink();
          setAppearanceLink({ id: Date.now(), sectionId: link.sectionId });
          setSection(link.section);
          return;
        }
        // Aru-gap P0 (initiative): tapping a proactive-initiative template
        // notification opens chat and triggers the ONE promised AI
        // generation for that slot (not an auto-retry — the delivery).
        // DEFERRED (final audit 2026-10-06): tap opens the chat list only,
        // not the exact dialog the message landed in — the plan says
        // "点通知直跳对话", which needs thread-level deep-link infra.
        if (kind === "initiative") {
          const d = (data ?? {}) as Record<string, unknown>;
          const ruleId = typeof d.ruleId === "string" ? d.ruleId : "";
          const slotTime =
            typeof d.slotTime === "string"
              ? Number(d.slotTime)
              : typeof d.slotTime === "number"
                ? d.slotTime
                : 0;
          if (ruleId && slotTime > 0) {
            void Promise.all([import("./initiative/instances"), import("./initiative/scheduler")])
              .then(async ([im, sm]) => {
                const deps = await im.buildInitiativeDeps();
                await sm.handleInitiativeTap(deps, ruleId, slotTime);
              })
              .catch(() => {});
          }
          setSection("chat");
          return;
        }
        // Voice call ring: tapping the ring notification just opens the app —
        // VoiceCallBridge polls the proposal store and shows the ringing
        // overlay itself (no deep-link surgery needed).
        if (kind === "voice-call-ring") {
          setSection("chat");
          return;
        }
        // Aru-gap 轻控制 (open_app watchdog): tapping the "bring me back"
        // notification opens chat and triggers ONE welcome-back greeting
        // for that jump (idempotent — a double tap greets once).
        // DEFERRED (final audit 2026-10-06): tap opens the chat list only,
        // not the exact dialog the message landed in — needs thread-level
        // deep-link infra. Same deferred item as the initiative tap above.
        if (kind === "openapp-watch") {
          void import("./openapp/instances")
            .then(async (m) => {
              await m.handleOpenAppWatchTap(data);
            })
            .catch(() => {});
          setSection("chat");
          return;
        }
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

  // Proactive initiative （主动约定）: foreground tick (30s + every
  // foreground event). Due rules cancel their pre-scheduled notification
  // and run the AI path directly. Never blocks startup, never throws.
  useEffect(() => {
    let alive = true;
    let stop: (() => void) | null = null;
    void Promise.all([import("./initiative/instances"), import("./initiative/foreground-loop")])
      .then(([im, sm]) => {
        if (!alive) return;
        stop = sm.startInitiativeForegroundLoop(() => im.buildInitiativeDeps());
      })
      .catch(() => {});
    return () => {
      alive = false;
      try {
        stop?.();
      } catch {
        // ignore
      }
    };
  }, []);

  // Quietly sweep stale synthesized-speech caches (P2-24). Never blocks startup.
  useEffect(() => {
    void import("./voice/cache-cleanup").then((m) => m.cleanVoiceCache()).catch(() => {});
  }, []);

  // Auto-snapshot scheduler (D26): the settings switch is real now. Check on
  // cold start and on every foreground — one check per event, no timers,
  // never blocks startup, never throws.
  useEffect(() => {
    const run = () => {
      void import("./backup/snapshot-scheduler")
        .then((m) => m.runScheduledSnapshot())
        .catch(() => {});
    };
    run();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") run();
    });
    return () => sub.remove();
  }, []);

  // B2: share-extension intake in local mode (P1 silent drop). Drain the App
  // Group queue on cold start — the same consumePendingShare the cloud shell
  // uses — and again on every foreground, mirroring App.tsx. Best-effort.
  useEffect(() => {
    void import("./platform/share-intake")
      .then((m) => m.consumePendingShare(askLocal))
      .catch(() => {});
  }, [askLocal]);

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
                // Feed nudge (C3): her recent posts with AI-interaction
                // state, shaped for the nudge evaluator.
                listFeedForNudge: async () => {
                  const posts = await ourSpaceStore.listFeed(20).catch(() => []);
                  const out: FeedNudgePost[] = [];
                  for (const p of posts) {
                    const replies = await ourSpaceStore.listReplies(p.id).catch(() => []);
                    out.push({
                      id: p.id,
                      author: p.author,
                      text: p.text,
                      imageUri: p.imageUri,
                      createdAt: p.createdAt,
                      likedByAi: p.likedByAi,
                      hasAiReply: replies.some((r) => r.author === "ai"),
                    });
                  }
                  return out;
                },
              },
              // Feed nudge actions (C3): invoke the EXISTING feed_like /
              // feed_reply tool implementations — never reimplemented.
              // In-app tools carry no capability gate, so authorize is
              // never consulted; the ctx only satisfies the type.
              feedActions: {
                likePost: async (postId: string) => {
                  const tool = createOurSpaceTools(ourSpaceStore).find(
                    (x) => x.name === "feed_like",
                  );
                  if (!tool) throw new Error("feed_like tool not found");
                  await tool.run({ postId }, { authorize: async () => true });
                },
                replyToPost: async (postId: string, text: string) => {
                  const tool = createOurSpaceTools(ourSpaceStore).find(
                    (x) => x.name === "feed_reply",
                  );
                  if (!tool) throw new Error("feed_reply tool not found");
                  await tool.run({ postId, text }, { authorize: async () => true });
                },
                getPost: async (postId: string) => {
                  const posts = await ourSpaceStore.listFeed(100).catch(() => []);
                  const p = posts.find((x) => x.id === postId);
                  if (!p) return null;
                  const replies = await ourSpaceStore.listReplies(p.id).catch(() => []);
                  return {
                    id: p.id,
                    author: p.author,
                    text: p.text,
                    imageUri: p.imageUri,
                    createdAt: p.createdAt,
                    likedByAi: p.likedByAi,
                    hasAiReply: replies.some((r) => r.author === "ai"),
                  };
                },
              },
              // Shared proactive cap (initiative P2-2): outreach and the
              // initiative engine count against the same daily cap. The cap
              // key lives with the initiative store; outreach reads it here.
              // Outreach has no persona dimension, so it counts against the
              // global proactive total (all initiative sends today across
              // every persona + all outreach sends today) — conservative
              // by design. Read failures fall back to "allowed", mirroring
              // the executor's own cap check.
              checkSharedCap: async () => {
                try {
                  const [{ initiativeStore }, { selfpostStore }, { shanghaiDayStart }] =
                    await Promise.all([
                      import("./initiative/instances"),
                      import("./selfpost/instances"),
                      import("./initiative/rules"),
                    ]);
                  const now = Date.now();
                  const cap = await initiativeStore.getDailyCap();
                  const dayStart = shanghaiDayStart(now);
                  const initiativeSends = await initiativeStore.countAllSendsToday(now);
                  // Self-posts share the same "AI reaches her" daily budget.
                  const selfpostSends = await selfpostStore.countSendsToday(now).catch(() => 0);
                  const last = await outreachStore.getLastOutreachAt();
                  const outreachSends = Object.values(last).filter(
                    (v): v is number => typeof v === "number" && v >= dayStart,
                  ).length;
                  return initiativeSends + outreachSends + selfpostSends < cap;
                } catch {
                  return true;
                }
              },
              copy: (key, params) => t(key as StringKey, params),
            });
          } else if (state === "active") {
            // She's back — the nudge is no longer needed.
            await cancelScheduledOutreach(notifPort);
            await outreachStore.markOpened();
            // B2: she may have shared something in while we were away —
            // drain the App Group queue, same as the cloud shell.
            await import("./platform/share-intake")
              .then((m) => m.consumePendingShare(askLocal))
              .catch(() => {});
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
  }, [askLocal]);

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
      // B2: one definition — the same askLocal the share-intake effects use.
      ask: askLocal,
    }),
    [api, section],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      <ThreadsProvider>
        <LocalAgentWorkspaceProvider>
          <IncognitoProvider>
            <SelfpostLoopBridge />
            <VoiceCallBridge />
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
                          <ChatScreen
                            key={`${mode}-${localThreadId}`}
                            thread={{ id: localThreadId, existing: true }}
                            prompt={prompt}
                            active={true}
                            onSwitchThread={setLocalThreadId}
                            onNewThread={newLocalThread}
                          />
                        ) : section === "space" ? (
                          <OurSpaceScreen
                            startPage={spaceLink?.page}
                            startCompose={spaceLink?.compose}
                            deepLinkId={spaceLink?.id}
                          />
                        ) : section === "connections" ? (
                          <ApiSettingsScreen />
                        ) : (
                          <AppearanceScreen
                            focusSection={appearanceLink?.sectionId}
                            deepLinkId={appearanceLink?.id}
                          />
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
                          <TText style={{ color: colors.canvas }}>{toast}</TText>
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
