/**
 * Sandbox UI: backend switcher + Backend A (SSH/Docker) config + container
 * list + terminal. Sora gray style, compact, lucide icons, zero emoji.
 *
 * Mounted from AppearanceScreen (same place as DevicePermissionsSheet).
 */
import {
  Check,
  ChevronRight,
  Cloud,
  Copy,
  Cpu,
  LoaderCircle,
  MonitorSmartphone,
  Pencil,
  Play,
  PlugZap,
  Plus,
  RefreshCw,
  Square,
  Terminal as TerminalIcon,
  Trash2,
  Unplug,
} from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from "react-native";
import { writeClipboard } from "../device-permissions";
import { TText } from "../font";
import { type StringKey, t } from "../i18n";
import { useAiName } from "../persona/use-ai-name";
import { radii } from "../theme/radii";
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
import { relayCaddySnippet, relayInstallScript, relaySystemdUnit } from "./relay-install";
import { newServerId, type SandboxServer } from "./servers";
import type {
  SandboxBackend,
  SandboxBackendId,
  SandboxConnectionState,
  SandboxEnvironment,
  SshConfig,
} from "./types";

function StatusDot({ state }: { state: SandboxConnectionState }) {
  const colors = useColors();
  const color =
    state === "connected"
      ? colors.green
      : state === "connecting"
        ? colors.orange
        : state === "error"
          ? colors.danger
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
        <View
          style={{ width: 8, height: 8, borderRadius: radii.xs, backgroundColor: colors.blueDark }}
        />
      ) : null}
    </Pressable>
  );
}

