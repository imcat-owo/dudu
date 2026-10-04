/**
 * Sandbox UI: backend switcher + Backend A (SSH/Docker) config + container
 * list + terminal. Sora gray style, compact, lucide icons, zero emoji.
 *
 * Mounted from AppearanceScreen (same place as DevicePermissionsSheet).
 */
import {
  ChevronRight,
  Cloud,
  Cpu,
  LoaderCircle,
  MonitorSmartphone,
  Play,
  PlugZap,
  RefreshCw,
  Square,
  Terminal as TerminalIcon,
  Trash2,
  Unplug,
} from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { TText } from "../font";
import { type StringKey, t } from "../i18n";
import {
  Button,
  Card,
  ErrorNotice,
  Field,
  SectionHeading,
  Sheet,
  useColors,
  useStyles,
} from "../ui";
import { sandboxManager } from "./manager";
import type {
  SandboxBackend,
  SandboxBackendId,
  SandboxConnectionState,
  SandboxEnvironment,
  SshConfig,
} from "./types";
import { radii } from "../theme/radii";

function StatusDot({ state }: { state: SandboxConnectionState }) {
  const colors = useColors();
  const color =
    state === "connected"
      ? "#7A9B6D"
      : state === "connecting"
        ? "#C99A3C"
        : state === "error"
          ? "#C15F3C"
          : colors.muted;
  return <View style={{ width: 8, height: 8, borderRadius: radii.xs, backgroundColor: color }} />;
}

function statusKey(state: SandboxConnectionState): string {
  return t(`sandbox.status.${state}` as StringKey);
}

function BackendCard({
  backend,
  active,
  onSelect,
}: {
  backend: SandboxBackend;
  active: boolean;
  onSelect: () => void;
}) {
  const colors = useColors();
  const s = useStyles();
  const Icon = backend.id === "cloud" ? Cloud : Cpu;
  const state = backend.connectionState();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      onPress={onSelect}
      style={[
        s.card,
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          borderWidth: active ? 2 : 1,
          borderColor: active ? colors.blueDark : colors.line,
        },
      ]}
    >
      <Icon size={20} color={active ? colors.blueDark : colors.muted} />
      <View style={{ flex: 1, gap: 2 }}>
        <TText style={{ fontSize: 14, fontWeight: "600", color: colors.text }}>
          {t(backend.nameKey as StringKey)}
        </TText>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <StatusDot state={state} />
          <TText style={{ fontSize: 12, color: colors.muted }}>{statusKey(state)}</TText>
        </View>
        {(() => {
          const detail = backend.stateDetail();
          return detail ? (
            <TText style={{ fontSize: 11, color: colors.muted }} numberOfLines={2}>
              {t(detail as StringKey)}
            </TText>
          ) : null;
        })()}
      </View>
      {active ? (
        <View style={{ width: 8, height: 8, borderRadius: radii.xs, backgroundColor: colors.blueDark }} />
      ) : null}
    </Pressable>
  );
}

function SshConfigForm({ onSaved }: { onSaved: () => void }) {
  const colors = useColors();
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("root");
  const [authType, setAuthType] = useState<"key" | "password">("key");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setError("");
    const portNum = Number.parseInt(port, 10);
    if (!host.trim() || !username.trim() || !secret.trim() || Number.isNaN(portNum)) {
      setError(t("sandbox.cloud.noConfig"));
      return;
    }
    setBusy(true);
    try {
      const config: SshConfig = {
        host: host.trim(),
        port: portNum,
        username: username.trim(),
        authType,
        privateKey: authType === "key" ? secret : null,
        password: authType === "password" ? secret : null,
      };
      await sandboxManager.saveSshConfig(config);
      setSecret("");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      <Field label={t("sandbox.host")} value={host} onChangeText={setHost} autoCapitalize="none" />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Field
            label={t("sandbox.port")}
            value={port}
            onChangeText={setPort}
            keyboardType="number-pad"
          />
        </View>
        <View style={{ flex: 2 }}>
          <Field
            label={t("sandbox.username")}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
          />
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {(["key", "password"] as const).map((k) => (
          <Pressable
            key={k}
            accessibilityRole="radio"
            accessibilityState={{ checked: authType === k }}
            onPress={() => setAuthType(k)}
            style={{
              flex: 1,
              paddingVertical: 10,
              borderRadius: radii.sm,
              borderWidth: 1,
              borderColor: authType === k ? colors.blueDark : colors.line,
              alignItems: "center",
            }}
          >
            <TText style={{ fontSize: 13, color: authType === k ? colors.text : colors.muted }}>
              {t(`sandbox.authType.${k}` as StringKey)}
            </TText>
          </Pressable>
        ))}
      </View>
      <Field
        label={authType === "key" ? t("sandbox.privateKey") : t("sandbox.password")}
        value={secret}
        onChangeText={setSecret}
        secureTextEntry={authType === "password"}
        multiline={authType === "key"}
        autoCapitalize="none"
      />
      {error ? <ErrorNotice error={error} /> : null}
      <Button primary onPress={save} disabled={busy}>
        {busy ? <LoaderCircle size={16} /> : t("sandbox.saveAndConnect")}
      </Button>
    </View>
  );
}

