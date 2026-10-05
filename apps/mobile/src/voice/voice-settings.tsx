/**
 * Voice settings: TTS + STT + mic behavior.
 *
 * - TTS: edge-tts (free, no key, built-in default) or a custom
 *   OpenAI-compatible /audio/speech endpoint the user fills in herself.
 * - STT: the active API group's /audio/transcriptions, or a dedicated
 *   custom endpoint.
 * - Mic button behavior: transcribe-to-input (default) or voice message.
 *
 * Secrets only ever go to SecureStore (see ./store.ts) — never the repo,
 * never logs, never chat.
 */

import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, Switch, View } from "react-native";
import { useApiGroups } from "../api-groups/store";
import { TText } from "../font";
import { getLocale, t } from "../i18n";
import { radii } from "../theme/radii";
import { Button, Card, Field, useColors, useStyles } from "../ui";
import type { Alarm } from "./alarms";
import { getAlarmStore } from "./alarms-instance";
import { useVoiceConfig, voiceStore } from "./store";
import { transcribeAudio } from "./stt";
import { synthesizeSpeech } from "./tts";
import {
  EDGE_TTS_CHINESE_VOICES,
  STT_PRESET_DEFAULTS,
  TTS_PROVIDER_DEFAULTS,
  type MicMode,
  type SttConfig,
  type TtsConfig,
  validateSttConfig,
  validateTtsConfig,
} from "./types";

function ProviderTabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ id: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {options.map((o) => {
        const active = value === o.id;
        return (
          <Pressable
            key={o.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.id)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderRadius: radii.sm,
              borderWidth: 1,
              borderColor: active ? colors.blueDark : colors.line,
              backgroundColor: active ? colors.sky : colors.card,
            }}
          >
            <TText style={{ fontWeight: "700", color: active ? colors.blueDark : colors.text }}>
              {o.label}
            </TText>
          </Pressable>
        );
      })}
    </View>
  );
}

