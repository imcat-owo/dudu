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

import { useState } from "react";
import { Pressable, ScrollView, Switch, View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { Button, Card, Field, useColors, useStyles } from "../ui";
import { voiceStore, useVoiceConfig } from "./store";
import { synthesizeSpeech } from "./tts";
import {
  EDGE_TTS_CHINESE_VOICES,
  validateSttConfig,
  validateTtsConfig,
  type MicMode,
  type SttConfig,
  type TtsConfig,
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
    <View style={{ flexDirection: "row", gap: 8 }}>
      {options.map((o) => {
        const active = value === o.id;
        return (
          <Pressable
            key={o.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.id)}
            style={{
              flex: 1,
              padding: 10,
              borderRadius: 10,
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
  const s = useStyles();
  const { tts, loaded } = useVoiceConfig();
  const [draft, setDraft] = useState<TtsConfig | null>(null);
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState("");
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
      setError(t(`voice.${problem}` as Parameters<typeof t>[0]));
      return;
    }
    await voiceStore.setTts(cfg);
    setDraft(null);
  }

  async function onTest() {
    const problem = validateTtsConfig(cfg);
    if (problem) {
      setError(t(`voice.${problem}` as Parameters<typeof t>[0]));
      return;
    }
    setTesting(true);
    setTestMsg("");
    try {
      const uri = await synthesizeSpeech(t("voice.testText"), cfg);
      // Play it back immediately — hearing it IS the test.
      const { createAudioPlayer, setAudioModeAsync } = await import("expo-audio");
      await setAudioModeAsync({ playsInSilentMode: true });
      const player = createAudioPlayer(uri);
      player.play();
      setTestMsg(t("voice.test") + " ✓");
    } catch (e) {
      setTestMsg(e instanceof Error ? e.message : String(e));
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
                    borderRadius: 16,
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
        ) : (
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
        )}
        {!!error && <TText style={{ color: colors.danger }}>{error}</TText>}
        {!!testMsg && <TText style={{ color: colors.muted }}>{testMsg}</TText>}
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
  const s = useStyles();
  const { stt, loaded } = useVoiceConfig();
  const [draft, setDraft] = useState<SttConfig | null>(null);
  const [error, setError] = useState("");
  const cfg = draft ?? stt;
  const dirty = draft !== null;

  function set<K extends keyof SttConfig>(key: K, value: SttConfig[K]) {
    setDraft((d) => ({ ...(d ?? stt), [key]: value }));
    setError("");
  }

  async function onSave() {
    const problem = validateSttConfig(cfg);
    if (problem) {
      setError(t(`voice.${problem}` as Parameters<typeof t>[0]));
      return;
    }
    await voiceStore.setStt(cfg);
    setDraft(null);
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
      {!!error && <TText style={{ color: colors.danger }}>{error}</TText>}
      {dirty && (
        <View style={{ marginTop: 10 }}>
          <Button primary onPress={() => void onSave()}>
            {t("common.save")}
          </Button>
        </View>
      )}
    </Card>
  );
}

function MicModeSection() {
  const colors = useColors();
  const s = useStyles();
  const { settings, loaded } = useVoiceConfig();

  function setMode(m: MicMode) {
    void voiceStore.setSettings({ ...settings, micMode: m });
  }

  if (!loaded) return null;
  const modes: Array<{ id: MicMode; label: string; desc: string }> = [
    { id: "transcribe", label: t("voice.micTranscribe"), desc: t("voice.micTranscribeDesc") },
    { id: "voice-message", label: t("voice.micVoiceMessage"), desc: t("voice.micVoiceMessageDesc") },
  ];
  return (
    <Card>
      <TText style={{ fontWeight: "700", marginBottom: 8 }}>{t("voice.micMode")}</TText>
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
                borderRadius: 10,
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
    </View>
  );
}
