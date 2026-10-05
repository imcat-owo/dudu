/**
 * Proactive initiative （主动约定） — management UI for Our Space.
 * List rules, create (daily / interval), archive, restore, delete,
 * run-now, and set the per-persona daily cap (default 3, shared with
 * the proactive outreach channel).
 */

import { Pause, Plus, RotateCcw, Trash2, Zap } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { personaStore } from "../persona/stores";
import { radii } from "../theme/radii";
import { Card, useColors, useStyles } from "../ui";
import { fireInitiativeRule } from "./executor";
import { buildInitiativeDeps, createNotificationPort, initiativeStore } from "./instances";
import {
  DEFAULT_DAILY_CAP,
  describeSchedule,
  type InitiativeRule,
  type InitiativeSchedule,
  nextFireAt,
  validateRuleInput,
} from "./rules";
import { cancelScheduled, ensureScheduled } from "./scheduler";

interface PersonaOption {
  id: string;
  name: string;
}

async function reschedule(rule: InitiativeRule): Promise<void> {
  try {
    const deps = await buildInitiativeDeps();
    await ensureScheduled(deps, rule);
  } catch {
    // ignore — the foreground tick is the backstop
  }
}

async function disarm(ruleId: string): Promise<void> {
  try {
    const port = await createNotificationPort();
    await cancelScheduled(port, ruleId);
  } catch {
    // ignore
  }
}

