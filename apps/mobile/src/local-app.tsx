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
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Section, Workspace } from "../../../packages/domain/src";
import { LocalAgentWorkspaceProvider } from "./agent-workspace";
import { MuseApi } from "./api";
import { ApiSettingsScreen } from "./api-groups/api-settings";
import { AppearanceScreen } from "./appearance";
import { ChatScreen } from "./chat";
import { FontProvider } from "./font";
import { t } from "./i18n";
import { IncognitoProvider } from "./incognito";
import { OurSpaceScreen } from "./our-space-ui";
import { useDropZone } from "./pet/registry";
import { PetOverlay } from "./pet-ui";
import { ThemeProvider } from "./theme/ThemeContext";
import { ThemeTransition } from "./theme-transition";
import { ThreadsProvider } from "./threads";
import { useColors } from "./ui";
import { WorkspaceContext } from "./workspace";

type LocalSection = "chat" | "connections" | "appearance" | "space";

/** Bottom tab button — the chat/space tabs double as pet drop portals. */
function TabButton({
  id,
  label,
  icon: Icon,
  active,
  onPress,
}: {
  id: LocalSection;
  label: string;
  icon: LucideIcon;
  active: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const zoneRef = useDropZone(id === "space" ? "tab-space" : id === "chat" ? "tab-chat" : null);
  return (
    <Pressable
      ref={zoneRef}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        flex: 1,
        height: 47,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: active ? colors.sky : "transparent",
        borderRadius: 28,
      }}
    >
      <Icon size={23} strokeWidth={1.8} color={colors.text} />
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
  const [prompt, setPrompt] = useState<{ id: number; text: string }>();
  const api = useMemo(() => new NullMuseApi(), []);

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
      refresh: () => Promise.resolve(),
      open: () => {},
      close: () => {},
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
                    <View style={{ flex: 1 }}>
                      {section === "chat" ? (
                        <ChatScreen prompt={prompt} active={true} />
                      ) : section === "space" ? (
                        <OurSpaceScreen />
                      ) : section === "connections" ? (
                        <ApiSettingsScreen />
                      ) : (
                        <AppearanceScreen />
                      )}
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
                            borderRadius: 20,
                            maxWidth: 560,
                          }}
                        >
                          <Text style={{ color: colors.canvas }}>{toast}</Text>
                        </View>
                      </View>
                    )}
                    <View
                      style={{
                        flexDirection: "row",
                        paddingHorizontal: 16,
                        paddingBottom: 24,
                        paddingTop: 8,
                        gap: 8,
                      }}
                    >
                      {nav.map((item) => (
                        <TabButton
                          key={item.id}
                          id={item.id}
                          label={item.label}
                          icon={item.icon}
                          active={section === item.id}
                          onPress={() => setSection(item.id)}
                        />
                      ))}
                    </View>
                    <PetOverlay section={section} onNavigate={(next) => setSection(next)} />
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
