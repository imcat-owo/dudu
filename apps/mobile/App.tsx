import { CopilotKitProvider } from "@copilotkit/react-native/headless";
import { StatusBar } from "expo-status-bar";
import {
  Bell,
  Check,
  Lightbulb,
  LogOut,
  type LucideIcon,
  Menu,
  MessageCircle,
  PanelsTopLeft,
  Shapes,
  SquareCheck,
  X,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Image,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import type { Section, Workspace } from "../../packages/domain/src";
import {
  AgentActivityScreen,
  AgentStatus,
  AppsScreen,
  GoalsScreen,
  IdeasScreen,
} from "./src/agent-ui";
import { AgentWorkspaceProvider, useAgentWorkspace } from "./src/agent-workspace";
import { API_URL, createSession, MuseApi } from "./src/api";
import { ApiSettingsScreen } from "./src/api-groups/api-settings";
import { useChatMode } from "./src/api-groups/mode";
import { AppearanceScreen } from "./src/appearance";
import { ChatScreen, WorkspaceTools } from "./src/chat";
import { ComputerEntry } from "./src/computer";
import { ComputerDraftProvider } from "./src/computer-drafts";
import { Details } from "./src/details";
import { FontProvider } from "./src/font";
import { t } from "./src/i18n";
import { IncognitoProvider } from "./src/incognito";
import { LocalApp } from "./src/local-app";
import { Splash } from "./src/splash";
import { BrowserScreen, CalendarScreen, FilesScreen, MailScreen } from "./src/screens";
import { tokenStore } from "./src/session-store";
import { ThemeProvider, useTheme } from "./src/theme/ThemeContext";
import { ThemeTransition } from "./src/theme-transition";
import { ThreadsProvider, ThreadsSheet, useMuseThread } from "./src/threads";
import {
  Button,
  Card,
  ErrorNotice,
  Field,
  IconButton,
  Mascot,
  useColors,
  useStyles,
} from "./src/ui";
import { type Detail, useWorkspace, WorkspaceContext } from "./src/workspace";

const nav: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: "chat", label: t("tab.chat"), icon: MessageCircle },
  { id: "activity", label: t("tab.activity"), icon: PanelsTopLeft },
  { id: "ideas", label: t("tab.ideas"), icon: Lightbulb },
  { id: "goals", label: t("tab.goals"), icon: SquareCheck },
  { id: "apps", label: t("tab.apps"), icon: Shapes },
];
const titles: Partial<Record<Section, { title: string; subtitle: string }>> = {
  activity: { title: t("section.activity.title"), subtitle: t("section.activity.subtitle") },
  ideas: { title: t("section.ideas.title"), subtitle: t("section.ideas.subtitle") },
  goals: {
    title: t("section.goals.title"),
    subtitle: t("section.goals.subtitle"),
  },
  apps: {
    title: t("section.apps.title"),
    subtitle: t("section.apps.subtitle"),
  },
  appearance: { title: t("appearance.title"), subtitle: t("appearance.subtitle") },
  connections: {
    title: t("section.connections.title"),
    subtitle: t("section.connections.subtitle"),
  },
  mail: { title: t("section.mail.title"), subtitle: t("section.mail.subtitle") },
  calendar: { title: t("section.calendar.title"), subtitle: t("section.calendar.subtitle") },
  browser: { title: t("section.browser.title"), subtitle: t("section.browser.subtitle") },
  files: { title: t("section.files.title"), subtitle: t("section.files.subtitle") },
};
export default function App() {
  // Dual-mode root: local (default) → pure client-side shell, no backend,
  // no login, no CopilotKit. Cloud → the original backend path.
  const mode = useChatMode();
  // Launch splash: Sora avatar bloom, then cross-fade into the app.
  const [splashed, setSplashed] = useState(false);
  if (!splashed) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Splash onDone={() => setSplashed(true)} />
      </SafeAreaProvider>
    );
  }
  if (mode === "local") {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <LocalApp />
      </SafeAreaProvider>
    );
  }
  return <CloudApp />;
}