function ContainerList({ backend }: { backend: SandboxBackend }) {
  const colors = useColors();
  const [envs, setEnvs] = useState<SandboxEnvironment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setEnvs(await backend.listEnvironments());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [backend]);

  useEffect(() => {
    if (backend.connectionState() === "connected") void refresh();
  }, [backend, refresh]);

  const toggle = async (env: SandboxEnvironment) => {
    setError("");
    try {
      if (env.status === "running" || env.status === "booted")
        await backend.stopEnvironment(env.id);
      else await backend.startEnvironment(env.id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (backend.connectionState() !== "connected") return null;
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <SectionHeading title={t("sandbox.containers")} />
        <Pressable onPress={refresh} disabled={busy} accessibilityLabel={t("common.retry")}>
          {busy ? (
            <LoaderCircle size={16} color={colors.muted} />
          ) : (
            <RefreshCw size={16} color={colors.muted} />
          )}
        </Pressable>
      </View>
      {error ? <ErrorNotice error={error} /> : null}
      {envs.length === 0 && !busy ? (
        <TText style={{ fontSize: 13, color: colors.muted }}>{t("sandbox.noContainers")}</TText>
      ) : null}
      {envs.map((env) => {
        const running = env.status === "running" || env.status === "booted";
        return (
          <View
            key={env.id}
            style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 }}
          >
            <StatusDot state={running ? "connected" : "disconnected"} />
            <View style={{ flex: 1 }}>
              <TText style={{ fontSize: 13, fontWeight: "500", color: colors.text }}>
                {env.name}
              </TText>
              <TText style={{ fontSize: 11, color: colors.muted }}>
                {env.status}
                {env.image ? ` · ${env.image}` : ""}
              </TText>
            </View>
            {backend.id === "cloud" ? (
              <Pressable onPress={() => toggle(env)} accessibilityLabel={env.name}>
                {running ? (
                  <Square size={16} color={colors.muted} />
                ) : (
                  <Play size={16} color={colors.blueDark} />
                )}
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function Terminal({ backend }: { backend: SandboxBackend }) {
  const colors = useColors();
  const [command, setCommand] = useState("");
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const run = async () => {
    if (!command.trim() || running) return;
    setRunning(true);
    setOutput((o) => `${o}$ ${command}\n`);
    const cmd = command;
    setCommand("");
    try {
      const envs = await backend.listEnvironments();
      const id =
        envs.find((e) => e.status === "running" || e.status === "booted")?.id ?? envs[0]?.id ?? "";
      const r = await backend.runCommand(id, cmd, (chunk) => {
        setOutput((o) => `${o}${chunk.data}`);
      });
      setOutput((o) => `${o}\n[exit ${r.exitCode}]\n`);
    } catch (e) {
      setOutput((o) => `${o}\n[error: ${e instanceof Error ? e.message : String(e)}]\n`);
    } finally {
      setRunning(false);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }
  };

  if (backend.connectionState() !== "connected") return null;
  return (
    <View style={{ gap: 8 }}>
      <SectionHeading title={t("sandbox.terminal.title")} />
      <ScrollView
        ref={scrollRef}
        style={{
          maxHeight: 220,
          backgroundColor: colors.canvas,
          borderRadius: radii.sm,
          padding: 10,
          borderWidth: 1,
          borderColor: colors.line,
        }}
      >
        <TText style={{ fontSize: 12, color: colors.text, fontFamily: "Menlo" }}>
          {output || t("sandbox.terminal.empty")}
        </TText>
      </ScrollView>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Field
            label={t("sandbox.terminal.command")}
            value={command}
            onChangeText={setCommand}
            autoCapitalize="none"
            onSubmitEditing={run}
          />
        </View>
        <View style={{ justifyContent: "flex-end", paddingBottom: 4 }}>
          <Button primary onPress={run} disabled={running || !command.trim()}>
            {running ? <LoaderCircle size={16} /> : <TerminalIcon size={16} />}
          </Button>
        </View>
      </View>
    </View>
  );
}

export function SandboxSheet({ onClose }: { onClose: () => void }) {
  const colors = useColors();
  const [ready, setReady] = useState(false);
  const [activeId, setActiveId] = useState<SandboxBackendId>("cloud");
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    void (async () => {
      await sandboxManager.init();
      if (live) {
        setActiveId(sandboxManager.activeBackendId());
        setReady(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const refresh = () => setTick((x) => x + 1);
  const backend = sandboxManager.backend(activeId);
  void tick;

  const select = async (id: SandboxBackendId) => {
    setError("");
    setBusy(true);
    try {
      await sandboxManager.setActiveBackend(id);
      setActiveId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    setError("");
    setBusy(true);
    try {
      await backend.connect();
    } catch (e) {
      setError(e instanceof Error ? t(e.message as StringKey) : String(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await backend.disconnect();
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const clearConfig = async () => {
    await sandboxManager.clearSshConfig();
    refresh();
  };

  /**
   * Recover from a terminal "error"/"unavailable" state without restarting
   * the app. reset() re-detects availability; afterwards the normal
   * disconnected UI (config form / connect button) comes back, or the
   * honest "unavailable" message stays with a way to try again later.
   */
  const retry = async () => {
    setError("");
    setBusy(true);
    try {
      backend.reset();
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const state = backend.connectionState();

  return (
    <Sheet title={t("sandbox.title")} onClose={onClose}>
      {!ready ? (
        <ActivityIndicator />
      ) : (
        <View style={{ gap: 14 }}>
          <TText style={{ fontSize: 12, color: colors.muted }}>{t("sandbox.switchBackend")}</TText>
          {(["cloud", "local"] as SandboxBackendId[]).map((id) => (
            <BackendCard
              key={id}
              backend={sandboxManager.backend(id)}
              active={id === activeId}
              onSelect={() => select(id)}
            />
          ))}
          {error ? <ErrorNotice error={error} /> : null}

          {state === "error" || state === "unavailable" ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button primary icon={RefreshCw} onPress={retry} disabled={busy}>
                {busy ? <LoaderCircle size={16} /> : t("common.retry")}
              </Button>
            </View>
          ) : null}

          {activeId === "cloud" && state === "disconnected" ? (
            <Card style={{ gap: 10 }}>
              <SshConfigForm
                onSaved={() => {
                  void connect();
                }}
              />
            </Card>
          ) : null}

          {state === "connected" ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button icon={Unplug} onPress={disconnect} disabled={busy}>
                {t("sandbox.disconnect")}
              </Button>
              {activeId === "cloud" ? (
                <Button icon={Trash2} onPress={clearConfig}>
                  {t("common.delete")}
                </Button>
              ) : null}
            </View>
          ) : state === "disconnected" && activeId === "cloud" && sandboxManager.hasSshConfig() ? (
            <Button primary icon={PlugZap} onPress={connect} disabled={busy}>
              {busy ? <LoaderCircle size={16} /> : t("sandbox.saveAndConnect")}
            </Button>
          ) : null}

          {activeId === "local" && state === "disconnected" ? (
            <Button primary icon={PlugZap} onPress={connect} disabled={busy}>
              {busy ? <LoaderCircle size={16} /> : t("sandbox.saveAndConnect")}
            </Button>
          ) : null}

          <ContainerList backend={backend} />
          <Terminal backend={backend} />

          <Pressable
            onPress={onClose}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              paddingVertical: 8,
            }}
          >
            <TText style={{ fontSize: 13, color: colors.muted }}>{t("common.done")}</TText>
            <ChevronRight size={14} color={colors.muted} />
          </Pressable>
        </View>
      )}
    </Sheet>
  );
}

/** Entry row for settings screens (AppearanceScreen). */
export function SandboxEntry({ onOpen }: { onOpen: () => void }) {
  const colors = useColors();
  const s = useStyles();
  return (
    <Pressable onPress={onOpen} style={[s.row, { alignItems: "center", gap: 12 }]}>
      <MonitorSmartphone size={20} color={colors.muted} />
      <View style={{ flex: 1 }}>
        <TText style={{ fontSize: 14, fontWeight: "500", color: colors.text }}>
          {t("sandbox.title")}
        </TText>
        <TText style={{ fontSize: 12, color: colors.muted }}>
          {t("sandbox.backend.cloud")} / {t("sandbox.backend.local")}
        </TText>
      </View>
      <ChevronRight size={16} color={colors.muted} />
    </Pressable>
  );
}
