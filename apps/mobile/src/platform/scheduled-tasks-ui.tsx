/**
 * H3 — User-scheduled tasks settings UI.
 *
 * List / add / delete / enable-toggle for "remind me" tasks.
 * All copy via i18n, 嘟嘟腔.
 */

import { Plus, Trash2 } from "lucide-react-native";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Alert, Pressable, Switch, View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { Button, Field, SectionHeading, Sheet, useColors, useStyles } from "../ui";
import { type ScheduledTask, scheduledTaskStore, type TaskRecurrence } from "./scheduled-tasks";

const RECURRENCE_OPTIONS: TaskRecurrence[] = ["once", "daily", "weekly", "monthly"];

function recurrenceLabel(r: TaskRecurrence): string {
  return t(`platform.tasks.repeat.${r}` as "platform.tasks.repeat.once");
}

function formatNextFire(ts: number): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function TaskRow({ task }: { task: ScheduledTask }) {
  const colors = useColors();
  const s = useStyles();
  const [busy, setBusy] = useState(false);

  const remove = () => {
    Alert.alert(t("platform.tasks.deleteConfirm"), task.title, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () => {
          setBusy(true);
          void scheduledTaskStore.remove(task.id).finally(() => setBusy(false));
        },
      },
    ]);
  };

  return (
    <View style={[s.card, { marginBottom: 8, opacity: task.enabled ? 1 : 0.6 }]}>
      <View style={[s.row, s.between]}>
        <View style={{ flex: 1 }}>
          <TText style={{ color: colors.text, fontSize: 15, fontWeight: "500" }}>
            {task.title}
          </TText>
          <TText style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>
            {recurrenceLabel(task.recurrence)} · {task.timeOfDay} · {t("platform.tasks.next")}
            {formatNextFire(task.nextFireAt)}
          </TText>
        </View>
        <Switch
          value={task.enabled}
          disabled={busy}
          onValueChange={(v) => void scheduledTaskStore.setEnabled(task.id, v)}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.delete")}
          onPress={remove}
          disabled={busy}
          style={{ padding: 8 }}
        >
          <Trash2 size={16} color={colors.danger} />
        </Pressable>
      </View>
    </View>
  );
}

function AddTaskSheet({ onClose }: { onClose: () => void }) {
  const colors = useColors();
  const s = useStyles();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [time, setTime] = useState("");
  const [recurrence, setRecurrence] = useState<TaskRecurrence>("once");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setError("");
    if (!/^\d{1,2}:\d{2}$/.test(time.trim())) {
      setError(t("platform.tasks.invalidTime"));
      return;
    }
    const [h, m] = time.trim().split(":").map(Number);
    if (h > 23 || m > 59) {
      setError(t("platform.tasks.invalidTime"));
      return;
    }
    setBusy(true);
    try {
      await scheduledTaskStore.add({
        title: title.trim() || t("platform.tasks.title"),
        message: message.trim(),
        timeOfDay: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
        recurrence,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={t("platform.tasks.add")} onClose={onClose}>
      <Field
        label={t("platform.tasks.name")}
        value={title}
        onChangeText={setTitle}
        placeholder={t("platform.tasks.name")}
      />
      <Field
        label={t("platform.tasks.message")}
        value={message}
        onChangeText={setMessage}
        placeholder={t("platform.tasks.message")}
        multiline
      />
      <Field
        label={t("platform.tasks.time")}
        value={time}
        onChangeText={setTime}
        placeholder="08:30"
        keyboardType="numbers-and-punctuation"
      />
      <TText style={{ color: colors.muted, fontSize: 12, marginBottom: 10 }}>
        {t("platform.tasks.timeHint")}
      </TText>
      <TText style={{ color: colors.muted, fontSize: 13, marginBottom: 8 }}>
        {t("platform.tasks.repeat")}
      </TText>
      <View style={[s.row, { flexWrap: "wrap", gap: 8, marginBottom: 16 }]}>
        {RECURRENCE_OPTIONS.map((r) => {
          const selected = recurrence === r;
          return (
            <Pressable
              key={r}
              accessibilityRole="button"
              onPress={() => setRecurrence(r)}
              style={[
                s.chip,
                selected && { backgroundColor: colors.blueDark, borderColor: colors.blueDark },
              ]}
            >
              <TText style={{ color: selected ? colors.onBlue : colors.text, fontSize: 14 }}>
                {recurrenceLabel(r)}
              </TText>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <TText style={{ color: colors.danger, fontSize: 13, marginBottom: 8 }}>{error}</TText>
      ) : null}
      <Button primary busy={busy} onPress={() => void save()}>
        {t("common.save")}
      </Button>
    </Sheet>
  );
}

export function ScheduledTasksSection() {
  const colors = useColors();
  const s = useStyles();
  const tasks = useSyncExternalStore(scheduledTaskStore.subscribe, scheduledTaskStore.getTasks);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    void scheduledTaskStore.load();
  }, []);

  return (
    <View>
      <SectionHeading
        title={t("platform.tasks.title")}
        action={t("platform.tasks.add")}
        onPress={() => setAdding(true)}
      />
      <TText style={{ color: colors.muted, fontSize: 13, marginBottom: 10 }}>
        {t("platform.tasks.hint")}
      </TText>

      {tasks.length === 0 ? (
        <TText style={{ color: colors.muted, fontSize: 14, marginBottom: 10 }}>
          {t("platform.tasks.empty")}
        </TText>
      ) : (
        tasks.map((task) => <TaskRow key={task.id} task={task} />)
      )}

      <Button icon={Plus} onPress={() => setAdding(true)}>
        {t("platform.tasks.add")}
      </Button>

      {adding ? <AddTaskSheet onClose={() => setAdding(false)} /> : null}
    </View>
  );
}