function CloudApp() {
  const colors = useColors();
  const s = useStyles();
  const [token, setToken] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const connect = useCallback(async (key?: string) => {
    setBusy(true);
    setError("");
    try {
      const session = await createSession(key);
      setToken(session.token);
      await tokenStore.save(session.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);
  // Cold start: if a token was persisted, validate it once with a lightweight
  // authenticated request. Valid -> skip the login screen; expired/invalid ->
  // delete it and fall through to a fresh session. No stored token -> same
  // auto-connect as before (zero taps for the no-key local case).
  // Network errors keep the stored token and show an error instead.
  const restore = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const stored = await tokenStore.load();
      if (!stored) {
        await connect();
        return;
      }
      const response = await fetch(`${API_URL}/api/workspace`, {
        headers: { Authorization: `Bearer ${stored}` },
      });
      if (response.status === 401 || response.status === 403) {
        await tokenStore.clear();
        await connect();
        return;
      }
      if (!response.ok) throw new Error(`Could not reach your workspace (${response.status}).`);
      setToken(stored);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [connect]);
  const logout = useCallback(async () => {
    await tokenStore.clear();
    setError("");
    setToken("");
  }, []);
  useEffect(() => {
    void restore();
  }, [restore]);
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {token ? (
        <CopilotKitProvider
          runtimeUrl={`${API_URL}/api/copilotkit`}
          headers={{ Authorization: `Bearer ${token}` }}
        >
          <WorkspaceApp token={token} onLogout={() => void logout()} />
        </CopilotKitProvider>
      ) : (
        <SafeAreaView
          style={{
            flex: 1,
            backgroundColor: colors.canvas,
            justifyContent: "center",
            alignItems: "center",
            padding: 24,
          }}
        >
          <View style={{ width: "100%", maxWidth: 420, gap: 22, alignItems: "center" }}>
            <Mascot size={72} />
            <Text
              style={{ fontSize: 32, color: colors.text, letterSpacing: -1, fontWeight: "500" }}
            >
              {t("auth.welcome")}
            </Text>
            <Text style={[s.muted, { textAlign: "center" }]}>{t("app.tagline")}</Text>
            {busy ? (
              <ActivityIndicator color={colors.blueDark} />
            ) : (
              <Card style={{ width: "100%" }}>
                <ErrorNotice error={error} />
                <Field
                  label={t("auth.accessKeyLabel")}
                  value={accessKey}
                  onChangeText={setAccessKey}
                  secureTextEntry
                  placeholder={t("auth.accessKeyPlaceholder")}
                />
                <Button primary onPress={() => void connect(accessKey || undefined)}>
                  {t("auth.openWorkspace")}
                </Button>
                <Text style={[s.small, { marginTop: 15 }]}>
                  {t("auth.noKeyNote", { url: API_URL })}
                </Text>
              </Card>
            )}
          </View>
        </SafeAreaView>
      )}
    </SafeAreaProvider>
  );
}
function WorkspaceApp({ token, onLogout }: { token: string; onLogout: () => void }) {
  const colors = useColors();
  const s = useStyles();
  const api = useMemo(() => new MuseApi(token), [token]);
  const [workspace, setWorkspace] = useState<Workspace>();
  const [section, setSection] = useState<Section>("chat");
  const [detail, setDetail] = useState<Detail>();
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState<{ id: number; text: string }>();
  const refresh = useCallback(async () => {
    const snapshot = await api.request<Workspace>("/api/workspace");
    setWorkspace(snapshot);
    setError("");
  }, [api]);
  useEffect(() => {
    void refresh().catch((e) => setError(String(e)));
  }, [refresh]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh().catch((e) => setError(String(e)));
    });
    return () => listener.remove();
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  const navigate = useCallback((next: Section) => setSection(next === "today" ? "chat" : next), []);
  const open = useCallback((next: Detail) => setDetail(next), []);
  const close = useCallback(() => setDetail(undefined), []);
  const ask = useCallback((text: string) => {
    setPrompt({ id: Date.now(), text });
    setSection("chat");
  }, []);
  if (!workspace)
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: colors.canvas,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          gap: 18,
        }}
      >
        <Mascot size={56} />
        {error ? (
          <>
            <ErrorNotice error={error} />
            <Button onPress={() => void refresh().catch((e) => setError(String(e)))}>
              Try again
            </Button>
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.blueDark} />
            <Text style={s.muted}>Opening your workspace…</Text>
          </>
        )}
      </SafeAreaView>
    );
  return (
    <WorkspaceContext.Provider
      value={{ workspace, api, section, navigate, refresh, open, close, notify: setToast, ask }}
    >
      <AgentWorkspaceProvider>
        <ComputerDraftProvider key={token}>
          <ThreadsProvider>
            <IncognitoProvider>
              <ThemeProvider apiToken={token}>
                <FontProvider>
                  <WorkspaceShell
                    detail={detail}
                    toast={toast}
                    clearToast={() => setToast("")}
                    error={error}
                    prompt={prompt}
                    onLogout={onLogout}
                  />
                </FontProvider>
              </ThemeProvider>
            </IncognitoProvider>
          </ThreadsProvider>
        </ComputerDraftProvider>
      </AgentWorkspaceProvider>
    </WorkspaceContext.Provider>
  );
}
function WorkspaceShell({
  detail,
  toast,
  clearToast,
  error,
  prompt,
  onLogout,
}: {
  detail?: Detail;
  toast: string;
  clearToast: () => void;
  error: string;
  prompt?: { id: number; text: string };
  onLogout: () => void;
}) {
  const colors = useColors();
  const s = useStyles();
  const { workspace, section, navigate, open } = useWorkspace();
  const { data } = useAgentWorkspace();
  const {
    selection,
    visited,
    mainId,
    loading: threadsLoading,
    error: threadsError,
    retry: retryThreads,
    enabled: richThreads,
  } = useMuseThread();
  const [threadsOpen, setThreadsOpen] = useState(false);
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const pending =
    (data?.notifications.filter((n) => !n.read).length || 0) +
    workspace.actions.filter((a) => a.status === "awaiting_review").length;
  const activeTask =
    data?.tasks.find(
      (task) => task.status === "waiting_approval" || task.status === "waiting_input",
    ) || data?.tasks.find((task) => task.status === "running");
  const agentName = data?.identity.name || "Dudu";
  const status = activeTask
    ? activeTask.status === "waiting_approval"
      ? t("status.readyReview", { title: activeTask.title })
      : activeTask.status === "waiting_input"
        ? t("status.needsInput", { title: activeTask.title })
        : activeTask.plan.find((step) => step.status === "running")?.title || activeTask.title
    : data?.tasks.some((task) => task.status === "queued")
      ? t("status.nextTask")
      : t("status.idle");
  const title = titles[section] || titles.apps;
  const Screen =
    section === "mail"
      ? MailScreen
      : section === "calendar"
        ? CalendarScreen
        : section === "browser"
          ? BrowserScreen
          : section === "files"
            ? FilesScreen
            : section === "activity"
              ? AgentActivityScreen
              : section === "ideas"
                ? IdeasScreen
                : section === "goals"
                  ? GoalsScreen
                  : section === "appearance"
                    ? AppearanceScreen
                    : section === "connections"
                      ? ApiSettingsScreen
                      : AppsScreen;
  const utility = ["mail", "calendar", "browser", "files", "appearance", "connections"].includes(
    section,
  );
  const { bundle } = useTheme();
  const wallpaper = bundle.wallpaper;
  return (
    <>
      <WorkspaceTools />
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={["top", "bottom"]}>
        {wallpaper ? (
          <View
            pointerEvents="none"
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          >
            <Image
              source={{ uri: wallpaper.uri }}
              style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
              resizeMode={wallpaper.fit}
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
                opacity: wallpaper.dim,
              }}
            />
          </View>
        ) : null}
        <ThemeTransition>
          <View style={{ flex: 1, width: "100%", maxWidth: 760, alignSelf: "center" }}>
            <View
              style={{
                height: desktop ? 146 : 122,
                paddingTop: desktop ? 14 : 2,
                marginHorizontal: 20,
              }}
            >
              <View style={{ position: "absolute", left: 0, top: 16 }}>
                <IconButton
                  icon={Menu}
                  label={t("a11y.openMenu")}
                  onPress={() => setThreadsOpen(true)}
                />
              </View>
              <View style={{ alignItems: "center", gap: 1 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${agentName} activity and approvals`}
                  onPress={() => navigate("activity")}
                  style={({ pressed }) => ({
                    alignItems: "center",
                    maxWidth: "70%",
                    opacity: pressed ? 0.65 : 1,
                  })}
                >
                  <Mascot
                    size={desktop ? 58 : 49}
                    index={
                      { sky: 0, sand: 1, lilac: 2 }[
                        data?.identity.avatar as "sky" | "sand" | "lilac"
                      ] ?? 0
                    }
                  />
                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: "600",
                      color: colors.text,
                      letterSpacing: -0.4,
                    }}
                  >
                    {agentName}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={{ fontSize: 11, color: colors.muted, marginBottom: 6 }}
                  >
                    {status}
                  </Text>
                </Pressable>
                {section === "chat" && <ComputerEntry />}
              </View>
              <View
                style={{ position: "absolute", right: 0, top: 16, flexDirection: "row", gap: 8 }}
              >
                <IconButton icon={LogOut} label={t("auth.logout")} onPress={onLogout} />
                <View>
                  <IconButton
                    icon={Bell}
                    label={`Notifications, ${pending} unread or pending`}
                    onPress={() => open({ type: "notifications" })}
                  />
                  {pending > 0 && (
                    <View
                      pointerEvents="none"
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 4,
                        position: "absolute",
                        top: 7,
                        right: 9,
                        backgroundColor: colors.blueDark,
                      }}
                    />
                  )}
                </View>
              </View>
            </View>
            <View style={{ flex: 1, minHeight: 0 }}>
              {section !== "chat" && (
                <ScrollView
                  key={section}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{
                    paddingHorizontal: desktop ? 42 : 22,
                    paddingBottom: 28,
                  }}
                  keyboardShouldPersistTaps="handled"
                >
                  {utility && (
                    <Button
                      small
                      style={{ alignSelf: "flex-start", marginBottom: 18 }}
                      onPress={() => navigate("apps")}
                    >
                      Back to Apps
                    </Button>
                  )}
                  <Text style={[s.title, { fontSize: 25, marginBottom: 22 }]}>{title?.title}</Text>
                  <ErrorNotice error={error} />
                  <Screen />
                </ScrollView>
              )}
              <View
                style={{
                  display: section === "chat" ? "flex" : "none",
                  flex: 1,
                  paddingHorizontal: desktop ? 42 : 17,
                }}
              >
                <AgentStatus />
                {richThreads ? (
                  <>
                    <ErrorNotice error={threadsError} />
                    {threadsError ? (
                      <Button onPress={retryThreads}>Retry main chat</Button>
                    ) : threadsLoading ? (
                      <ActivityIndicator color={colors.blueDark} />
                    ) : null}
                    {!threadsLoading && selection.id !== mainId && (
                      <Text style={[s.small, { textAlign: "center", marginBottom: 8 }]}>
                        Side chat
                      </Text>
                    )}
                    {visited.map((thread) => (
                      <View
                        key={thread.id}
                        style={{ display: selection.id === thread.id ? "flex" : "none", flex: 1 }}
                      >
                        <ChatScreen
                          thread={thread}
                          active={section === "chat" && selection.id === thread.id}
                          prompt={selection.id === thread.id ? prompt : undefined}
                        />
                      </View>
                    ))}
                  </>
                ) : (
                  <ChatScreen prompt={prompt} active={section === "chat"} />
                )}
              </View>
            </View>
            <View
              style={{
                paddingHorizontal: 22,
                paddingTop: 10,
                paddingBottom: desktop ? 22 : 7,
                alignItems: "center",
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  width: "100%",
                  maxWidth: 370,
                  padding: 5,
                  backgroundColor: "#FFF",
                  borderRadius: 40,
                  shadowColor: "#132631",
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.07,
                  shadowRadius: 18,
                  elevation: 3,
                  borderWidth: 1,
                  borderColor: "#F8F8F8",
                }}
              >
                {nav.map((item) => {
                  const active = section === item.id || (item.id === "apps" && utility);
                  return (
                    <Pressable
                      key={item.id}
                      accessibilityRole="tab"
                      accessibilityLabel={item.label}
                      accessibilityState={{ selected: active }}
                      onPress={() => navigate(item.id)}
                      style={{
                        flex: 1,
                        height: 47,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: active ? "#F0F1F2" : "transparent",
                        borderRadius: 28,
                      }}
                    >
                      <item.icon size={23} strokeWidth={1.8} color={colors.text} />
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>
        </ThemeTransition>
        {!!toast && (
          <View
            pointerEvents="box-none"
            style={{ position: "absolute", bottom: 94, left: 20, right: 20, alignItems: "center" }}
          >
            <View
              style={[
                s.row,
                {
                  gap: 10,
                  padding: 14,
                  backgroundColor: colors.text,
                  borderRadius: 20,
                  maxWidth: 560,
                },
              ]}
            >
              <Check size={16} color={colors.blue} />
              <Text style={{ color: "#FFF", fontSize: 13, flexShrink: 1 }}>{toast}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("a11y.dismissNotification")}
                onPress={clearToast}
              >
                <X size={16} color="#FFF" />
              </Pressable>
            </View>
          </View>
        )}
        {threadsOpen && <ThreadsSheet onClose={() => setThreadsOpen(false)} />}
        {detail && (
          <Details
            key={
              detail.type === "task"
                ? detail.taskId
                : detail.type === "file"
                  ? detail.file.id
                  : detail.type === "browser"
                    ? detail.browser.id
                    : detail.type === "mail"
                      ? detail.mail.id
                      : detail.type === "review"
                        ? detail.action.id
                        : detail.type === "email"
                          ? JSON.stringify(detail.draft)
                          : detail.type === "event"
                            ? detail.event?.id || "event-new"
                            : detail.type
            }
            detail={detail}
          />
        )}
      </SafeAreaView>
    </>
  );
}