function TtsSection() {
  const colors = useColors();
  const { tts, loaded } = useVoiceConfig();
  const [draft, setDraft] = useState<TtsConfig | null>(null);
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState("");
  const [testOk, setTestOk] = useState(false);
  // The preview player must be released — every test used to leak one.
  const testPlayer = useRef<{ release: () => void } | null>(null);
  useEffect(() => {
    return () => {
      testPlayer.current?.release();
      testPlayer.current = null;
    };
  }, []);
  const cfg = draft ?? tts;
  const dirty = draft !== null;

  function set<K extends keyof TtsConfig>(key: K, value: TtsConfig[K]) {
    setDraft((d) => ({ ...(d ?? tts), [key]: value }));
    setError("");
    setTestMsg("");
  }

  async function onSave() {
    const problem = validateTtsConfig(cfg);
    if (problem) {
      setError(t(`voice.${problem}`));
      return;
    }
    const ok = await voiceStore.setTts(cfg);
    if (ok) {
      setDraft(null);
    } else {
      setError(t("voice.saveFailed"));
    }
  }

  async function onTest() {
    const problem = validateTtsConfig(cfg);
    if (problem) {
      setError(t(`voice.${problem}`));
      return;
    }
    setTesting(true);
    setTestMsg("");
    setTestOk(false);
    try {
      const uri = await synthesizeSpeech(t("voice.testText"), cfg);
      // Play it back immediately — hearing it IS the test.
      const { createAudioPlayer, setAudioModeAsync } = await import("expo-audio");
      await setAudioModeAsync({ playsInSilentMode: true });
      // Release the previous preview first: one player at a time, no leaks.
      testPlayer.current?.release();
      const player = createAudioPlayer(uri);
      testPlayer.current = player;
      player.play();
      setTestOk(true);
      setTestMsg(t("voice.testOk"));
    } catch (e) {
      setTestOk(false);
      setTestMsg(t("voice.testFail", { msg: e instanceof Error ? e.message : String(e) }));
    } finally {
      setTesting(false);
    }
  }

  if (!loaded) return null;
  return (
    <Card>
      <TText style={{ fontWeight: "700", marginBottom: 8 }}>{t("voice.ttsTitle")}</TText>
      <ProviderTabs
        value={cfg.provider}
        onChange={(v) => set("provider", v)}
        options={[
          { id: "edge-tts", label: t("voice.ttsEdge") },
          { id: "minimax", label: t("voice.ttsMinimax") },
          { id: "fish-audio", label: t("voice.ttsFishAudio") },
          { id: "stepfun", label: t("voice.ttsStepfun") },
          { id: "qwen", label: t("voice.ttsQwen") },
          { id: "custom", label: t("voice.ttsCustom") },
        ]}
      />
      <View style={{ marginTop: 10, gap: 10 }}>
        {cfg.provider === "edge-tts" ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {EDGE_TTS_CHINESE_VOICES.map((v) => {
              const active = cfg.voice === v.id;
              return (
                <Pressable
                  key={v.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  onPress={() => set("voice", v.id)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: radii.lg,
                    borderWidth: 1,
                    borderColor: active ? colors.blueDark : colors.line,
                    backgroundColor: active ? colors.sky : colors.card,
                  }}
                >
                  <TText
                    style={{ color: active ? colors.blueDark : colors.text, fontWeight: "600" }}
                  >
                    {v.label}
                  </TText>
                </Pressable>
              );
            })}
          </View>
        ) : cfg.provider === "custom" ? (
          <>
            <Field
              label={t("voice.ttsUrl")}
              value={cfg.customUrl ?? ""}
              onChangeText={(v) => set("customUrl", v)}
              placeholder="https://api.openai.com/v1"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Field
              label={t("voice.ttsKey")}
              value={cfg.customKey ?? ""}
              onChangeText={(v) => set("customKey", v)}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Field
              label={t("voice.ttsModel")}
              value={cfg.customModel ?? ""}
              onChangeText={(v) => set("customModel", v)}
              placeholder="tts-1"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Field
              label={t("voice.ttsVoice")}
              value={cfg.voice}
              onChangeText={(v) => set("voice", v)}
              placeholder="alloy"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </>
        ) : (
          <>
            <Field
              label={t("voice.ttsKey")}
              value={cfg.providerKey ?? ""}
              onChangeText={(v) => set("providerKey", v)}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Field
              label={t("voice.ttsProviderUrl")}
              value={cfg.providerUrl ?? ""}
              onChangeText={(v) => set("providerUrl", v)}
              placeholder={t("voice.ttsProviderUrlDefault", {
                url: TTS_PROVIDER_DEFAULTS[cfg.provider as keyof typeof TTS_PROVIDER_DEFAULTS]?.baseUrl ?? "",
              })}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Field
              label={t("voice.ttsProviderModel")}
              value={cfg.providerModel ?? ""}
              onChangeText={(v) => set("providerModel", v)}
              placeholder={t("voice.ttsProviderModelDefault", {
                model: TTS_PROVIDER_DEFAULTS[cfg.provider as keyof typeof TTS_PROVIDER_DEFAULTS]?.model ?? "",
              })}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Field
              label={t("voice.ttsVoice")}
              value={cfg.voice}
              onChangeText={(v) => set("voice", v)}
              placeholder={t("voice.ttsVoiceHint")}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </>
        )}
        <View style={{ gap: 6 }}>
          <TText style={{ fontWeight: "600", color: colors.muted }}>{t("voice.ttsSpeed")}</TText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((r) => {
              const active = (cfg.rate ?? 1.0) === r;
              return (
                <Pressable
                  key={r}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  onPress={() => set("rate", r === 1.0 ? undefined : r)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: radii.lg,
                    borderWidth: 1,
                    borderColor: active ? colors.blueDark : colors.line,
                    backgroundColor: active ? colors.sky : colors.card,
                  }}
                >
                  <TText
                    style={{ color: active ? colors.blueDark : colors.text, fontWeight: "600" }}
                  >
                    {r}x
                  </TText>
                </Pressable>
              );
            })}
          </View>
        </View>
        {!!error && <TText style={{ color: colors.danger }}>{error}</TText>}
        {!!testMsg && (
          <TText style={{ color: testOk ? colors.text : colors.danger }}>{testMsg}</TText>
        )}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button onPress={() => void onTest()} busy={testing}>
              {t("voice.test")}
            </Button>
          </View>
          {dirty && (
            <View style={{ flex: 1 }}>
              <Button primary onPress={() => void onSave()}>
                {t("common.save")}
              </Button>
            </View>
          )}
        </View>
      </View>
    </Card>
  );
}

