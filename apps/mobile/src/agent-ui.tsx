import {
  ArrowRight,
  Bell,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  FileText,
  Globe2,
  Heart,
  Lightbulb,
  ListChecks,
  Mail,
  Palette,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Square,
  Target,
  Users,
  UtensilsCrossed,
  Wallet,
  X,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Linking, Pressable, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import type { Artifact, BrowserSession } from "../../../packages/domain/src";
import type {
  AgentArtifact,
  AgentMemory,
  AgentTask,
  Evidence,
  Goal,
  Idea,
  Monitor,
  RunEvent,
} from "../../../packages/domain/src/agent";
import { useAgentWorkspace } from "./agent-workspace";
import { type StringKey, t } from "./i18n";
import { ActivityScreen, ConnectionsScreen } from "./screens";
import {
  Button,
  Card,
  CheckRow,
  Chip,
  Empty,
  ErrorNotice,
  Field,
  LinkRow,
  Mascot,
  resultSummary,
  SectionHeading,
  Sheet,
  useColors,
  useStyles,
} from "./ui";
import { useWorkspace } from "./workspace";

const STATUS_KEYS: Record<string, StringKey> = {
  queued: "agent.status.queued",
  running: "agent.status.running",
  scheduled: "agent.status.scheduled",
  waiting_input: "agent.status.waiting_input",
  waiting_approval: "agent.status.waiting_approval",
  paused: "agent.status.paused",
  failed: "agent.status.failed",
  succeeded: "agent.status.succeeded",
  cancelled: "agent.status.cancelled",
  active: "agent.status.active",
  completed: "agent.status.completed",
  stopped: "agent.status.stopped",
  new: "agent.status.new",
  accepted: "agent.status.accepted",
  waiting: "agent.status.waiting",
  plan: "agent.kind.plan",
  document: "agent.kind.document",
  finance: "agent.kind.finance",
  agent: "agent.kind.agent",
  warm: "agent.tone.warm",
  concise: "agent.tone.concise",
  thoughtful: "agent.tone.thoughtful",
  sky: "agent.avatar.sky",
  sand: "agent.avatar.sand",
  lilac: "agent.avatar.lilac",
};
export function statusLabel(value: string) {
  const key = STATUS_KEYS[value];
  return key ? t(key) : value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
function stamp(value?: string) {
  return value
    ? new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : t("agent.notChecked");
}
function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
function activeTask(task: AgentTask) {
  return !["succeeded", "failed", "cancelled"].includes(task.status);
}
export function AgentStatus() {
  const colors = useColors();
  const s = useStyles();
  const { data, error, refresh } = useAgentWorkspace();
  if (data?.worker.running && !error) return null;
  return (
    <View style={{ gap: 8 }}>
      <ErrorNotice error={error ? t("agent.updatesUnavailable", { error }) : ""} />
      {!!error && (
        <Button small onPress={() => void refresh().catch(() => {})}>
          {t("agent.reconnect")}
        </Button>
      )}
      {!data && !error && <ActivityIndicator color={colors.blueDark} />}
      {data && !data.worker.running && <Text style={s.small}>{t("agent.workerOffline")}</Text>}
    </View>
  );
}
export function TaskCard({
  task,
  compact = false,
  onOpen,
}: {
  task: AgentTask;
  compact?: boolean;
  onOpen?: () => void;
}) {
  const colors = useColors();
  const s = useStyles();
  const { open } = useWorkspace();
  const done = task.plan.filter((step) => step.status === "succeeded").length;
  const next = task.plan.find((step) => ["running", "waiting"].includes(step.status));
  const waiting = ["waiting_input", "waiting_approval"].includes(task.status);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("a11y.openTask", { title: task.title })}
      onPress={() => {
        onOpen?.();
        open({ type: "task", taskId: task.id });
      }}
    >
      <Card
        style={{
          padding: compact ? 15 : 20,
          gap: 11,
          borderRadius: 22,
          backgroundColor: "#F0F1F2",
        }}
      >
        <View style={[s.row, { gap: 10 }]}>
          <View
            style={[
              s.iconBox,
              { width: 34, height: 34, backgroundColor: waiting ? colors.orange : colors.sky },
            ]}
          >
            <ListChecks size={18} color={colors.blueDark} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={s.heading}>{task.title}</Text>
            <Text style={s.small}>
              {statusLabel(task.status)}
              {task.plan.length ? t("agent.steps", { done, total: task.plan.length }) : ""}
            </Text>
          </View>
          <ChevronRight size={17} color={colors.muted} />
        </View>
        {!!task.plan.length && (
          <View style={{ height: 4, backgroundColor: colors.line, borderRadius: 4 }}>
            <View
              style={{
                height: 4,
                width: `${Math.round((done / task.plan.length) * 100)}%`,
                backgroundColor: "#6AAEE0",
                borderRadius: 4,
              }}
            />
          </View>
        )}
        {(task.question || task.result || task.error || next?.title) && (
          <Text numberOfLines={compact ? 2 : 4} style={s.muted}>
            {task.question || task.error || resultSummary(task.result || next?.title || "")}
          </Text>
        )}
        {waiting && (
          <Text style={[s.small, { color: colors.blueDark, fontWeight: "600" }]}>
            {task.status === "waiting_approval"
              ? t("agent.reviewRequested")
              : t("agent.inputNeeded")}
          </Text>
        )}
      </Card>
    </Pressable>
  );
}
export function ChatWork() {
  const { data } = useAgentWorkspace();
  const tasks = [...(data?.tasks || [])]
    .filter(activeTask)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 2);
  if (!tasks.length) return null;
  return (
    <View style={{ gap: 10 }}>
      {tasks.map((task) => (
        <TaskCard task={task} key={task.id} compact />
      ))}
    </View>
  );
}
export function AgentActivityScreen() {
  const s = useStyles();
  const { data } = useAgentWorkspace();
  const [filter, setFilter] = useState("all");
  const tasks = [...(data?.tasks || [])]
    .filter(
      (task) =>
        filter === "all" || (filter === "in_progress" ? activeTask(task) : !activeTask(task)),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <View style={{ gap: 20 }}>
      <AgentStatus />
      <View style={[s.row, { gap: 8 }]}>
        {(["all", "in_progress", "finished"] as const).map((item) => (
          <Button key={item} small primary={filter === item} onPress={() => setFilter(item)}>
            {t(`agent.filter.${item}`)}
          </Button>
        ))}
      </View>
      {tasks.map((task) => (
        <TaskCard key={task.id} task={task} />
      ))}
      {!tasks.length && (
        <Empty icon={ListChecks} title="工作的地方" detail={t("agent.emptyDetail")} />
      )}
      <SectionHeading title={t("agent.reviews")} />
      <ActivityScreen />
    </View>
  );
}
export function EvidenceList({ items }: { items: Evidence[] }) {
  const colors = useColors();
  const s = useStyles();
  const { workspace, open } = useWorkspace();
  const [error, setError] = useState("");
  return (
    <View style={{ gap: 10 }}>
      {items.map((item) => (
        <View
          key={item.id}
          style={{ borderLeftWidth: 2, borderLeftColor: colors.blue, paddingLeft: 12, gap: 4 }}
        >
          <Text style={[s.small, { color: colors.text, fontWeight: "600" }]}>{item.title}</Text>
          <Text selectable style={s.small}>
            {item.excerpt}
          </Text>
          {item.url && /^https?:\/\//i.test(item.url) && (
            <Button
              small
              onPress={() =>
                void Linking.openURL(item.url || "").catch((e) => setError(errorText(e)))
              }
            >
              {t("agent.openSource")}
            </Button>
          )}
          {item.kind === "mail" && workspace.mail.some((mail) => mail.id === item.id) && (
            <Button
              small
              onPress={() => {
                const mail = workspace.mail.find((m) => m.id === item.id);
                if (mail) open({ type: "mail", mail });
              }}
            >
              {t("agent.viewEmail")}
            </Button>
          )}
          {item.kind === "file" && workspace.files.some((file) => file.id === item.id) && (
            <Button
              small
              onPress={() => {
                const file = workspace.files.find((f) => f.id === item.id);
                if (file) open({ type: "file", file });
              }}
            >
              {t("agent.viewFile")}
            </Button>
          )}
        </View>
      ))}
      <ErrorNotice error={error} />
    </View>
  );
}
export function TaskDetail({ taskId }: { taskId: string }) {
  const colors = useColors();
  const s = useStyles();
  const { api, workspace, close, open, refresh: refreshWorkspace } = useWorkspace();
  const { data, mutate } = useAgentWorkspace();
  const [detail, setDetail] = useState<{
    task: AgentTask;
    events: RunEvent[];
    artifacts: AgentArtifact[];
    files: Artifact[];
    browsers: BrowserSession[];
  }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState("");
  const [fieldJson, setFieldJson] = useState("");
  const [showFieldJson, setShowFieldJson] = useState(false);
  const [fields, setFields] = useState<Record<string, string | boolean>>({});
  const task = data?.tasks.find((item) => item.id === taskId) || detail?.task;
  useEffect(() => {
    let active = true;
    void api
      .request<{
        task: AgentTask;
        events: RunEvent[];
        artifacts: AgentArtifact[];
        files: Artifact[];
        browsers: BrowserSession[];
      }>(`/api/agent/tasks/${taskId}`)
      .then((result) => {
        if (active) {
          setDetail(result);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [api, taskId, task?.updatedAt]);
  async function act(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      await mutate(`/tasks/${taskId}/${path}`, body);
      if (path === "input") {
        setAnswer("");
        setFields({});
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function submitInput() {
    try {
      let parsed: Record<string, string | boolean> = fields;
      if (fieldJson.trim()) {
        const raw: unknown = JSON.parse(fieldJson);
        if (
          !raw ||
          typeof raw !== "object" ||
          Array.isArray(raw) ||
          Object.values(raw).some(
            (value) => typeof value !== "string" && typeof value !== "boolean",
          )
        )
          throw new Error(t("agent.fieldJsonError"));
        parsed = raw as Record<string, string | boolean>;
      }
      await act("input", {
        answer: answer.trim() || t("agent.providedFields"),
        fields: parsed,
      });
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function review() {
    setBusy(true);
    setError("");
    try {
      await refreshWorkspace();
      const snapshot = await api.request<typeof workspace>("/api/workspace");
      const action = snapshot.actions.find((item) => item.id === task?.actionId);
      if (!action) throw new Error(t("agent.reviewNotReady"));
      open({ type: "review", action });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const missing = Array.isArray(task?.state.missingFields) ? task.state.missingFields : [];
  const fieldNames = missing
    .map((field) =>
      typeof field === "string"
        ? field
        : typeof field === "object" && field && "name" in field
          ? String(field.name)
          : "",
    )
    .filter(Boolean);
  return (
    <Sheet
      title={task?.title || t("agent.task")}
      subtitle={
        task ? `${statusLabel(task.status)} · ${stamp(task.updatedAt)}` : t("agent.loadingProgress")
      }
      onClose={close}
    >
      <ErrorNotice error={error} />
      {!task ? (
        <ActivityIndicator color={colors.blueDark} />
      ) : (
        <View style={{ gap: 20 }}>
          <Text selectable style={s.text}>
            {task.prompt}
          </Text>
          <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
            {["queued", "running", "scheduled", "waiting_input", "waiting_approval"].includes(
              task.status,
            ) && (
              <Button
                small
                icon={Pause}
                busy={busy}
                onPress={() => void act("control", { action: "pause" })}
              >
                {t("agent.pause")}
              </Button>
            )}
            {task.status === "paused" && (
              <Button
                small
                icon={Play}
                busy={busy}
                onPress={() => void act("control", { action: "resume" })}
              >
                {t("agent.resume")}
              </Button>
            )}
            {task.status === "failed" && (
              <Button
                small
                icon={RefreshCw}
                busy={busy}
                onPress={() => void act("control", { action: "retry" })}
              >
                {t("agent.retryTask")}
              </Button>
            )}
            {activeTask(task) && (
              <Button
                small
                danger
                icon={X}
                busy={busy}
                onPress={() => void act("control", { action: "cancel" })}
              >
                {t("agent.cancelTask")}
              </Button>
            )}
          </View>
          {task.status === "waiting_approval" && (
            <Card style={{ backgroundColor: colors.lavender, gap: 12 }}>
              <Text style={s.heading}>等待你的审核</Text>
              <Text style={s.muted}>执行前请核对具体的操作和账号。</Text>
              <Button primary busy={busy} onPress={() => void review()}>
                {t("agent.reviewAction")}
              </Button>
            </Card>
          )}
          {task.status === "waiting_input" && (
            <Card style={{ backgroundColor: colors.sky, gap: 10 }}>
              <Text style={s.heading}>{task.question || t("agent.detailHelp")}</Text>
              {fieldNames.map((name) =>
                missing.some(
                  (f) => typeof f === "object" && f && f.name === name && f.type === "checkbox",
                ) ? (
                  <CheckRow
                    key={name}
                    label={name.replace(/_/g, " ")}
                    checked={Boolean(fields[name])}
                    onPress={() => setFields((current) => ({ ...current, [name]: !current[name] }))}
                  />
                ) : (
                  <Field
                    key={name}
                    label={name.replace(/_/g, " ")}
                    value={String(fields[name] ?? "")}
                    onChangeText={(value) =>
                      setFields((current) => ({ ...current, [name]: value }))
                    }
                  />
                ),
              )}
              {!fieldNames.length && (
                <Field
                  label={t("agent.yourAnswer")}
                  value={answer}
                  onChangeText={setAnswer}
                  multiline
                  placeholder="补充缺失的细节…"
                />
              )}
              {task.kind === "document" && !fieldNames.length && (
                <>
                  <Button small onPress={() => setShowFieldJson(!showFieldJson)}>
                    {t("agent.formFieldValues")}
                  </Button>
                  {showFieldJson && (
                    <Field
                      label={t("agent.fieldsJsonLabel")}
                      value={fieldJson}
                      onChangeText={setFieldJson}
                      multiline
                      autoCapitalize="none"
                      placeholder={t("agent.fieldsJsonExample")}
                    />
                  )}
                </>
              )}
              <Button
                primary
                busy={busy}
                disabled={!answer.trim() && !Object.keys(fields).length && !fieldJson.trim()}
                onPress={() => void submitInput()}
              >
                {t("agent.continueTask")}
              </Button>
            </Card>
          )}
          {!!task.plan.length && (
            <Card style={{ gap: 15 }}>
              <Text style={s.heading}>计划</Text>
              {task.plan.map((step, index) => (
                <View key={step.id} style={[s.row, { gap: 10, alignItems: "flex-start" }]}>
                  <Text
                    style={[
                      s.text,
                      { color: step.status === "succeeded" ? colors.blueDark : colors.muted },
                    ]}
                  >
                    {step.status === "succeeded" ? "✓" : `${index + 1}.`}
                  </Text>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={s.text}>{step.title}</Text>
                    <Text style={s.small}>
                      {statusLabel(step.status)}
                      {step.detail ? ` · ${step.detail}` : ""}
                    </Text>
                  </View>
                </View>
              ))}
            </Card>
          )}
          {!!task.result && (
            <Card style={{ backgroundColor: colors.green }}>
              <Text selectable style={s.text}>
                {resultSummary(task.result)}
              </Text>
            </Card>
          )}
          <ErrorNotice error={task.error ?? undefined} />
          {detail?.browsers?.map((browser) => (
            <Card key={browser.id} style={{ gap: 10 }}>
              <Text style={s.heading}>{browser.title || t("agent.agentBrowser")}</Text>
              <Text style={s.small}>{browser.url}</Text>
              {browser.status === "active" && browser.previewUrl && (
                <Image
                  accessibilityLabel={t("a11y.agentBrowserPreview")}
                  source={{ uri: api.url(browser.previewUrl) }}
                  style={{ width: "100%", aspectRatio: 1.6, borderRadius: 12 }}
                />
              )}
              <Button
                small
                busy={busy}
                onPress={() => {
                  setBusy(true);
                  void (async () => {
                    try {
                      if (["running", "scheduled", "queued"].includes(task.status))
                        await mutate(`/tasks/${taskId}/control`, { action: "pause" });
                      open({ type: "browser", browser });
                    } catch (error) {
                      setError(errorText(error));
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                {["running", "scheduled", "queued"].includes(task.status)
                  ? t("agent.pauseOpenBrowser")
                  : t("agent.openBrowser")}
              </Button>
            </Card>
          ))}
          {detail?.files?.map((file) => (
            <LinkRow
              key={file.id}
              title={file.name}
              detail={t("agent.fileDetail", { count: file.pageCount })}
              icon={FileText}
              onPress={() => open({ type: "file", file })}
            />
          ))}
          {(
            data?.artifacts.filter((artifact) => artifact.taskId === taskId) ||
            detail?.artifacts ||
            []
          ).map((artifact) => (
            <ArtifactCard key={artifact.id} artifact={artifact} />
          ))}
          {!!task.evidence.length && (
            <View style={{ gap: 14 }}>
              <Text style={s.heading}>来源</Text>
              <EvidenceList items={task.evidence} />
            </View>
          )}
          <Text style={s.heading}>时间线</Text>
          {detail?.events.map((event) => (
            <View
              key={event.id}
              style={{ gap: 4, paddingLeft: 14, borderLeftWidth: 2, borderLeftColor: colors.line }}
            >
              <Text style={s.small}>
                {stamp(event.date)} · {statusLabel(event.kind)}
              </Text>
              <Text style={s.text}>{event.title}</Text>
              <Text selectable style={s.muted}>
                {event.detail}
              </Text>
            </View>
          ))}
          {!detail?.events.length && <Text style={s.muted}>Worker 会在这里记录每一步。</Text>}
        </View>
      )}
    </Sheet>
  );
}
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function display(value: unknown): string {
  return typeof value === "string"
    ? value
    : typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : value === null
        ? "—"
        : JSON.stringify(value, null, 2) || "";
}
export function ArtifactCard({ artifact }: { artifact: AgentArtifact }) {
  const colors = useColors();
  const s = useStyles();
  const [expanded, setExpanded] = useState(false);
  if (artifact.kind === "finance") return <FinanceArtifact artifact={artifact} />;
  const rows = Object.entries(artifact.data);
  return (
    <Card style={{ gap: 13, backgroundColor: colors.card }}>
      <View style={s.between}>
        <Text style={s.heading}>{artifact.title}</Text>
        <Chip>{statusLabel(artifact.kind)}</Chip>
      </View>
      <Text selectable style={s.muted}>
        {artifact.summary}
      </Text>
      {(expanded ? rows : rows.slice(0, 4)).map(([key, value]) => (
        <View key={key} style={{ gap: 6 }}>
          <Text style={s.label}>{key.replace(/_/g, " ")}</Text>
          {Array.isArray(value) ? (
            value.slice(0, expanded ? 100 : 5).map((item) => {
              const row = record(item);
              return (
                <View
                  key={`${key}-${display(row?.id ?? item)}`}
                  style={{
                    paddingVertical: 8,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.line,
                  }}
                >
                  <Text selectable style={s.text}>
                    {row
                      ? Object.entries(row)
                          .map(([name, val]) => `${name}: ${display(val)}`)
                          .join(" · ")
                      : display(item)}
                  </Text>
                </View>
              );
            })
          ) : record(value) ? (
            Object.entries(record(value) || {}).map(([name, val]) => (
              <View key={name} style={s.between}>
                <Text style={s.muted}>{name}</Text>
                <Text selectable style={s.text}>
                  {display(val)}
                </Text>
              </View>
            ))
          ) : (
            <Text selectable style={[s.text, { fontSize: typeof value === "number" ? 24 : 14 }]}>
              {display(value)}
            </Text>
          )}
        </View>
      ))}
      <Button small onPress={() => setExpanded(!expanded)}>
        {expanded ? t("agent.collapse") : t("agent.expandAll")}
      </Button>
    </Card>
  );
}
function FinanceArtifact({ artifact }: { artifact: AgentArtifact }) {
  const colors = useColors();
  const s = useStyles();
  const [details, setDetails] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { mutate } = useAgentWorkspace();
  const [goalTitle, setGoalTitle] = useState("");
  const [goalSaved, setGoalSaved] = useState(false);
  const [goalBusy, setGoalBusy] = useState(false);
  const [goalError, setGoalError] = useState("");
  const saveGoal = async () => {
    setGoalBusy(true);
    setGoalError("");
    try {
      await mutate("/goals", {
        title: goalTitle.trim(),
        category: "财务",
        description: `来自 ${artifact.title}：${artifact.summary}`,
        milestones: ["定个储蓄目标", "每周看看花销"],
      });
      setGoalSaved(true);
    } catch (error) {
      setGoalError(errorText(error));
    } finally {
      setGoalBusy(false);
    }
  };
  const amount = (value: unknown) =>
    Number(value ?? 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const categories = Array.isArray(artifact.data.categories) ? artifact.data.categories : [];
  const transactions = Array.isArray(artifact.data.transactions) ? artifact.data.transactions : [];
  const spending = Number(artifact.data.spending) || 1;
  const period = record(artifact.data.period);
  return (
    <Card
      style={{ gap: 12, padding: 10, backgroundColor: "#EEEEF0", maxWidth: 440, width: "100%" }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("a11y.openFinance", { title: artifact.title })}
        accessibilityState={{ expanded: details }}
        onPress={() => setDetails(!details)}
      >
        <View
          style={{
            minHeight: 200,
            borderRadius: 16,
            overflow: "hidden",
            backgroundColor: "#080B10",
            padding: 20,
          }}
        >
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, height: 142 }}>
            <Svg width="100%" height="100%">
              <Defs>
                <LinearGradient id="finance" x1="0" y1="0" x2="0.5" y2="1">
                  <Stop offset="0" stopColor="#281066" />
                  <Stop offset="0.5" stopColor="#163BBF" />
                  <Stop offset="1" stopColor="#148CE8" />
                </LinearGradient>
              </Defs>
              <Rect width="100%" height="100%" fill="url(#finance)" />
            </Svg>
          </View>
          <Text style={{ color: "#D4DCFC", fontSize: 11, lineHeight: 18, marginBottom: 20 }}>
            {t("fin.readFrom")}
            {"\n"}
            {String(period?.from ?? "")} — {String(period?.to ?? "")}
            {"\n"}
            {t("fin.txCount", { count: transactions.length })}
          </Text>
          <View style={[s.row, { gap: 7 }]}>
            {(
              [
                [t("fin.income"), "income"],
                [t("fin.spending"), "spending"],
                [t("fin.remaining"), "saved"],
              ] as const
            ).map(([label, key]) => (
              <View
                key={key}
                style={{ flex: 1, padding: 11, borderRadius: 12, backgroundColor: "#1D2025" }}
              >
                <Text style={{ color: "#A4A7AD", fontSize: 9 }}>{label}</Text>
                <Text
                  selectable
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.65}
                  style={{
                    fontSize: 17,
                    fontWeight: "600",
                    color: key === "saved" ? "#58D3AE" : "#FFF",
                    marginTop: 5,
                  }}
                >
                  {amount(artifact.data[key])}
                </Text>
                <Text style={{ color: "#7E8289", fontSize: 8, marginTop: 4 }}>原币种</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={[s.row, { gap: 11, paddingHorizontal: 8, paddingTop: 13, paddingBottom: 4 }]}>
          <Wallet size={26} color={colors.blueDark} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[s.text, { fontWeight: "600" }]}>财务追踪</Text>
            <Text style={s.small}>支出、储蓄，以及下一步的计划。</Text>
          </View>
          <ChevronRight size={17} color={colors.muted} />
        </View>
      </Pressable>
      {details && (
        <View style={{ gap: 16, padding: 10 }}>
          <Text style={s.label}>你的钱花在哪了</Text>
          {categories.map((category) => {
            const row = record(category);
            if (!row) return null;
            return (
              <View key={String(row.name)} style={{ gap: 8 }}>
                <View style={s.between}>
                  <Text style={s.text}>{String(row.name)}</Text>
                  <Text style={s.text}>{amount(row.amount)}</Text>
                </View>
                <View style={{ height: 7, backgroundColor: "#DFE8EB", borderRadius: 8 }}>
                  <View
                    style={{
                      width: `${Math.min(100, (Number(row.amount) / spending) * 100)}%`,
                      height: 7,
                      backgroundColor: colors.blueDark,
                      borderRadius: 8,
                    }}
                  />
                </View>
              </View>
            );
          })}
          <Text style={s.small}>金额使用原币种。本汇总覆盖导入的日期范围。</Text>
          {goalSaved ? (
            <Text style={s.text}>你的储蓄目标已保存在目标里。</Text>
          ) : (
            <View style={{ gap: 10 }}>
              <Field
                label={t("fin.goalLabel")}
                value={goalTitle}
                onChangeText={setGoalTitle}
                placeholder="你想为什么存钱？"
              />
              <ErrorNotice error={goalError} />
              <Button
                small
                busy={goalBusy}
                disabled={!goalTitle.trim()}
                onPress={() => void saveGoal()}
              >
                {t("fin.createGoal")}
              </Button>
            </View>
          )}
          <Button small onPress={() => setExpanded(!expanded)}>
            {expanded ? t("fin.hideTx") : t("fin.viewTx")}
          </Button>
          {expanded &&
            transactions.slice(0, 100).map((transaction) => {
              const row = record(transaction);
              return row ? (
                <View key={String(row.id ?? display(row))} style={s.between}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.text}>{String(row.description)}</Text>
                    <Text style={s.small}>
                      {String(row.date)} · {String(row.category)}
                    </Text>
                  </View>
                  <Text style={s.text}>{amount(row.amount)}</Text>
                </View>
              ) : null;
            })}
          {expanded && transactions.length > 100 && <Text style={s.small}>{t("fin.top100")}</Text>}
        </View>
      )}
    </Card>
  );
}
export function DelegateSheet() {
  const s = useStyles();
  const { workspace, close, open } = useWorkspace();
  const { delegate } = useAgentWorkspace();
  const [kind, setKind] = useState<AgentTask["kind"]>("plan");
  const [prompt, setPrompt] = useState("");
  const [messageId, setMessageId] = useState("");
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true);
    setError("");
    try {
      const task = await delegate({
        prompt: prompt.trim(),
        kind,
        input: kind === "finance" ? { csv } : kind === "document" ? { messageId } : {},
      });
      open({ type: "task", taskId: task.id });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title="交付成果" subtitle={t("agent.delegateSubtitle")} onClose={close}>
      <View style={[s.row, { flexWrap: "wrap", gap: 8, marginBottom: 20 }]}>
        {(["plan", "document", "finance", "agent"] as const).map((item) => (
          <Button small primary={kind === item} key={item} onPress={() => setKind(item)}>
            {statusLabel(item)}
          </Button>
        ))}
      </View>
      <Field
        label={t("agent.whatToDo")}
        value={prompt}
        onChangeText={setPrompt}
        multiline
        placeholder={
          kind === "document"
            ? t("agent.promptDoc")
            : kind === "finance"
              ? t("agent.promptFinance")
              : t("agent.promptPlan")
        }
      />
      {kind === "document" && (
        <View style={{ gap: 8, marginBottom: 18 }}>
          <Text style={s.heading}>选择带 PDF 的邮件</Text>
          {workspace.mail
            .filter((mail) => mail.attachments.length)
            .map((mail) => (
              <CheckRow
                key={mail.id}
                checked={mail.id === messageId}
                label={`${mail.subject} · ${mail.sender}`}
                onPress={() => setMessageId(mail.id)}
              />
            ))}
          {!workspace.mail.some((mail) => mail.attachments.length) && (
            <Text style={s.muted}>{t("agent.attachMailNote")}</Text>
          )}
        </View>
      )}
      {kind === "finance" && (
        <>
          <Field
            label={t("agent.csvLabel")}
            value={csv}
            onChangeText={setCsv}
            multiline
            autoCapitalize="none"
            placeholder={"date,description,amount,category\n2026-09-01,Groceries,54.20,Food"}
          />
          {workspace.mode === "sample" && (
            <Button
              onPress={() =>
                setCsv(
                  "date,description,amount,category\n2026-09-01,Salary,-4200,Income\n2026-09-02,Groceries,84.50,Food\n2026-09-03,Subscription,19.99,Subscriptions\n2026-09-04,Coffee,6.50,Food",
                )
              }
            >
              {t("agent.tryExample")}
            </Button>
          )}
          <Text style={[s.small, { marginVertical: 12 }]}>{t("agent.csvNote")}</Text>
        </>
      )}
      {kind === "agent" && !workspace.runtime.configured && (
        <Text style={[s.muted, { marginBottom: 16 }]}>{t("agent.modelNote")}</Text>
      )}
      <ErrorNotice error={error} />
      <Button
        primary
        busy={busy}
        disabled={
          !prompt.trim() ||
          (kind === "document" && !messageId) ||
          (kind === "finance" && !csv.trim())
        }
        onPress={() => void submit()}
      >
        {t("agent.delegateTask")}
      </Button>
    </Sheet>
  );
}
export function IdeasScreen() {
  const colors = useColors();
  const s = useStyles();
  const { data, mutate } = useAgentWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function refreshIdeas() {
    setBusy(true);
    setError("");
    try {
      await mutate("/ideas/refresh", {});
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const ideas = data?.ideas.filter((idea) => idea.status === "new") || [];
  return (
    <View style={{ gap: 20 }}>
      <AgentStatus />
      <View style={s.between}>
        <Text style={s.small}>来自你连接的应用</Text>
        <Button small icon={RefreshCw} busy={busy} onPress={() => void refreshIdeas()}>
          {t("agent.findIdeas")}
        </Button>
      </View>
      <ErrorNotice error={error} />
      {ideas.map((idea) => (
        <IdeaCard key={idea.id} idea={idea} />
      ))}
      {!ideas.length && (
        <Empty icon={Lightbulb} title={t("agent.roomForIdea")} detail={t("agent.ideaNote")} />
      )}
      {(data?.ideas || [])
        .filter((idea) => idea.status === "accepted")
        .map((idea) => (
          <Card key={idea.id} style={{ gap: 7 }}>
            <Text style={s.heading}>{idea.title}</Text>
            <Chip tint={colors.green}>已开始</Chip>
            {!!idea.taskId && <TaskLink taskId={idea.taskId} />}
          </Card>
        ))}
    </View>
  );
}
function TaskLink({ taskId, onOpen }: { taskId: string; onOpen?: () => void }) {
  const { open } = useWorkspace();
  return (
    <Button
      small
      icon={ArrowRight}
      onPress={() => {
        onOpen?.();
        open({ type: "task", taskId });
      }}
    >
      {t("agent.viewTask")}
    </Button>
  );
}
function IdeaCard({ idea }: { idea: Idea }) {
  const colors = useColors();
  const s = useStyles();
  const { mutate } = useAgentWorkspace();
  const { open } = useWorkspace();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(idea.prompt);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function act(action: "accept" | "dismiss") {
    setBusy(true);
    setError("");
    try {
      const result = await mutate<Idea>(`/ideas/${idea.id}`, { action, prompt });
      if (result.taskId && action === "accept") open({ type: "task", taskId: result.taskId });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: colors.line }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("a11y.viewIdea", { title: idea.title })}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        style={{ flexDirection: "row", gap: 14 }}
      >
        <View style={{ width: 34, paddingTop: 3 }}>
          {(() => {
            const Icon = /document|permission|form/i.test(idea.title)
              ? ClipboardList
              : /money|spend|saving/i.test(idea.title)
                ? Wallet
                : /goal|plan|training/i.test(idea.title)
                  ? Target
                  : /dinner|table/i.test(idea.title)
                    ? UtensilsCrossed
                    : Lightbulb;
            return <Icon size={24} color={colors.blueDark} />;
          })()}
        </View>
        <View style={{ flex: 1, gap: 5 }}>
          <Text style={[s.heading, { fontSize: 16, lineHeight: 23 }]}>{idea.title}</Text>
          <Text style={s.muted}>{idea.reason}</Text>
        </View>
      </Pressable>
      {expanded && (
        <View style={{ gap: 15, marginTop: 18, paddingLeft: 48 }}>
          <EvidenceList items={idea.evidence} />
          {editing && (
            <Field
              label={t("agent.whatShouldDo")}
              value={prompt}
              onChangeText={setPrompt}
              multiline
            />
          )}
          <ErrorNotice error={error} />
          <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
            <Button
              primary
              busy={busy}
              disabled={!prompt.trim()}
              onPress={() => void act("accept")}
            >
              {t("agent.startThis")}
            </Button>
            <Button disabled={busy} onPress={() => setEditing(!editing)}>
              {editing ? t("agent.keepEdits") : t("agent.edit")}
            </Button>
            <Button disabled={busy} onPress={() => void act("dismiss")}>
              {t("agent.dismiss")}
            </Button>
          </View>
        </View>
      )}
    </View>
  );
}
export function GoalsScreen() {
  const colors = useColors();
  const s = useStyles();
  const { data } = useAgentWorkspace();
  const [adding, setAdding] = useState<string>();
  const [selectedGoal, setSelectedGoal] = useState<string>();
  const [selectedMonitor, setSelectedMonitor] = useState<string>();
  const [showAll, setShowAll] = useState(false);
  const goal = data?.goals.find((item) => item.id === selectedGoal);
  const monitor = data?.monitors.find((item) => item.id === selectedMonitor);
  const monitors = data?.monitors || [];
  return (
    <View style={{ gap: 22 }}>
      <AgentStatus />
      <View style={{ gap: 8 }}>
        <View style={[s.between, { marginBottom: 5 }]}>
          <View style={[s.row, { gap: 10 }]}>
            <View
              style={{
                width: 16,
                height: 16,
                borderRadius: 8,
                borderWidth: 5,
                borderColor: "#D9F1E2",
                backgroundColor: "#24A46B",
              }}
            />
            <Text style={[s.heading, { color: "#189A58" }]}>追踪</Text>
          </View>
          <Button small icon={Plus} onPress={() => setAdding("Tracking")}>
            {t("agent.track")}
          </Button>
        </View>
        {(showAll ? monitors : monitors.slice(0, 3)).map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={t("a11y.openTracking", { title: item.title })}
            onPress={() => setSelectedMonitor(item.id)}
            style={[s.row, { gap: 12, paddingVertical: 13 }]}
          >
            <Square size={21} color="#A7AAAC" />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.text}>{item.title}</Text>
              <Text numberOfLines={1} style={s.muted}>
                {item.status === "active"
                  ? t("agent.checkEvery", { count: item.intervalMinutes })
                  : statusLabel(item.status)}
              </Text>
            </View>
            <ChevronRight size={18} color="#A3A6A8" />
          </Pressable>
        ))}
        {!monitors.length && (
          <Text style={[s.muted, { paddingVertical: 10 }]}>票价、预订、你在关注的页面。</Text>
        )}
        {monitors.length > 3 && (
          <Button small onPress={() => setShowAll(!showAll)}>
            {showAll ? t("agent.showLess") : t("agent.showMore", { count: monitors.length - 3 })}
          </Button>
        )}
      </View>
      <View style={{ height: 1, backgroundColor: colors.line }} />
      <View style={{ gap: 8 }}>
        <View style={[s.row, { gap: 10, marginBottom: 5 }]}>
          <View
            style={{
              width: 16,
              height: 16,
              borderRadius: 8,
              borderWidth: 5,
              borderColor: "#D7E9FA",
              backgroundColor: "#3D9BDE",
            }}
          />
          <Text style={[s.heading, { color: colors.blueDark }]}>目标</Text>
        </View>
        {data?.goals.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={t("a11y.openGoal", { title: item.title })}
            onPress={() => setSelectedGoal(item.id)}
            style={[s.row, { gap: 12, paddingVertical: 13 }]}
          >
            <Square
              size={21}
              color="#A7AAAC"
              fill={item.status === "completed" ? colors.green : "transparent"}
            />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.text}>{item.title}</Text>
              <Text numberOfLines={2} style={s.muted}>
                {item.description || statusLabel(item.status)}
              </Text>
            </View>
            <ChevronRight size={18} color="#A3A6A8" />
          </Pressable>
        ))}
        {!data?.goals.length && (
          <Text style={[s.muted, { paddingVertical: 10 }]}>大计划从一小步开始。</Text>
        )}
      </View>
      <View style={{ height: 1, backgroundColor: colors.line }} />
      <Text style={s.heading}>创建目标</Text>
      {[
        { name: "Health", label: t("agent.cat.health"), icon: Heart },
        { name: "Relationships", label: t("agent.cat.relationships"), icon: Users },
        { name: "Finances", label: t("agent.cat.finances"), icon: CircleDollarSign },
        { name: "Something else", label: t("agent.cat.other"), icon: Target },
      ].map((item) => (
        <Pressable
          key={item.name}
          accessibilityRole="button"
          accessibilityLabel={t("a11y.createGoal", { category: item.label })}
          onPress={() => setAdding(item.name)}
          style={[s.row, { gap: 12, minHeight: 38 }]}
        >
          <item.icon size={23} color="#989C9F" />
          <Text style={[s.text, { flex: 1, color: "#666A6D" }]}>{item.label}</Text>
          <Plus size={18} color="#989C9F" />
        </Pressable>
      ))}
      {adding && (
        <Sheet
          title={adding === "Tracking" ? t("agent.trackSomething") : t("agent.createGoal")}
          onClose={() => setAdding(undefined)}
        >
          {adding === "Tracking" ? (
            <MonitorForm onDone={() => setAdding(undefined)} />
          ) : (
            <GoalForm category={adding} onDone={() => setAdding(undefined)} />
          )}
        </Sheet>
      )}
      {goal && (
        <Sheet title={goal.title} onClose={() => setSelectedGoal(undefined)}>
          <GoalCard goal={goal} onOpenTask={() => setSelectedGoal(undefined)} />
        </Sheet>
      )}
      {monitor && (
        <Sheet title={monitor.title} onClose={() => setSelectedMonitor(undefined)}>
          <MonitorCard monitor={monitor} onOpenTask={() => setSelectedMonitor(undefined)} />
        </Sheet>
      )}
    </View>
  );
}
function GoalForm({ onDone, category }: { onDone: () => void; category?: string }) {
  const { mutate } = useAgentWorkspace();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [milestones, setMilestones] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      await mutate("/goals", {
        title: title.trim(),
        category,
        description,
        milestones: milestones
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      });
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <Field
        label={t("agent.goalTitle")}
        value={title}
        onChangeText={setTitle}
        placeholder="建立三个月的应急基金"
      />
      <Field
        label={t("agent.successLook")}
        value={description}
        onChangeText={setDescription}
        multiline
      />
      <Field
        label={t("agent.milestones")}
        value={milestones}
        onChangeText={setMilestones}
        multiline
      />
      <ErrorNotice error={error} />
      <Button primary disabled={!title.trim()} busy={busy} onPress={() => void save()}>
        {t("agent.createGoal")}
      </Button>
    </Card>
  );
}
function GoalCard({ goal, onOpenTask }: { goal: Goal; onOpenTask?: () => void }) {
  const colors = useColors();
  const s = useStyles();
  const { data, mutate, delegate } = useAgentWorkspace();
  const { open } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const done = goal.milestones.filter((item) => item.done).length;
  async function update(body: unknown) {
    setBusy(true);
    setError("");
    try {
      await mutate(`/goals/${goal.id}`, body);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function plan() {
    setBusy(true);
    setError("");
    try {
      const task = await delegate({
        title: t("agent.planTitle", { title: goal.title }),
        prompt: `Create a practical plan for this goal: ${goal.title}. ${goal.description}`,
        kind: "plan",
        goalId: goal.id,
        input: {},
      });
      onOpenTask?.();
      open({ type: "task", taskId: task.id });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={{ gap: 12 }}>
      <View style={s.between}>
        <Text style={[s.heading, { flex: 1 }]}>{goal.title}</Text>
        <Chip tint={goal.status === "completed" ? colors.green : colors.sky}>
          {statusLabel(goal.status)}
        </Chip>
      </View>
      <Text style={s.muted}>{goal.description}</Text>
      <Text style={s.small}>
        {t("agent.milestoneProgress", { done, total: goal.milestones.length })}
      </Text>
      {goal.milestones.map((milestone) => (
        <CheckRow
          key={milestone.id}
          checked={milestone.done}
          label={milestone.title}
          onPress={() => {
            if (!busy)
              void update({
                milestones: goal.milestones.map((item) =>
                  item.id === milestone.id ? { ...item, done: !item.done } : item,
                ),
              });
          }}
        />
      ))}
      <ErrorNotice error={error} />
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button
          small
          busy={busy}
          onPress={() => void update({ status: goal.status === "active" ? "paused" : "active" })}
        >
          {goal.status === "active" ? t("agent.pause") : t("agent.resume")}
        </Button>
        {goal.status !== "completed" && (
          <Button small busy={busy} onPress={() => void update({ status: "completed" })}>
            {t("agent.completeGoal")}
          </Button>
        )}
        <Button small primary busy={busy} onPress={() => void plan()}>
          {t("agent.planNext")}
        </Button>
      </View>
      {data?.tasks
        .filter((task) => task.goalId === goal.id)
        .map((task) => (
          <TaskCard key={task.id} task={task} compact onOpen={onOpenTask} />
        ))}
    </Card>
  );
}
function MonitorForm({ onDone }: { onDone: () => void }) {
  const s = useStyles();
  const { workspace } = useWorkspace();
  const { mutate } = useAgentWorkspace();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [condition, setCondition] = useState<Monitor["condition"]>("change");
  const [value, setValue] = useState("");
  const [interval, setInterval] = useState("15");
  const [sample, setSample] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError("");
    try {
      const minutes = Number(interval);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080)
        throw new Error(t("agent.intervalError"));
      if (!sample && !/^https?:\/\//i.test(url.trim())) throw new Error(t("agent.urlError"));
      await mutate("/monitors", {
        title: title.trim(),
        url: sample ? "sample://availability" : url.trim(),
        condition,
        value,
        intervalMinutes: minutes,
      });
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <Field
        label={t("agent.watchingWhat")}
        value={title}
        onChangeText={setTitle}
        placeholder="在我最喜欢的餐厅订个桌子"
      />
      {workspace.mode === "sample" && (
        <CheckRow
          checked={sample}
          label={t("agent.trySamplePage")}
          onPress={() => setSample(!sample)}
        />
      )}
      {!sample && (
        <Field
          label={t("agent.pageUrl")}
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          placeholder="https://example.com/product"
        />
      )}
      <Text style={[s.small, { marginBottom: 10 }]}>当…时通知我</Text>
      <View style={[s.row, { gap: 7, flexWrap: "wrap", marginBottom: 16 }]}>
        {(["change", "contains", "price_below"] as const).map((item) => (
          <Button small primary={condition === item} key={item} onPress={() => setCondition(item)}>
            {item === "change"
              ? t("agent.condChange")
              : item === "contains"
                ? t("agent.condContains")
                : t("agent.condPrice")}
          </Button>
        ))}
      </View>
      {condition !== "change" && (
        <Field
          label={condition === "contains" ? t("agent.lookForText") : t("agent.targetPrice")}
          value={value}
          onChangeText={setValue}
        />
      )}
      <Field
        label={t("agent.checkMinutes")}
        value={interval}
        onChangeText={setInterval}
        keyboardType="number-pad"
      />
      <Text style={[s.small, { marginBottom: 14 }]}>
        {sample ? t("agent.sampleNote") : t("agent.monitorNote")}
      </Text>
      <ErrorNotice error={error} />
      <Button
        primary
        busy={busy}
        disabled={
          !title.trim() || (!sample && !url.trim()) || (condition !== "change" && !value.trim())
        }
        onPress={() => void save()}
      >
        {t("agent.startTracking")}
      </Button>
    </Card>
  );
}
function MonitorCard({ monitor, onOpenTask }: { monitor: Monitor; onOpenTask?: () => void }) {
  const colors = useColors();
  const s = useStyles();
  const { mutate } = useAgentWorkspace();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function act(action: string) {
    setBusy(true);
    setError("");
    try {
      await mutate(`/monitors/${monitor.id}/control`, { action });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function changeSample() {
    setBusy(true);
    setError("");
    try {
      await mutate("/sample-page", {
        text: `Availability: a table is available. Updated ${new Date().toISOString()}`,
      });
      await mutate(`/monitors/${monitor.id}/control`, { action: "check" });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={{ gap: 13 }}>
      <View style={s.between}>
        <Text style={[s.heading, { flex: 1 }]}>{monitor.title}</Text>
        <Chip tint={colors.sky}>{statusLabel(monitor.status)}</Chip>
      </View>
      <Text selectable style={s.small}>
        {monitor.url.startsWith("sample:") ? t("agent.samplePage") : monitor.url}
      </Text>
      <Text style={s.text}>
        {monitor.condition === "change"
          ? t("agent.watchChange")
          : monitor.condition === "contains"
            ? t("agent.watchContains", { value: monitor.value })
            : t("agent.watchPrice", { value: monitor.value })}
      </Text>
      <Text style={s.small}>
        {t("agent.checkStats", { minutes: monitor.intervalMinutes, checks: monitor.checks })}
      </Text>
      <Text style={s.small}>
        {t("agent.lastCheck", { time: stamp(monitor.lastCheckedAt) })}
        {monitor.status === "active"
          ? `\n${t("agent.nextCheck", { time: stamp(monitor.nextCheckAt) })}`
          : ""}
      </Text>
      {!!monitor.lastValue && (
        <Text selectable numberOfLines={5} style={s.muted}>
          {monitor.lastValue}
        </Text>
      )}
      <ErrorNotice error={error || monitor.error} />
      {monitor.status !== "stopped" && (
        <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
          <Button
            small
            busy={busy}
            onPress={() => void act(monitor.status === "active" ? "pause" : "resume")}
          >
            {monitor.status === "active" ? t("agent.pause") : t("agent.resume")}
          </Button>
          <Button small busy={busy} onPress={() => void act("check")}>
            {t("agent.checkNow")}
          </Button>
          <Button small danger busy={busy} onPress={() => void act("stop")}>
            {t("agent.stopTracking")}
          </Button>
        </View>
      )}
      {monitor.url.startsWith("sample:") && monitor.status !== "stopped" && (
        <Button small busy={busy} onPress={() => void changeSample()}>
          {t("agent.changeAvailability")}
        </Button>
      )}
      <TaskLink taskId={monitor.taskId} onOpen={onOpenTask} />
    </Card>
  );
}
export function NotificationsSheet() {
  const colors = useColors();
  const s = useStyles();
  const { data, mutate } = useAgentWorkspace();
  const { close, open } = useWorkspace();
  const [error, setError] = useState("");
  async function read(id: string, taskId?: string) {
    try {
      await mutate(`/notifications/${id}/read`, {});
      if (taskId) open({ type: "task", taskId });
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <Sheet title="通知" subtitle={t("agent.notifSubtitle")} onClose={close}>
      <View style={{ gap: 14 }}>
        <ErrorNotice error={error} />
        {data?.notifications.map((item) => (
          <Card
            key={item.id}
            style={{ gap: 8, backgroundColor: item.read ? colors.card : colors.sky }}
          >
            <View style={s.between}>
              <Text style={s.heading}>{item.title}</Text>
              {!item.read && <Chip>新建</Chip>}
            </View>
            <Text style={s.muted}>{item.body}</Text>
            <Text style={s.small}>{stamp(item.createdAt)}</Text>
            <Button small onPress={() => void read(item.id, item.taskId)}>
              {item.taskId
                ? t("agent.viewTask")
                : item.read
                  ? t("agent.read")
                  : t("agent.markRead")}
            </Button>
          </Card>
        ))}
        {!data?.notifications.length && (
          <Empty icon={Bell} title={t("activity.caughtUp")} detail={t("agent.notifEmpty")} />
        )}
      </View>
    </Sheet>
  );
}
export function AppsScreen() {
  const colors = useColors();
  const s = useStyles();
  const { navigate, open } = useWorkspace();
  const { data, mutate } = useAgentWorkspace();
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState(false);
  const [name, setName] = useState(data?.identity.name || "OpenMuse");
  const [tone, setTone] = useState(data?.identity.tone || "warm");
  const [avatar, setAvatar] = useState(data?.identity.avatar || "sky");
  const [showChatUpdates, setShowChatUpdates] = useState(data?.identity.showChatUpdates !== false);
  const [memory, setMemory] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data?.identity) {
      setName(data.identity.name);
      setTone(data.identity.tone);
      setAvatar(data.identity.avatar || "sky");
      setShowChatUpdates(data.identity.showChatUpdates !== false);
    }
  }, [
    data?.identity.name,
    data?.identity.tone,
    data?.identity.avatar,
    data?.identity.showChatUpdates,
  ]);
  async function save(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      await mutate(path, body);
      if (path === "/memories") setMemory("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const shortcuts = [
    {
      section: "mail" as const,
      title: t("agent.shortcut.mail"),
      detail: t("agent.shortcut.mailDetail"),
      icon: Mail,
    },
    {
      section: "calendar" as const,
      title: t("agent.shortcut.calendar"),
      detail: t("agent.shortcut.calDetail"),
      icon: CalendarDays,
    },
    {
      section: "browser" as const,
      title: t("conn.agentComputer"),
      detail: t("agent.shortcut.browserDetail"),
      icon: Globe2,
    },
    {
      section: "files" as const,
      title: t("agent.shortcut.files"),
      detail: t("agent.shortcut.filesDetail"),
      icon: FileText,
    },
  ];
  return (
    <View style={{ gap: 22 }}>
      <AgentStatus />
      <Field
        label={t("agent.searchApps")}
        value={query}
        onChangeText={setQuery}
        placeholder="搜索连接器"
      />
      <ConnectionsScreen query={query} />
      <Text style={s.heading}>在你的电脑上</Text>
      <Card style={{ paddingVertical: 3, backgroundColor: "#F4F5F6" }}>
        {shortcuts
          .filter((item) =>
            `${item.title} ${item.detail}`.toLowerCase().includes(query.toLowerCase()),
          )
          .map((item) => (
            <LinkRow
              key={item.section}
              icon={item.icon}
              title={item.title}
              detail={item.detail}
              onPress={() =>
                item.section === "browser" ? open({ type: "computer" }) : navigate(item.section)
              }
            />
          ))}
      </Card>
      {`${t("appearance.entryTitle")} ${t("appearance.entryDetail")}`
        .toLowerCase()
        .includes(query.toLowerCase()) && (
        <Card style={{ paddingVertical: 3 }}>
          <LinkRow
            icon={Palette}
            title={t("appearance.entryTitle")}
            detail={t("appearance.entryDetail")}
            onPress={() => navigate("appearance")}
          />
        </Card>
      )}
      <Button onPress={() => setSettings(!settings)}>
        {settings ? t("agent.closeSettings") : t("agent.personalityMemory")}
      </Button>
      {settings && (
        <>
          <Card style={{ gap: 10 }}>
            <SectionHeading title={t("agent.yourAgent")} />
            <View style={[s.row, { gap: 16, justifyContent: "center", marginBottom: 12 }]}>
              {(["sky", "sand", "lilac"] as const).map((item) => (
                <Pressable
                  key={item}
                  accessibilityRole="radio"
                  accessibilityLabel={t("a11y.statusAvatar", { status: statusLabel(item) })}
                  accessibilityState={{ checked: avatar === item }}
                  onPress={() => setAvatar(item)}
                  style={{
                    padding: 7,
                    borderRadius: 24,
                    backgroundColor: avatar === item ? colors.sky : colors.canvas,
                  }}
                >
                  <Mascot size={62} index={{ sky: 0, sand: 1, lilac: 2 }[item] ?? 0} />
                </Pressable>
              ))}
            </View>
            <Field label={t("agent.name")} value={name} onChangeText={setName} />
            <View style={[s.row, { gap: 8 }]}>
              {(["warm", "concise", "thoughtful"] as const).map((item) => (
                <Button key={item} small primary={tone === item} onPress={() => setTone(item)}>
                  {statusLabel(item)}
                </Button>
              ))}
            </View>
            <CheckRow
              label={t("agent.showUpdates")}
              checked={showChatUpdates}
              onPress={() => setShowChatUpdates(!showChatUpdates)}
            />
            <Text style={s.small}>{t("agent.fullRecordNote")}</Text>
            <Button
              busy={busy}
              disabled={!name.trim()}
              onPress={() =>
                void save("/identity", { name: name.trim(), tone, avatar, showChatUpdates })
              }
            >
              {t("agent.savePrefs")}
            </Button>
          </Card>
          <Card style={{ gap: 12 }}>
            <SectionHeading title="记忆" />
            <Text style={s.muted}>你可以查看、修正或忘记的上下文。</Text>
            {data?.memories.map((item) => (
              <MemoryRow key={item.id} memory={item} />
            ))}
            <Field
              label={t("agent.rememberLabel")}
              value={memory}
              onChangeText={setMemory}
              placeholder="我更喜欢早上的会议"
            />
            <Button
              busy={busy}
              disabled={!memory.trim()}
              onPress={() =>
                void save("/memories", { text: memory.trim(), source: t("memory.addedInApps") })
              }
            >
              {t("agent.remember")}
            </Button>
          </Card>
        </>
      )}
      <ErrorNotice error={error} />
    </View>
  );
}
function MemoryRow({ memory }: { memory: AgentMemory }) {
  const colors = useColors();
  const s = useStyles();
  const { mutate } = useAgentWorkspace();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(memory.text);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function act(forget: boolean) {
    setBusy(true);
    setError("");
    try {
      await mutate(`/memories/${memory.id}${forget ? "/forget" : ""}`, forget ? {} : { text });
      setEditing(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View
      style={{ gap: 8, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.line }}
    >
      {editing ? (
        <Field label={t("agent.memoryLabel")} value={text} onChangeText={setText} />
      ) : (
        <Text style={s.text}>{memory.text}</Text>
      )}
      <Text style={s.small}>
        {memory.source} · {stamp(memory.createdAt)}
      </Text>
      <View style={[s.row, { gap: 8 }]}>
        {editing ? (
          <Button small busy={busy} disabled={!text.trim()} onPress={() => void act(false)}>
            {t("agent.saveCorrection")}
          </Button>
        ) : (
          <Button small onPress={() => setEditing(true)}>
            {t("agent.edit")}
          </Button>
        )}
        <Button small danger busy={busy} onPress={() => void act(true)}>
          {t("agent.forget")}
        </Button>
      </View>
      <ErrorNotice error={error} />
    </View>
  );
}