function nextFireLabel(rule: InitiativeRule): string {
  const next = nextFireAt(rule, Date.now());
  if (next === null) return "—";
  return new Date(next).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function InitiativeSection() {
  const colors = useColors();
  const s = useStyles();
  const [rules, setRules] = useState<InitiativeRule[]>([]);
  const [personas, setPersonas] = useState<PersonaOption[]>([]);
  const [cap, setCap] = useState<number>(DEFAULT_DAILY_CAP);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // form state
  const [fPersonaId, setFPersonaId] = useState("");
  const [fTitle, setFTitle] = useState("");
  const [fTopic, setFTopic] = useState("");
  const [fType, setFType] = useState<"daily" | "interval">("daily");
  const [fHour, setFHour] = useState("8");
  const [fMinute, setFMinute] = useState("0");
  const [fEveryHours, setFEveryHours] = useState("6");

  const refresh = () => {
    void initiativeStore
      .list(true)
      .then(setRules)
      .catch(() => {});
    void initiativeStore
      .getDailyCap()
      .then(setCap)
      .catch(() => {});
    void personaStore
      .list()
      .then((ps) => setPersonas(ps.map((p) => ({ id: p.id, name: p.name }))))
      .catch(() => {});
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (personas.length > 0 && !fPersonaId) setFPersonaId(personas[0].id);
  }, [personas, fPersonaId]);

  const inputStyle = {
    color: colors.text,
    fontSize: 15,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.card,
  } as const;

  const chip = (selected: boolean, onPress: () => void, label: string) => (
    <Pressable
      key={label}
      onPress={onPress}
      style={{
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: radii.sm,
        borderWidth: 1.5,
        borderColor: selected ? colors.blueDark : colors.line,
        backgroundColor: selected ? colors.sky : colors.card,
      }}
    >
      <TText style={{ fontSize: 14, fontWeight: selected ? "700" : "400" }}>{label}</TText>
    </Pressable>
  );

  const submit = () => {
    const hour = Number.parseInt(fHour, 10);
    const minute = Number.parseInt(fMinute, 10);
    const everyHours = Number.parseFloat(fEveryHours);
    const schedule: InitiativeSchedule | null =
      fType === "daily"
        ? Number.isInteger(hour) && Number.isInteger(minute)
          ? { kind: "daily", hour, minute }
          : null
        : Number.isFinite(everyHours) && everyHours > 0
          ? { kind: "interval", everyMs: Math.round(everyHours * 3_600_000) }
          : null;
    const errs = validateRuleInput({
      personaId: fPersonaId,
      title: fTitle,
      topic: fTopic,
      type: fType,
      schedule,
      target: { mode: "latest" },
    });
    if (errs.length > 0) {
      Alert.alert(errs[0].message);
      return;
    }
    void (async () => {
      try {
        const rule = await initiativeStore.create({
          personaId: fPersonaId,
          title: fTitle,
          topic: fTopic,
          type: fType,
          schedule: schedule as InitiativeSchedule,
          target: { mode: "latest" },
        });
        await reschedule(rule);
        setShowForm(false);
        setFTitle("");
        setFTopic("");
        refresh();
      } catch {
        Alert.alert(t("initiative.form.createFailed") as string);
      }
    })();
  };

  const doArchive = (id: string) =>
    void (async () => {
      await initiativeStore.setStatus(id, "archived");
      await disarm(id);
      refresh();
    })();

  const doRestore = (id: string) =>
    void (async () => {
      await initiativeStore.setStatus(id, "active");
      const rule = await initiativeStore.get(id);
      if (rule) await reschedule(rule);
      refresh();
    })();

  const doDelete = (id: string) =>
    Alert.alert(t("initiative.actions.delete") as string, undefined, [
      { text: t("common.cancel") as string, style: "cancel" },
      {
        text: t("common.delete") as string,
        style: "destructive",
        onPress: () =>
          void (async () => {
            await initiativeStore.remove(id);
            await disarm(id);
            refresh();
          })(),
      },
    ]);

  const doRunNow = (id: string) =>
    void (async () => {
      setBusy(id);
      try {
        const deps = await buildInitiativeDeps();
        const outcome = await fireInitiativeRule(deps, id, Date.now());
        Alert.alert(
          outcome.fired
            ? (t("initiative.runNow.sent") as string)
            : (t("initiative.runNow.failed") as string),
          outcome.fired ? outcome.text : `${t("initiative.runNow.reason")}${outcome.reason}`,
        );
      } catch {
        Alert.alert(t("initiative.runNow.failed") as string);
      } finally {
        setBusy(null);
        refresh();
      }
    })();

  const changeCap = (delta: number) => {
    const next = Math.max(1, Math.min(10, cap + delta));
    setCap(next);
    void initiativeStore.setDailyCap(next).catch(() => {});
  };

  return (
    <Card>
      <TText style={{ fontWeight: "700", fontSize: 16 }}>{t("initiative.section.title")}</TText>
      <TText style={[s.small, { color: colors.muted, marginTop: 4 }]}>
        {t("initiative.section.desc")}
      </TText>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 12,
        }}
      >
        <View style={{ flex: 1 }}>
          <TText style={{ fontSize: 14, fontWeight: "600" }}>{t("initiative.dailyCap")}</TText>
          <TText style={[s.small, { color: colors.muted }]}>{t("initiative.dailyCap.hint")}</TText>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Pressable
            accessibilityLabel={t("initiative.cap.decrease") as string}
            onPress={() => changeCap(-1)}
            style={{
              width: 32,
              height: 32,
              borderRadius: radii.sm,
              borderWidth: 1,
              borderColor: colors.line,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <TText style={{ fontSize: 18 }}>−</TText>
          </Pressable>
          <TText style={{ fontSize: 17, fontWeight: "700", minWidth: 24, textAlign: "center" }}>
            {cap}
          </TText>
          <Pressable
            accessibilityLabel={t("initiative.cap.increase") as string}
            onPress={() => changeCap(1)}
            style={{
              width: 32,
              height: 32,
              borderRadius: radii.sm,
              borderWidth: 1,
              borderColor: colors.line,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <TText style={{ fontSize: 18 }}>＋</TText>
          </Pressable>
        </View>
      </View>

      <View style={{ marginTop: 14, gap: 10 }}>
        {rules.length === 0 && !showForm && (
          <TText style={[s.small, { color: colors.muted }]}>{t("initiative.list.empty")}</TText>
        )}
        {rules.map((rule) => {
          const personaName = personas.find((p) => p.id === rule.personaId)?.name ?? rule.personaId;
          const archived = rule.status === "archived";
          return (
            <View
              key={rule.id}
              style={{
                borderWidth: 1,
                borderColor: colors.line,
                borderRadius: radii.sm,
                padding: 10,
                opacity: archived ? 0.6 : 1,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <TText style={{ fontWeight: "700", fontSize: 15, flex: 1 }}>{rule.title}</TText>
                {archived && (
                  <TText style={[s.small, { color: colors.muted }]}>
                    {t("initiative.archived")}
                  </TText>
                )}
              </View>
              <TText style={[s.small, { color: colors.muted, marginTop: 2 }]}>
                {personaName} · {describeSchedule(rule)}
                {!archived && ` · ${t("initiative.nextFire", { time: nextFireLabel(rule) })}`}
              </TText>
              <TText style={{ fontSize: 13, marginTop: 4, color: colors.text }} numberOfLines={2}>
                {rule.topic}
              </TText>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                <Pressable
                  onPress={() => doRunNow(rule.id)}
                  disabled={busy === rule.id || archived}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    opacity: archived ? 0.4 : 1,
                  }}
                >
                  <Zap size={14} color={colors.blueDark} />
                  <TText style={{ fontSize: 13, color: colors.blueDark }}>
                    {busy === rule.id ? "…" : t("initiative.actions.runNow")}
                  </TText>
                </Pressable>
                {archived ? (
                  <Pressable
                    onPress={() => doRestore(rule.id)}
                    style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                  >
                    <RotateCcw size={14} color={colors.text} />
                    <TText style={{ fontSize: 13 }}>{t("initiative.actions.restore")}</TText>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => doArchive(rule.id)}
                    style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                  >
                    <Pause size={14} color={colors.text} />
                    <TText style={{ fontSize: 13 }}>{t("initiative.actions.archive")}</TText>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => doDelete(rule.id)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                >
                  <Trash2 size={14} color={colors.muted} />
                  <TText style={{ fontSize: 13, color: colors.muted }}>
                    {t("initiative.actions.delete")}
                  </TText>
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>

      {showForm ? (
        <View style={{ marginTop: 14, gap: 10 }}>
          <TText style={{ fontSize: 12, color: colors.muted }}>
            {t("initiative.form.persona")}
          </TText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {personas.map((p) => chip(p.id === fPersonaId, () => setFPersonaId(p.id), p.name))}
          </View>
          <TextInput
            value={fTitle}
            onChangeText={setFTitle}
            placeholder={t("initiative.form.titlePh") as string}
            placeholderTextColor={colors.muted}
            style={inputStyle}
          />
          <TextInput
            value={fTopic}
            onChangeText={setFTopic}
            placeholder={t("initiative.form.topicPh") as string}
            placeholderTextColor={colors.muted}
            multiline
            style={[inputStyle, { minHeight: 60, textAlignVertical: "top" }]}
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            {chip(fType === "daily", () => setFType("daily"), t("initiative.form.daily") as string)}
            {chip(
              fType === "interval",
              () => setFType("interval"),
              t("initiative.form.interval") as string,
            )}
          </View>
          {fType === "daily" ? (
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <TextInput
                value={fHour}
                onChangeText={setFHour}
                keyboardType="number-pad"
                placeholder={t("initiative.form.hourPh") as string}
                placeholderTextColor={colors.muted}
                style={[inputStyle, { flex: 1, textAlign: "center" }]}
              />
              <TText>:</TText>
              <TextInput
                value={fMinute}
                onChangeText={setFMinute}
                keyboardType="number-pad"
                placeholder={t("initiative.form.minutePh") as string}
                placeholderTextColor={colors.muted}
                style={[inputStyle, { flex: 1, textAlign: "center" }]}
              />
              <TText style={[s.small, { color: colors.muted }]}>
                {t("initiative.form.shanghaiTime")}
              </TText>
            </View>
          ) : (
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <TText style={{ fontSize: 14 }}>{t("initiative.form.every")}</TText>
              <TextInput
                value={fEveryHours}
                onChangeText={setFEveryHours}
                keyboardType="decimal-pad"
                style={[inputStyle, { flex: 1, textAlign: "center" }]}
              />
              <TText style={{ fontSize: 14 }}>{t("initiative.form.hours")}</TText>
            </View>
          )}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              onPress={submit}
              style={{
                flex: 1,
                backgroundColor: colors.blueDark,
                borderRadius: radii.sm,
                paddingVertical: 10,
                alignItems: "center",
              }}
            >
              <TText style={{ color: "#fff", fontWeight: "700" }}>
                {t("initiative.form.submit")}
              </TText>
            </Pressable>
            <Pressable
              onPress={() => setShowForm(false)}
              style={{
                borderWidth: 1,
                borderColor: colors.line,
                borderRadius: radii.sm,
                paddingVertical: 10,
                paddingHorizontal: 16,
                alignItems: "center",
              }}
            >
              <TText>{t("common.cancel")}</TText>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          onPress={() => setShowForm(true)}
          style={{
            marginTop: 14,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            borderWidth: 1.5,
            borderStyle: "dashed",
            borderColor: colors.line,
            borderRadius: radii.sm,
            paddingVertical: 10,
          }}
        >
          <Plus size={16} color={colors.blueDark} />
          <TText style={{ color: colors.blueDark, fontWeight: "600" }}>{t("initiative.add")}</TText>
        </Pressable>
      )}
    </Card>
  );
}