function SttSection() {
  const colors = useColors();
  const { stt, loaded } = useVoiceConfig();
  const { active: activeGroup } = useApiGroups();
  const [draft, setDraft] = useState<SttConfig | null>(null);
  const [error, setError] = useState("");
  const cfg = draft ?? stt;
  const dirty = draft !== null;

  // ---- STT test: record a short clip, transcribe it, show the result ----
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [testPhase, setTestPhase] = useState<"idle" | "recording" | "transcribing">("idle");
  const [testSecs, setTestSecs] = useState(0);
  const [testResult, setTestResult] = useState("");
  const [testError, setTestError] = useState("");
  const testTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const testStartRef = useRef(0);
  // P2-13: the 10s auto-stop timer and her manual stop tap can both pass
  // the isRecording check — the second recorder.stop() rejects and paints
  // a bogus red error over a successful transcription (plus a double
  // network transcription). First stop wins; the other is a no-op.
  const stoppingTestRef = useRef(false);

  function clearTestTimer() {
    if (testTimer.current) {
      clearInterval(testTimer.current);
      testTimer.current = null;
    }
  }

  // Cleanup on unmount: stop any in-progress test recording.
  useEffect(() => {
    return () => {
      clearTestTimer();
      if (recorder.isRecording) {
        void recorder.stop().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startTest() {
    setTestResult("");
    setTestError("");
    try {
      const { status } = await requestRecordingPermissionsAsync();
      if (status !== "granted") {
        setTestError(t("voice.sttTestNoMic") as string);
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      testStartRef.current = Date.now();
      setTestSecs(0);
      setTestPhase("recording");
      testTimer.current = setInterval(() => {
        const s = Math.floor((Date.now() - testStartRef.current) / 1000);
        setTestSecs(s);
        if (s >= 10) void stopTest(); // auto-stop at 10s
      }, 500);
    } catch (e) {
      setTestError(e instanceof Error ? e.message : String(e));
      setTestPhase("idle");
    }
  }

  async function stopTest() {
    // P2-13: stop is one-shot. The auto-stop timer and a manual tap race
    // here; without the guard the loser rejects on recorder.stop() and
    // shows a bogus error after a successful transcription.
    if (stoppingTestRef.current) return;
    stoppingTestRef.current = true;
    clearTestTimer();
    try {
      // NOTE: don't read testPhase here — the 10s auto-stop timer runs in a
      // stale closure. recorder.isRecording is the source of truth.
      if (!recorder.isRecording) {
        setTestPhase("idle");
        return;
      }
      setTestPhase("transcribing");
      try {
        await recorder.stop();
        const uri = recorder.uri;
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        if (!uri) throw new Error(t("voice.sttTestNoAudio") as string);
        const text = await transcribeAudio(uri, activeGroup, cfg);
        setTestResult(text);
      } catch (e) {
        setTestError(e instanceof Error ? e.message : String(e));
      } finally {
        setTestPhase("idle");
        setTestSecs(0);
      }
    } finally {
      stoppingTestRef.current = false;
    }
  }

  function set<K extends keyof SttConfig>(key: K, value: SttConfig[K]) {
    setDraft((d) => ({ ...(d ?? stt), [key]: value }));
    setError("");
  }

  async function onSave() {
    const problem = validateSttConfig(cfg);
    if (problem) {
      setError(t(`voice.${problem}`));
      return;
    }
    const ok = await voiceStore.setStt(cfg);
    if (ok) {
      setDraft(null);
    } else {
      setError(t("voice.saveFailed"));
    }
  }

  if (!loaded) return null;
  return (
    <Card>
      <TText style={{ fontWeight: "700", marginBottom: 8 }}>{t("voice.sttTitle")}</TText>
      <ProviderTabs
        value={cfg.provider}
        onChange={(v) => set("provider", v)}
        options={[
          { id: "group", label: t("voice.sttGroup") },
          { id: "dashscope", label: t("voice.sttDashscope") },
          { id: "stepfun", label: t("voice.sttStepfun") },
          { id: "custom", label: t("voice.sttCustom") },
        ]}
      />
      {cfg.provider === "custom" && (
        <View style={{ marginTop: 10, gap: 10 }}>
          <Field
            label={t("voice.sttUrl")}
            value={cfg.customUrl ?? ""}
            onChangeText={(v) => set("customUrl", v)}
            placeholder="https://api.openai.com/v1"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Field
            label={t("voice.sttKey")}
            value={cfg.customKey ?? ""}
            onChangeText={(v) => set("customKey", v)}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Field
            label={t("voice.sttModel")}
            value={cfg.customModel ?? ""}
            onChangeText={(v) => set("customModel", v)}
            placeholder="whisper-1"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      )}
      {(cfg.provider === "dashscope" || cfg.provider === "stepfun") && (
        <View style={{ marginTop: 10, gap: 10 }}>
          <Field
            label={t("voice.ttsKey")}
            value={cfg.presetKey ?? ""}
            onChangeText={(v) => set("presetKey", v)}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Field
            label={t("voice.sttPresetModel")}
            value={cfg.presetModel ?? ""}
            onChangeText={(v) => set("presetModel", v)}
            placeholder={STT_PRESET_DEFAULTS[cfg.provider].model}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      )}
      {!!error && <TText style={{ color: colors.danger }}>{error}</TText>}
      {dirty && (
        <View style={{ marginTop: 10 }}>
          <Button primary onPress={() => void onSave()}>
            {t("common.save")}
          </Button>
        </View>
      )}
      {/* ---- STT test entry ---- */}
      <View
        style={{ marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line }}
      >
        <TText style={{ fontWeight: "700", marginBottom: 4 }}>{t("voice.sttTest")}</TText>
        <TText style={{ color: colors.muted, fontSize: 12, marginBottom: 10 }}>
          {t("voice.sttTestDesc")}
        </TText>
        {testPhase === "idle" ? (
          <Button onPress={() => void startTest()}>{t("voice.sttTestStart")}</Button>
        ) : testPhase === "recording" ? (
          <View style={{ gap: 8 }}>
            <TText style={{ color: colors.danger, fontWeight: "700" }}>
              {t("voice.sttTestRecording", { n: testSecs })}
            </TText>
            <Button onPress={() => void stopTest()}>{t("voice.sttTestStop")}</Button>
          </View>
        ) : (
          <TText style={{ color: colors.muted }}>{t("voice.sttTestTranscribing")}</TText>
        )}
        {!!testResult && (
          <View
            style={{
              marginTop: 10,
              padding: 10,
              borderRadius: radii.sm,
              backgroundColor: colors.sky,
            }}
          >
            <TText style={{ fontWeight: "700", fontSize: 12, marginBottom: 4 }}>
              {t("voice.sttTestResult")}
            </TText>
            <TText style={{ fontSize: 14, lineHeight: 20 }}>{testResult}</TText>
          </View>
        )}
        {!!testError && (
          <TText style={{ color: colors.danger, marginTop: 10, fontSize: 13 }}>{testError}</TText>
        )}
      </View>
    </Card>
  );
}

function MicModeSection() {
  const colors = useColors();
  const s = useStyles();
  const { settings, loaded } = useVoiceConfig();
  const [error, setError] = useState("");

  async function setMode(m: MicMode) {
    setError("");
    const ok = await voiceStore.setSettings({ ...settings, micMode: m });
    if (!ok) setError(t("voice.saveFailed"));
  }

  async function setAutoRead(v: boolean) {
    setError("");
    const ok = await voiceStore.setSettings({ ...settings, autoRead: v });
    if (!ok) setError(t("voice.saveFailed"));
  }

  if (!loaded) return null;
  const modes: Array<{ id: MicMode; label: string; desc: string }> = [
    { id: "transcribe", label: t("voice.micTranscribe"), desc: t("voice.micTranscribeDesc") },
    {
      id: "voice-message",
      label: t("voice.micVoiceMessage"),
      desc: t("voice.micVoiceMessageDesc"),
    },
  ];
  return (
    <Card>
      <TText style={{ fontWeight: "700", marginBottom: 8 }}>{t("voice.micMode")}</TText>
      {!!error && <TText style={{ color: colors.danger, marginBottom: 8 }}>{error}</TText>}
      <View style={{ gap: 8 }}>
        {modes.map((m) => {
          const active = settings.micMode === m.id;
          return (
            <Pressable
              key={m.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              onPress={() => setMode(m.id)}
              style={{
                padding: 10,
                borderRadius: radii.sm,
                borderWidth: 1,
                borderColor: active ? colors.blueDark : colors.line,
                backgroundColor: active ? colors.sky : colors.card,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <View style={{ flex: 1 }}>
                <TText style={{ fontWeight: "700", color: active ? colors.blueDark : colors.text }}>
                  {m.label}
                </TText>
                <TText style={[s.small, { color: colors.muted, marginTop: 2 }]}>{m.desc}</TText>
              </View>
              <Switch value={active} onValueChange={() => setMode(m.id)} />
            </Pressable>
          );
        })}
        <View
          style={{
            padding: 10,
            borderRadius: radii.sm,
            borderWidth: 1,
            borderColor: colors.line,
            backgroundColor: colors.card,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View style={{ flex: 1 }}>
            <TText style={{ fontWeight: "700", color: colors.text }}>{t("voice.autoRead")}</TText>
            <TText style={[s.small, { color: colors.muted, marginTop: 2 }]}>
              {t("voice.autoReadDesc")}
            </TText>
          </View>
          <Switch value={settings.autoRead} onValueChange={(v) => void setAutoRead(v)} />
        </View>
      </View>
    </Card>
  );
}

export function VoiceSettingsSection() {
  const s = useStyles();
  return (
    <View style={{ gap: 12 }}>
      <TText style={[s.small, { fontWeight: "700" }]}>{t("voice.title")}</TText>
      <TtsSection />
      <SttSection />
      <MicModeSection />
      <AlarmsSection />
      <CacheSection />
    </View>
  );
}

function formatAlarmWhen(fireAt: number): string {
  const d = new Date(fireAt);
  return d.toLocaleString(getLocale() === "en" ? "en-US" : "zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Alarm management: the alarms the AI set for her, listed with time,
 * label, on/off switch, time editing, and delete. Every control hits
 * the real alarm store (same one behind set_alarm) — no decorative UI.
 */
function AlarmsSection() {
  const colors = useColors();
  const s = useStyles();
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editError, setEditError] = useState("");

  async function refresh() {
    try {
      setAlarms(await getAlarmStore().list());
    } catch {
      // Storage read failure — show empty rather than crash.
      setAlarms([]);
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onToggle(alarm: Alarm, value: boolean) {
    setError("");
    setBusyId(alarm.id);
    try {
      await getAlarmStore().setEnabled(alarm.id, value);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  function onDelete(alarm: Alarm) {
    Alert.alert(t("voice.alarmConfirmDeleteTitle") as string, undefined, [
      { text: t("common.cancel") as string, style: "cancel" },
      {
        text: t("voice.alarmDelete") as string,
        style: "destructive",
        onPress: () => {
          setError("");
          setBusyId(alarm.id);
          void (async () => {
            try {
              await getAlarmStore().cancel(alarm.id);
              await refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusyId(null);
            }
          })();
        },
      },
    ]);
  }

  function startEdit(alarm: Alarm) {
    const d = new Date(alarm.fireAt);
    setEditDate(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`);
    setEditTime(`${pad2(d.getHours())}:${pad2(d.getMinutes())}`);
    setEditError("");
    setEditingId(alarm.id);
  }

  async function onSaveEdit(alarm: Alarm) {
    setEditError("");
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(editDate.trim());
    const tm = /^(\d{2}):(\d{2})$/.exec(editTime.trim());
    if (!dm || !tm) {
      setEditError(t("voice.alarmInvalidTime") as string);
      return;
    }
    const fireAt = new Date(
      Number(dm[1]),
      Number(dm[2]) - 1,
      Number(dm[3]),
      Number(tm[1]),
      Number(tm[2]),
      0,
    ).getTime();
    if (!Number.isFinite(fireAt)) {
      setEditError(t("voice.alarmInvalidTime") as string);
      return;
    }
    setBusyId(alarm.id);
    try {
      await getAlarmStore().reschedule(alarm.id, fireAt);
      setEditingId(null);
      await refresh();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  if (!loaded) return null;
  return (
    <Card>
      <TText style={{ fontWeight: "700", marginBottom: 4 }}>{t("voice.alarmTitle")}</TText>
      <TText style={[s.small, { color: colors.muted, marginBottom: 10 }]}>
        {t("voice.alarmDesc")}
      </TText>
      {!!error && <TText style={{ color: colors.danger, marginBottom: 8 }}>{error}</TText>}
      {alarms.length === 0 ? (
        <TText style={[s.small, { color: colors.muted }]}>{t("voice.alarmEmpty")}</TText>
      ) : (
        <View style={{ gap: 8 }}>
          {alarms.map((alarm) => {
            const on = alarm.enabled !== false;
            const editing = editingId === alarm.id;
            const busy = busyId === alarm.id;
            return (
              <View
                key={alarm.id}
                style={{
                  padding: 10,
                  borderRadius: radii.sm,
                  borderWidth: 1,
                  borderColor: colors.line,
                  backgroundColor: colors.card,
                  opacity: on ? 1 : 0.55,
                  gap: 8,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <TText style={{ fontWeight: "700", color: colors.text }}>
                      {formatAlarmWhen(alarm.fireAt)}
                    </TText>
                    <TText style={[s.small, { color: colors.muted, marginTop: 2 }]}>
                      {alarm.label} ·{" "}
                      {t(alarm.viaAlarmKit ? "voice.alarmViaSystem" : "voice.alarmViaNotification")}
                      {" · "}
                      {t(on ? "voice.alarmOn" : "voice.alarmOff")}
                    </TText>
                  </View>
                  <Switch
                    value={on}
                    disabled={busy}
                    onValueChange={(v) => void onToggle(alarm, v)}
                  />
                </View>
                {editing ? (
                  <View style={{ gap: 8 }}>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <Field
                          label={t("voice.alarmEditDate") as string}
                          value={editDate}
                          onChangeText={setEditDate}
                          placeholder="2026-10-06"
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Field
                          label={t("voice.alarmTime") as string}
                          value={editTime}
                          onChangeText={setEditTime}
                          placeholder="07:00"
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                      </View>
                    </View>
                    {!!editError && (
                      <TText style={{ color: colors.danger, fontSize: 13 }}>{editError}</TText>
                    )}
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <Button small onPress={() => setEditingId(null)}>
                          {t("common.cancel")}
                        </Button>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Button small primary busy={busy} onPress={() => void onSaveEdit(alarm)}>
                          {t("common.save")}
                        </Button>
                      </View>
                    </View>
                  </View>
                ) : (
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Button small disabled={busy} onPress={() => startEdit(alarm)}>
                        {t("voice.alarmEdit")}
                      </Button>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button small danger disabled={busy} onPress={() => onDelete(alarm)}>
                        {t("voice.alarmDelete")}
                      </Button>
                    </View>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
    </Card>
  );
}

function CacheSection() {
  const colors = useColors();
  const s = useStyles();
  const [size, setSize] = useState<number | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [doneMsg, setDoneMsg] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const m = await import("./cache-cleanup");
        setSize(await m.getVoiceCacheSize());
      } catch {
        setSize(null);
      }
    })();
  }, []);

  async function onClean() {
    setCleaning(true);
    setDoneMsg("");
    try {
      const m = await import("./cache-cleanup");
      const r = await m.cleanVoiceCache();
      const zh = getLocale() === "zh-Hans";
      setDoneMsg(
        r.deleted === 0
          ? t("voice.cache.nothing")
          : t("voice.cache.cleaned", { n: r.deleted, size: m.formatBytes(r.freedBytes, zh) }),
      );
      setSize(await m.getVoiceCacheSize());
    } catch {
      setDoneMsg(t("voice.cache.failed"));
    } finally {
      setCleaning(false);
    }
  }

  const zh = getLocale() === "zh-Hans";
  return (
    <Card>
      <TText style={{ fontWeight: "700", marginBottom: 8 }}>{t("voice.cache.title")}</TText>
      <TText style={[s.small, { color: colors.muted, marginBottom: 10 }]}>
        {t("voice.cache.desc")}
      </TText>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button onPress={() => void onClean()} busy={cleaning}>
            {t("voice.cache.clean")}
          </Button>
        </View>
        {size !== null && (
          <TText style={[s.small, { color: colors.muted }]}>{formatCacheSizeLabel(size, zh)}</TText>
        )}
      </View>
      {!!doneMsg && (
        <TText style={[s.small, { color: colors.muted, marginTop: 8 }]}>{doneMsg}</TText>
      )}
    </Card>
  );
}

function formatCacheSizeLabel(bytes: number, zh: boolean): string {
  if (bytes < 1024) return zh ? `${bytes} 字节` : `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