function SshConfigForm({
  server,
  onSaved,
  onCancel,
}: {
  server: SandboxServer | null;
  onSaved: (server: SandboxServer) => void;
  onCancel: () => void;
}) {
  const colors = useColors();
  const [name, setName] = useState(server?.name ?? "");
  const [host, setHost] = useState(server?.config.host ?? "");
  const [port, setPort] = useState(String(server?.config.port ?? 22));
  const [username, setUsername] = useState(server?.config.username ?? "root");
  const [authType, setAuthType] = useState<"key" | "password">(server?.config.authType ?? "key");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setError("");
    const portNum = Number.parseInt(port, 10);
    const secretText = secret.trim();
    if (!name.trim() || !host.trim() || !username.trim() || Number.isNaN(portNum)) {
      setError(t("sandbox.cloud.noConfig"));
      return;
    }
    if (!secretText && (!server || server.config.authType !== authType)) {
      // New server, or switched auth type: the old secret (if any) no longer
      // applies — a fresh one is required. Editing with the same auth type
      // may leave it blank to keep the saved secret.
      setError(t("sandbox.cloud.noConfig"));
      return;
    }
    setBusy(true);
    try {
      const old = server?.config;
      const config: SshConfig = {
        host: host.trim(),
        port: portNum,
        username: username.trim(),
        authType,
        privateKey: authType === "key" ? secretText || old?.privateKey || null : null,
        password: authType === "password" ? secretText || old?.password || null : null,
      };
      const next: SandboxServer = {
        id: server?.id ?? newServerId(),
        name: name.trim(),
        config,
      };
      await sandboxManager.saveServer(next);
      setSecret("");
      onSaved(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      <Field
        label={t("sandbox.serverName")}
        value={name}
        onChangeText={setName}
        placeholder={t("sandbox.serverNamePlaceholder")}
      />
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
      {server ? (
        <TText style={{ fontSize: 11, color: colors.muted }}>{t("sandbox.secretKeepHint")}</TText>
      ) : null}
      {error ? <ErrorNotice error={error} /> : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button primary onPress={save} disabled={busy}>
            {busy ? <LoaderCircle size={16} /> : t("sandbox.saveAndConnect")}
          </Button>
        </View>
        <Button onPress={onCancel} disabled={busy}>
          {t("common.cancel")}
        </Button>
      </View>
    </View>
  );
}

function ServerRow({
  server,
  active,
  state,
  onSelect,
  onEdit,
  onDelete,
}: {
  server: SandboxServer;
  active: boolean;
  state: SandboxConnectionState;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const colors = useColors();
  const s = useStyles();
  return (
    <View
      style={[
        s.card,
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          borderWidth: active ? 2 : 1,
          borderColor: active ? colors.blueDark : colors.line,
        },
      ]}
    >
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ checked: active }}
        onPress={onSelect}
        style={{ flex: 1, gap: 2 }}
      >
        <TText style={{ fontSize: 14, fontWeight: "600", color: colors.text }}>{server.name}</TText>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <StatusDot state={active ? state : "disconnected"} />
          <TText style={{ fontSize: 12, color: colors.muted }}>{server.config.host}</TText>
        </View>
      </Pressable>
      <Pressable onPress={onEdit} accessibilityLabel={t("sandbox.editServer")} hitSlop={8}>
        <Pencil size={16} color={colors.muted} />
      </Pressable>
      <Pressable onPress={onDelete} accessibilityLabel={t("common.delete")} hitSlop={8}>
        <Trash2 size={16} color={colors.muted} />
      </Pressable>
      {active ? (
        <View
          style={{ width: 8, height: 8, borderRadius: radii.xs, backgroundColor: colors.blueDark }}
        />
      ) : null}
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

/**
 * D18: the REAL path from "relay missing" to "relay running". The old copy
 * ("跟{name}说一声，他帮你装上") was a dead end — the AI has no way onto
 * her server either. These are the exact install commands from
 * sandbox-relay/README.md, as copyable text she pastes into her server's
 * terminal herself. The Caddy snippet is pre-filled with this server's host.
 */
function RelayInstallSteps({ host }: { host: string }) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copy = async (key: string, text: string) => {
    try {
      await writeClipboard(text);
    } catch {
      // Clipboard unavailable: she can still read the commands on screen.
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((c) => (c === key ? null : c)), 1500);
  };

  const blocks = [
    { key: "relay", label: t("sandbox.relayInstall.stepRelay"), text: relayInstallScript() },
    {
      key: "caddy",
      label: t("sandbox.relayInstall.stepCaddy"),
      text: relayCaddySnippet(host),
      note: t("sandbox.relayInstall.caddyNote"),
    },
    { key: "systemd", label: t("sandbox.relayInstall.stepSystemd"), text: relaySystemdUnit() },
  ];

  return (
    <View style={{ gap: 8 }}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
        accessibilityRole="button"
      >
        <TText style={{ fontSize: 13, fontWeight: "600", color: colors.blueDark }}>
          {open ? t("sandbox.relayInstall.hideSteps") : t("sandbox.relayInstall.showSteps")}
        </TText>
      </Pressable>
      {open ? (
        <View style={{ gap: 10 }}>
          <TText style={{ fontSize: 12, color: colors.muted }}>
            {t("sandbox.relayInstall.runOnServer")}
          </TText>
          {blocks.map((b) => {
            const copied = copiedKey === b.key;
            return (
              <View key={b.key} style={{ gap: 6 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <TText style={{ fontSize: 12, fontWeight: "600", color: colors.text }}>
                    {b.label}
                  </TText>
                  <Pressable
                    onPress={() => copy(b.key, b.text)}
                    style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                    accessibilityLabel={t("common.copy")}
                    hitSlop={8}
                  >
                    {copied ? (
                      <Check size={14} color={colors.green} />
                    ) : (
                      <Copy size={14} color={colors.muted} />
                    )}
                    <TText style={{ fontSize: 12, color: copied ? colors.green : colors.muted }}>
                      {copied ? t("sandbox.relayInstall.copied") : t("common.copy")}
                    </TText>
                  </Pressable>
                </View>
                <ScrollView
                  horizontal
                  style={{
                    backgroundColor: colors.canvas,
                    borderRadius: radii.sm,
                    borderWidth: 1,
                    borderColor: colors.line,
                    padding: 10,
                  }}
                >
                  <TText style={{ fontSize: 11, color: colors.text, fontFamily: "Menlo" }}>
                    {b.text}
                  </TText>
                </ScrollView>
                {b.note ? (
                  <TText style={{ fontSize: 11, color: colors.muted }}>{b.note}</TText>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

export function SandboxSheet({ onClose }: { onClose: () => void }) {
  const colors = useColors();
  const aiName = useAiName();
  const [ready, setReady] = useState(false);
  const [activeId, setActiveId] = useState<SandboxBackendId>("cloud");
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [relayMissing, setRelayMissing] = useState(false);
  const [servers, setServers] = useState<SandboxServer[]>([]);
  const [activeServerId, setActiveServerIdState] = useState<string | null>(null);
  const [editing, setEditing] = useState<SandboxServer | "new" | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      await sandboxManager.init();
      if (live) {
        setActiveId(sandboxManager.activeBackendId());
        setServers(sandboxManager.serverList());
        setActiveServerIdState(sandboxManager.activeServer()?.id ?? null);
        setReady(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const refresh = () => {
    setServers(sandboxManager.serverList());
    setActiveServerIdState(sandboxManager.activeServer()?.id ?? null);
    setTick((x) => x + 1);
  };
  const backend = sandboxManager.backend(activeId);
  void tick;

  const select = async (id: SandboxBackendId) => {
    setError("");
    setRelayMissing(false);
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

  const failConnect = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    // Translate bare i18n keys (e.g. sandbox.cloud.noConfig); relay errors
    // carry a detail suffix and stay raw — the relayMissing note below is
    // the human-readable part.
    setError(/^sandbox\.[a-zA-Z.]+$/.test(msg) ? t(msg as StringKey) : msg);
    // The relay (传话员) isn't deployed on that server yet: say so in plain
    // language, next to the raw error.
    setRelayMissing(msg.includes("sandbox.relay.unreachable"));
  };

  const connect = async () => {
    setError("");
    setRelayMissing(false);
    setBusy(true);
    try {
      await backend.connect();
    } catch (e) {
      failConnect(e);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  /** Tap a server row: switch to it, then connect. */
  const selectServer = async (id: string) => {
    setError("");
    setRelayMissing(false);
    setBusy(true);
    try {
      await sandboxManager.setActiveServer(id);
      await sandboxManager.backend("cloud").connect();
    } catch (e) {
      failConnect(e);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  /** Delete a server (and its secret) — always ask first. */
  const removeServer = (server: SandboxServer) => {
    Alert.alert(
      t("sandbox.deleteServer"),
      t("sandbox.deleteServerConfirm", { name: server.name }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: () =>
            void (async () => {
              setError("");
              setRelayMissing(false);
              setBusy(true);
              try {
                await sandboxManager.deleteServer(server.id);
                setEditing(null);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
                refresh();
              }
            })(),
        },
      ],
    );
  };

  const onServerSaved = async (server: SandboxServer) => {
    setEditing(null);
    await selectServer(server.id);
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
          {relayMissing ? (
            <Card style={{ gap: 10 }}>
              <TText style={{ fontSize: 13, color: colors.text }}>
                {t("sandbox.relayMissing")}
              </TText>
              <RelayInstallSteps
                host={servers.find((s) => s.id === activeServerId)?.config.host ?? ""}
              />
            </Card>
          ) : null}

          {state === "error" || state === "unavailable" ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button primary icon={RefreshCw} onPress={retry} disabled={busy}>
                {busy ? <LoaderCircle size={16} /> : t("common.retry")}
              </Button>
            </View>
          ) : null}

          {activeId === "cloud" ? (
            <View style={{ gap: 10 }}>
              <SectionHeading title={t("sandbox.servers")} />
              {editing ? (
                <Card style={{ gap: 10 }}>
                  <SshConfigForm
                    server={editing === "new" ? null : editing}
                    onSaved={onServerSaved}
                    onCancel={() => setEditing(null)}
                  />
                </Card>
              ) : (
                <View style={{ gap: 10 }}>
                  {servers.length === 0 ? (
                    <TText style={{ fontSize: 13, color: colors.muted }}>
                      {t("sandbox.noServers")}
                    </TText>
                  ) : (
                    servers.map((s) => (
                      <ServerRow
                        key={s.id}
                        server={s}
                        active={s.id === activeServerId}
                        state={state}
                        onSelect={() => selectServer(s.id)}
                        onEdit={() => setEditing(s)}
                        onDelete={() => removeServer(s)}
                      />
                    ))
                  )}
                  <Button icon={Plus} onPress={() => setEditing("new")} disabled={busy}>
                    {t("sandbox.addServer")}
                  </Button>
                  <TText style={{ fontSize: 11, color: colors.muted }}>
                    {t("sandbox.relayNote", { name: aiName })}
                  </TText>
                </View>
              )}
            </View>
          ) : null}

          {state === "connected" ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button icon={Unplug} onPress={disconnect} disabled={busy}>
                {t("sandbox.disconnect")}
              </Button>
            </View>
          ) : state === "disconnected" && activeId === "cloud" && activeServerId ? (
            <Button primary icon={PlugZap} onPress={connect} disabled={busy}>
              {busy ? <LoaderCircle size={16} /> : t("sandbox.connect")}
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
