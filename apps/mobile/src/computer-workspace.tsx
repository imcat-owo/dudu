import {
  ArrowLeft,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  Play,
  Power,
  RefreshCw,
  Save,
  Terminal,
  Upload,
} from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Platform, View } from "react-native";
import type { Artifact } from "../../../packages/domain/src";
import type {
  ComputerCommand,
  ComputerDirectory,
  ComputerSnapshot,
} from "../../../packages/domain/src/computer";
import { useComputerDraft } from "./computer-drafts";
import { t } from "./i18n";
import {
  Button,
  Card,
  Empty,
  ErrorNotice,
  Field,
  LinkRow,
  timeLabel,
  useColors,
  useStyles,
} from "./ui";
import { useWorkspace } from "./workspace";
import { TText } from "./font";
import { radii } from "./theme/radii";

const mono = Platform.OS === "ios" ? "Menlo" : "monospace";
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function LinuxWorkspace({ tab }: { tab: "Terminal" | "Files" }) {
  const colors = useColors();
  const s = useStyles();
  const { api } = useWorkspace();
  const [snapshot, setSnapshot] = useState<ComputerSnapshot>();
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [command, setCommand] = useComputerDraft("command");
  const [cwd, setCwd] = useComputerDraft("cwd");
  const [executing, setExecuting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [editingCommand, setEditingCommand] = useState(false);
  const version = useRef(0);
  const polling = useRef(false);
  const mutations = useRef(0);
  const refresh = useCallback(async () => {
    if (polling.current || mutations.current) return;
    polling.current = true;
    const request = ++version.current;
    try {
      const next = await api.request<ComputerSnapshot>("/api/computer");
      if (request === version.current) {
        setSnapshot(next);
        setConnectionError("");
      }
    } catch (e) {
      if (request === version.current) setConnectionError(message(e));
    } finally {
      polling.current = false;
    }
  }, [api]);
  useEffect(() => {
    const poll = () => {
      if (AppState.currentState !== "active") return;
      void refresh();
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      version.current++;
      clearInterval(interval);
    };
  }, [refresh]);

  async function control(action: "start" | "stop") {
    if (busy) return;
    setBusy(true);
    setError("");
    mutations.current++;
    const operation = ++version.current;
    try {
      const next = await api.request<ComputerSnapshot>(`/api/computer/${action}`, {});
      if (operation === version.current) setSnapshot(next);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      mutations.current--;
      void refresh();
    }
  }
  async function run() {
    if (!command.trim() || executing || busy) return;
    const sent = command;
    setExecuting(true);
    setError("");
    mutations.current++;
    const operation = ++version.current;
    try {
      const result = await api.request<ComputerCommand>("/api/computer/commands", {
        command: sent,
        cwd,
      });
      if (operation === version.current)
        setSnapshot((current) =>
          current
            ? {
                ...current,
                commands: [result, ...current.commands.filter((item) => item.id !== result.id)],
              }
            : current,
        );
      setCommand((current) => (current === sent ? "" : current));
      setEditingCommand(false);
    } catch (e) {
      setError(message(e));
    } finally {
      setExecuting(false);
      mutations.current--;
      void refresh();
    }
  }
  const running = snapshot?.status === "running";
  const commandRunning = executing || snapshot?.commands.some((item) => item.status === "running");
  return (
    <View style={{ gap: 16 }}>
      <Card style={{ backgroundColor: colors.sky, gap: 12 }}>
        <View style={[s.row, { gap: 12 }]}>
          <Terminal size={24} color={colors.blueDark} />
          <View style={{ flex: 1, gap: 4 }}>
            <TText style={s.heading}>{t("term.title")}</TText>
            <TText style={s.muted}>
              {running
                ? t("term.running")
                : snapshot?.status === "stopped"
                  ? t("term.stopped")
                  : snapshot?.status === "unconfigured"
                    ? t("term.setup")
                    : snapshot?.status === "error"
                      ? t("term.attention")
                      : t("term.connecting")}
            </TText>
          </View>
          {!snapshot && !error && <ActivityIndicator color={colors.blueDark} />}
        </View>
        {!!snapshot?.message && <TText style={s.small}>{snapshot.message}</TText>}
        {snapshot?.enabled && (
          <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
            {running ? (
              <Button icon={Power} busy={busy} onPress={() => void control("stop")}>
                {t("term.stop")}
              </Button>
            ) : (
              <Button primary icon={Play} busy={busy} onPress={() => void control("start")}>
                {t("term.start")}
              </Button>
            )}
            <Button
              icon={RefreshCw}
              disabled={busy}
              onPress={() =>
                void refresh()
                  .then(() => setError(""))
                  .catch((e) => setError(message(e)))
              }
            >
              {t("common.refresh")}
            </Button>
          </View>
        )}
      </Card>
      <ErrorNotice error={error || connectionError} />
      {!snapshot && (error || connectionError) && (
        <Button
          onPress={() =>
            void refresh()
              .then(() => setError(""))
              .catch((e) => setError(message(e)))
          }
        >
          {t("term.retryConnection")}
        </Button>
      )}
      {snapshot?.enabled && (
        <>
          <View style={{ display: tab === "Terminal" ? "flex" : "none", gap: 16 }}>
            {editingCommand || command.length > 0 || snapshot.commands.length === 0 ? (
              <View style={{ borderRadius: radii.lg, backgroundColor: colors.line, padding: 18, gap: 8 }}>
                <TText style={{ color: colors.muted, fontSize: 12, fontFamily: mono }}>
                  {t("term.paneLabel")}
                </TText>
                <Field
                  label={t("term.workdir")}
                  value={cwd}
                  onChangeText={setCwd}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{ fontFamily: mono }}
                />
                <Field
                  label={t("term.command")}
                  value={command}
                  onChangeText={setCommand}
                  placeholder="pwd"
                  multiline
                  maxLength={16000}
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  smartInsertDelete={false}
                  keyboardType="ascii-capable"
                  style={{ fontFamily: mono, minHeight: 80 }}
                />
                {/[‘’“”]/.test(command) && (
                  <Button
                    small
                    onPress={() =>
                      setCommand((text) => text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"'))
                    }
                  >
                    {t("term.useStraightQuotes")}
                  </Button>
                )}
                <Button
                  primary
                  icon={Play}
                  busy={!!commandRunning}
                  disabled={!running || !command.trim() || busy}
                  onPress={() => void run()}
                >
                  {t("term.runCommand")}
                </Button>
                <TText style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>
                  {t("term.runNote")}
                </TText>
              </View>
            ) : (
              <Button
                primary
                icon={Terminal}
                disabled={!running || busy || !!commandRunning}
                onPress={() => setEditingCommand(true)}
              >
                {t("term.newCommand")}
              </Button>
            )}
            {!!commandRunning && <TText style={s.muted}>{t("term.runningNote")}</TText>}
            {snapshot.commands.length === 0 ? (
              <Empty icon={Terminal} title={t("term.readyTitle")} detail={t("term.readyDetail")} />
            ) : (
              [...snapshot.commands]
                .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
                .slice(0, showHistory ? undefined : 5)
                .map((run) => <CommandReceipt key={run.id} run={run} />)
            )}
            {snapshot.commands.length > 5 && (
              <Button small onPress={() => setShowHistory(!showHistory)}>
                {showHistory ? t("term.showRecent") : t("term.earlier")}
              </Button>
            )}
          </View>
          <View style={{ display: tab === "Files" ? "flex" : "none" }}>
            <ComputerFiles running={!!running} active={tab === "Files"} />
          </View>
        </>
      )}
    </View>
  );
}

function CommandReceipt({ run }: { run: ComputerCommand }) {
  const colors = useColors();
  const s = useStyles();
  const [expanded, setExpanded] = useState(true);
  return (
    <Card style={{ gap: 10 }}>
      <View style={[s.between, { gap: 10 }]}>
        <TText
          style={[
            s.small,
            {
              color:
                run.status === "succeeded"
                  ? "#248258"
                  : run.status === "running"
                    ? colors.blueDark
                    : colors.danger,
            },
          ]}
        >
          {run.status.replace("_", " ")}
          {run.exitCode !== undefined ? ` · exit ${run.exitCode}` : ""}
        </TText>
        <TText style={s.small}>{timeLabel(run.startedAt)}</TText>
      </View>
      <TText
        selectable
        style={[s.text, { fontFamily: mono, fontSize: 13 }]}
      >{`$ ${run.command}`}</TText>
      <TText style={[s.small, { fontFamily: mono }]}>{run.cwd}</TText>
      {expanded && (
        <>
          {!!run.stdout && (
            <TText selectable style={[s.text, { fontFamily: mono, fontSize: 12, lineHeight: 19 }]}>
              {run.stdout}
            </TText>
          )}
          {!!run.stderr && (
            <TText
              selectable
              style={[
                s.text,
                { fontFamily: mono, fontSize: 12, lineHeight: 19, color: colors.danger },
              ]}
            >
              {run.stderr}
            </TText>
          )}
          {!run.stdout && !run.stderr && run.status !== "running" && (
            <TText style={s.small}>{t("term.noOutput")}</TText>
          )}
          {run.truncated && <TText style={s.small}>{t("term.truncatedNote")}</TText>}
        </>
      )}
      {!!(run.stdout || run.stderr) && (
        <Button small onPress={() => setExpanded(!expanded)}>
          {expanded ? t("term.hideOutput") : t("term.showOutput")}
        </Button>
      )}
    </Card>
  );
}

function ComputerFiles({ running, active }: { running: boolean; active: boolean }) {
  const colors = useColors();
  const s = useStyles();
  const { api, workspace, open, refresh } = useWorkspace();
  const [path, setPath] = useComputerDraft("path");
  const [directory, setDirectory] = useState<ComputerDirectory>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [retry, setRetry] = useState(0);
  const [editor, setEditor] = useComputerDraft("editor");
  const [folder, setFolder] = useState<string>();
  const [importing, setImporting] = useState(false);
  const dirty = !!editor && (editor.text !== editor.saved || editor.path !== editor.savedPath);
  useEffect(() => {
    if (!active || !running) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError("");
    void api
      .request<ComputerDirectory>(`/api/computer/files?path=${encodeURIComponent(path)}`)
      .then((value) => {
        if (alive) setDirectory(value);
      })
      .catch((e) => {
        if (alive) setError(message(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [api, active, running, path, retry]);

  async function read(file: string) {
    if (busy || loading || !running) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const content = await api.request<{ path: string; text: string }>(
        "/api/computer/files/read",
        { path: file },
      );
      if (mounted.current) setEditor({ ...content, saved: content.text, savedPath: content.path });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function importDocument(file: Artifact) {
    if (busy || !running) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.request("/api/computer/files/import", {
        fileId: file.id,
        path: `${path}/${file.name.replace(/[\\/]/g, "_")}`,
      });
      setImporting(false);
      setNotice(t("term.docCopied"));
      setRetry((value) => value + 1);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function openPdf(path: string) {
    if (busy || !running) return;
    setBusy(true);
    setError("");
    try {
      const file = await api.request<Artifact>("/api/computer/files/export", { path });
      await refresh();
      if (mounted.current) open({ type: "file", file });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!editor || busy) return;
    const sent = editor;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.request("/api/computer/files/write", { path: sent.path, text: sent.text });
      if (mounted.current)
        setEditor((current) =>
          current?.path === sent.path
            ? { ...current, saved: sent.text, savedPath: sent.path }
            : current,
        );
      setNotice(t("term.fileSaved"));
      setRetry((value) => value + 1);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function mkdir() {
    if (!folder?.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.request("/api/computer/files/mkdir", { path: `${path}/${folder.trim()}` });
      setFolder(undefined);
      setRetry((value) => value + 1);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 12 }}>
      <View style={s.between}>
        <TText style={s.heading}>{t("term.workspaceFiles")}</TText>
        {(busy || loading) && <ActivityIndicator color={colors.blueDark} />}
      </View>
      <TText selectable style={[s.small, { fontFamily: mono }]}>
        {editor?.path || path}
      </TText>
      <ErrorNotice error={error} />
      {!!notice && <TText style={[s.small, { color: "#248258" }]}>{notice}</TText>}
      {!running && <TText style={s.muted}>{t("term.startToBrowse")}</TText>}
      {editor ? (
        <>
          <Field
            label={t("term.filePath")}
            value={editor.path}
            onChangeText={(value) => setEditor({ ...editor, path: value })}
            autoCorrect={false}
            autoCapitalize="none"
            style={{ fontFamily: mono }}
          />
          <Field
            label={t("term.fileContents")}
            value={editor.text}
            onChangeText={(value) => setEditor({ ...editor, text: value })}
            multiline
            autoCorrect={false}
            spellCheck={false}
            smartInsertDelete={false}
            keyboardType="ascii-capable"
            autoCapitalize="none"
            style={{ fontFamily: mono, minHeight: 240, fontSize: 13 }}
          />
          <View style={[s.row, { flexWrap: "wrap", gap: 8 }]}>
            <Button
              primary
              icon={Save}
              busy={busy}
              disabled={!running || !editor.path.trim()}
              onPress={() => void save()}
            >
              {t("term.saveFile")}
            </Button>
            <Button
              disabled={busy}
              icon={ArrowLeft}
              onPress={() => {
                setEditor(undefined);
                setNotice("");
              }}
            >
              {dirty ? t("term.discard") : t("term.backToFiles")}
            </Button>
          </View>
        </>
      ) : (
        <>
          <View style={[s.row, { flexWrap: "wrap", gap: 8 }]}>
            {path !== "/workspace" && (
              <Button
                small
                disabled={busy}
                icon={ArrowLeft}
                onPress={() => setPath(path.slice(0, path.lastIndexOf("/")) || "/workspace")}
              >
                {t("term.up")}
              </Button>
            )}
            <Button
              small
              disabled={!running || busy}
              icon={FilePlus2}
              onPress={() => {
                setNotice("");
                setEditor({
                  path: `${path}/note-${Date.now()}.txt`,
                  text: "",
                  saved: "",
                  savedPath: "",
                });
              }}
            >
              {t("term.newFile")}
            </Button>
            <Button
              small
              disabled={!running || busy}
              icon={FolderPlus}
              onPress={() => setFolder("")}
            >
              {t("term.newFolder")}
            </Button>
            <Button
              small
              disabled={!running || busy}
              icon={RefreshCw}
              onPress={() => setRetry(retry + 1)}
            >
              {t("term.refreshFiles")}
            </Button>
            <Button
              small
              disabled={!running || busy}
              icon={Upload}
              onPress={() => setImporting(!importing)}
            >
              {importing ? t("term.hideDocs") : t("term.copyDocHere")}
            </Button>
          </View>
          {importing && (
            <Card>
              <TText style={s.heading}>{t("term.pickPdf")}</TText>
              <TText style={[s.small, { marginTop: 6 }]}>{t("term.copyNote")}</TText>
              {workspace.files.map((file) => (
                <LinkRow
                  key={file.id}
                  icon={FileText}
                  title={file.name}
                  onPress={() => void importDocument(file)}
                />
              ))}
              {!workspace.files.length && <TText style={s.muted}>{t("term.addDocFirst")}</TText>}
            </Card>
          )}
          {folder !== undefined && (
            <Card style={{ gap: 8 }}>
              <Field
                label={t("term.folderName")}
                value={folder}
                onChangeText={setFolder}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <View style={[s.row, { gap: 8 }]}>
                <Button
                  primary
                  disabled={!running || !folder.trim()}
                  busy={busy}
                  onPress={() => void mkdir()}
                >
                  {t("term.createFolder")}
                </Button>
                <Button disabled={busy} onPress={() => setFolder(undefined)}>
                  {t("common.cancel")}
                </Button>
              </View>
            </Card>
          )}
          {running &&
            directory?.path === path &&
            directory.entries.map((entry) => (
              <LinkRow
                key={entry.path}
                icon={entry.type === "directory" ? Folder : FileText}
                title={entry.name}
                detail={
                  entry.type === "directory"
                    ? t("term.folder")
                    : entry.type === "symlink"
                      ? t("term.symlink")
                      : `${Math.max(1, Math.ceil(entry.size / 1024))} KB`
                }
                onPress={() => {
                  if (busy || loading || !running) return;
                  if (entry.type === "directory") {
                    setNotice("");
                    setPath(entry.path);
                  } else if (/\.pdf$/i.test(entry.name)) void openPdf(entry.path);
                  else void read(entry.path);
                }}
              />
            ))}
          {running &&
            !busy &&
            !loading &&
            !error &&
            directory?.path === path &&
            directory.entries.length === 0 && (
              <Empty
                icon={Folder}
                title={t("term.emptyFolderTitle")}
                detail={t("term.addFileHint")}
              />
            )}
        </>
      )}
    </View>
  );
}
