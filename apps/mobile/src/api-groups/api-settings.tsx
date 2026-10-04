/**
 * API settings screen: dual-mode switch + API groups CRUD.
 *
 * - Mode switch (local/cloud) at the top — the user controls both.
 * - Group list: tap to activate, edit affordance per row.
 * - Add/edit sheet: Kelivo-style vendor tabs (OpenAI / Anthropic / Google /
 *   Custom) that prefill the form, name / base URL / key / model fields,
 *   optional custom headers, per-group test-connection button.
 *
 * Keys live in SecureStore (see ./store.ts) — this screen never persists
 * them anywhere else and never logs them.
 */

import { Check, Plus, Trash2, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Switch, TextInput, View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { radii } from "../theme/radii";
import { Button, Card, Chip, Field, useColors, useStyles } from "../ui";
import { VoiceSettingsSection } from "../voice/voice-settings";
import { CapabilitySettingsSection } from "./capability-settings";
import { testConnection } from "./direct-transport";
import { type ChatMode, useChatMode, useSetChatMode } from "./mode";
import { modelProfileStore } from "./model-profiles";
import { groupStore, useApiGroups } from "./store";
import {
  type ApiGroup,
  type ApiVendor,
  blankGroup,
  normalizeBaseUrl,
  VENDOR_PRESETS,
  validateGroup,
} from "./types";

function ModeSwitch() {
  const mode = useChatMode();
  const setMode = useSetChatMode();
  const colors = useColors();
  const s = useStyles();
  const options: { id: ChatMode; label: string; desc: string }[] = [
    { id: "local", label: t("chatmode.local"), desc: t("chatmode.localDesc") },
    { id: "cloud", label: t("chatmode.cloud"), desc: t("chatmode.cloudDesc") },
  ];
  return (
    <Card>
      <TText style={[s.small, { fontWeight: "700", marginBottom: 8 }]}>{t("chatmode.title")}</TText>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {options.map((o) => {
          const active = mode === o.id;
          return (
            <Pressable
              key={o.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              onPress={() => void setMode(o.id)}
              style={{
                flex: 1,
                padding: 10,
                borderRadius: radii.sm,
                borderWidth: 1,
                borderColor: active ? colors.blueDark : colors.line,
                backgroundColor: active ? colors.sky : colors.card,
              }}
            >
              <TText style={{ fontWeight: "700", color: active ? colors.blueDark : colors.text }}>
                {o.label}
              </TText>
              <TText style={[s.small, { color: colors.muted, marginTop: 2 }]}>{o.desc}</TText>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

function GroupEditor({ initial, onClose }: { initial: ApiGroup | null; onClose: () => void }) {
  const colors = useColors();
  const s = useStyles();
  // Legacy stored vendors ("anthropic"/"gemini") have no tab anymore (P1-7:
  // native formats unsupported) — show them as "custom". Vendor is metadata
  // only; the transport is always OpenAI-compatible.
  const initialVendor: ApiVendor =
    initial?.vendor === "anthropic" || initial?.vendor === "gemini"
      ? "custom"
      : (initial?.vendor ?? "openai");
  const [vendor, setVendor] = useState<ApiVendor>(initialVendor);
  const [draft, setDraft] = useState<ApiGroup>(() => initial ?? blankGroup("openai"));
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function pickVendor(v: ApiVendor) {
    setVendor(v);
    const preset = VENDOR_PRESETS.find((p) => p.vendor === v);
    if (!preset) return;
    setDraft((d) => {
      // Don't clobber a hand-typed URL: only refill when the field is empty
      // or still holds some other preset's URL (P3).
      const cur = d.baseUrl.trim();
      const isPreset = VENDOR_PRESETS.some((p) => p.baseUrl === cur);
      return isPreset || !cur ? { ...d, vendor: v, baseUrl: preset.baseUrl } : { ...d, vendor: v };
    });
  }

  function set<K extends keyof ApiGroup>(key: K, value: ApiGroup[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setError("");
    setTestResult(null);
  }

  async function onTest() {
    const problem = validateGroup(draft);
    if (problem) {
      setError(t(`apigroup.validation.${problem}` as Parameters<typeof t>[0]));
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      await testConnection({ ...draft, baseUrl: normalizeBaseUrl(draft.baseUrl) });
      setTestResult({ ok: true, text: t("apigroup.testOk") });
    } catch (e) {
      setTestResult({
        ok: false,
        text: t("apigroup.testFail", { error: e instanceof Error ? e.message : String(e) }),
      });
    } finally {
      setTesting(false);
    }
  }

  async function onSave() {
    const problem = validateGroup(draft);
    if (problem) {
      setError(t(`apigroup.validation.${problem}` as Parameters<typeof t>[0]));
      return;
    }
    setBusy(true);
    try {
      await groupStore.upsert({
        ...draft,
        baseUrl: normalizeBaseUrl(draft.baseUrl),
        name: draft.name.trim(),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    Alert.alert(t("apigroup.delete"), t("apigroup.deleteConfirm", { name: draft.name }), [
      {
        text: t("common.cancel"),
        style: "cancel",
      },
      {
        text: t("apigroup.delete"),
        style: "destructive",
        onPress: () => {
          setBusy(true);
          void groupStore
            .remove(draft.id)
            .then(() => onClose())
            .finally(() => setBusy(false));
        },
      },
    ]);
  }

  const headerEntries = Object.entries(draft.headers);
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
        {VENDOR_PRESETS.map((p) => {
          const active = vendor === p.vendor;
          return (
            <Pressable
              key={p.vendor}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => pickVendor(p.vendor)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: radii.lg,
                borderWidth: 1,
                borderColor: active ? colors.blueDark : colors.line,
                backgroundColor: active ? colors.sky : colors.card,
              }}
            >
              <TText style={{ color: active ? colors.blueDark : colors.text, fontWeight: "600" }}>
                {t(`apigroup.vendor.${p.vendor}` as Parameters<typeof t>[0])}
              </TText>
            </Pressable>
          );
        })}
      </View>

      <Field
        label={t("apigroup.name")}
        value={draft.name}
        onChangeText={(v) => set("name", v)}
        placeholder={t("apigroup.namePh")}
      />
      <Field
        label={t("apigroup.baseUrl")}
        value={draft.baseUrl}
        onChangeText={(v) => set("baseUrl", v)}
        placeholder={t("apigroup.baseUrlPh")}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Field
        label={t("apigroup.apiKey")}
        value={draft.apiKey ?? ""}
        onChangeText={(v) => set("apiKey", v)}
        placeholder={t("apigroup.apiKeyPh")}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Field
        label={t("apigroup.model")}
        value={draft.model}
        onChangeText={(v) => set("model", v)}
        placeholder={t("apigroup.modelPh")}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <TText style={[s.small, { fontWeight: "600" }]}>{t("vision.title")}</TText>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingVertical: 4,
        }}
      >
        <View style={{ flex: 1, marginRight: 12 }}>
          <TText style={{ fontWeight: "600" }}>{t("vision.native")}</TText>
          <TText style={[s.small, { color: colors.muted, marginTop: 2 }]}>
            {t("vision.nativeDesc")}
          </TText>
        </View>
        <Switch
          value={draft.vision?.native ?? false}
          onValueChange={(v) => set("vision", { native: v, model: draft.vision?.model })}
        />
      </View>
      <Field
        label={t("vision.model")}
        value={draft.vision?.model ?? ""}
        onChangeText={(v) =>
          set("vision", { native: draft.vision?.native ?? false, model: v || undefined })
        }
        placeholder={draft.model || t("vision.modelDesc")}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <TText style={[s.small, { fontWeight: "600" }]}>{t("apigroup.capabilities")}</TText>
      <CapabilitySection draft={draft} set={set} />

      <TText style={[s.small, { fontWeight: "600" }]}>{t("apigroup.headers")}</TText>
      {headerEntries.map(([k, v]) => (
        <View key={k} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <TextInput
            value={k}
            editable={false}
            style={[s.input, { flex: 1, color: colors.muted }]}
          />
          <TextInput
            value={v}
            onChangeText={(nv) => set("headers", { ...draft.headers, [k]: nv })}
            placeholder={t("apigroup.headerValuePh")}
            style={[s.input, { flex: 2 }]}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("apigroup.delete")}
            onPress={() => {
              const next = { ...draft.headers };
              delete next[k];
              set("headers", next);
            }}
            style={{ padding: 8 }}
          >
            <X size={16} color={colors.muted} />
          </Pressable>
        </View>
      ))}
      <HeaderAdder
        onAdd={(k) => set("headers", { ...draft.headers, [k]: "" })}
        taken={new Set(headerEntries.map(([k]) => k))}
      />

      {error ? <TText style={{ color: colors.danger }}>{error}</TText> : null}
      {testResult ? (
        <TText style={{ color: testResult.ok ? colors.blueDark : colors.danger }}>
          {testResult.text}
        </TText>
      ) : null}

      <Button onPress={() => void onTest()} busy={testing}>
        {t("apigroup.test")}
      </Button>
      <Button primary onPress={() => void onSave()} busy={busy}>
        {t("apigroup.save")}
      </Button>
      {initial ? (
        <Button danger onPress={() => void onDelete()} busy={busy} icon={Trash2}>
          {t("apigroup.delete")}
        </Button>
      ) : null}
    </ScrollView>
  );
}

function HeaderAdder({ onAdd, taken }: { onAdd: (k: string) => void; taken: Set<string> }) {
  const colors = useColors();
  const s = useStyles();
  const [key, setKey] = useState("");
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <TextInput
        value={key}
        onChangeText={setKey}
        placeholder={t("apigroup.headerKeyPh")}
        placeholderTextColor={colors.muted}
        style={[s.input, { flex: 1 }]}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Button
        small
        disabled={!key.trim() || taken.has(key.trim())}
        onPress={() => {
          onAdd(key.trim());
          setKey("");
        }}
      >
        {t("apigroup.addHeader")}
      </Button>
    </View>
  );
}

/** Three-state segmented control: auto / on / off. */
function TriSwitch({
  label,
  value,
  onChange,
  labels,
}: {
  label: string;
  value: "auto" | "on" | "off";
  onChange: (v: "auto" | "on" | "off") => void;
  labels: { auto: string; on: string; off: string };
}) {
  const colors = useColors();
  const order: Array<"auto" | "on" | "off"> = ["auto", "on", "off"];
  return (
    <View style={{ gap: 6 }}>
      <TText style={{ fontWeight: "600" }}>{label}</TText>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {order.map((v) => {
          const active = value === v;
          return (
            <Pressable
              key={v}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              onPress={() => onChange(v)}
              style={{
                flex: 1,
                paddingVertical: 8,
                borderRadius: radii.md,
                borderWidth: 1,
                borderColor: active ? colors.blueDark : colors.line,
                backgroundColor: active ? colors.sky : colors.card,
                alignItems: "center",
              }}
            >
              <TText
                style={{
                  color: active ? colors.blueDark : colors.text,
                  fontWeight: active ? "600" : "400",
                  fontSize: 13,
                }}
              >
                {labels[v]}
              </TText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Capability detection + manual overrides + learned-profile reset. */
function CapabilitySection({
  draft,
  set,
}: {
  draft: ApiGroup;
  set: <K extends keyof ApiGroup>(key: K, value: ApiGroup[K]) => void;
}) {
  const colors = useColors();
  const s = useStyles();
  const [probing, setProbing] = useState(false);
  const [caps, setCaps] = useState<{ tools: string; thinking: string } | null>(null);
  const [profileNote, setProfileNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void modelProfileStore
      .getProfile(draft.baseUrl, draft.model)
      .then((p) => {
        if (live) setProfileNote(p.note || null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [draft.baseUrl, draft.model]);

  async function onProbe() {
    if (!draft.baseUrl.trim() || !draft.model.trim()) return;
    setProbing(true);
    setCaps(null);
    try {
      const { probeCapabilities } = await import("./capability-probe.js");
      const c = await probeCapabilities(
        { ...draft, baseUrl: draft.baseUrl.trim().replace(/\/+$/, "") },
        fetch as never,
      );
      setCaps({
        tools: t(`apigroup.cap.tools${capKey(c.tools)}` as Parameters<typeof t>[0]),
        thinking: t(`apigroup.cap.thinking${capKey(c.thinking)}` as Parameters<typeof t>[0]),
      });
    } catch {
      setCaps(null);
    } finally {
      setProbing(false);
    }
  }

  async function onResetProfile() {
    await modelProfileStore.resetProfile(draft.baseUrl, draft.model).catch(() => {});
    setProfileNote(null);
  }

  return (
    <View style={{ gap: 10 }}>
      <TriSwitch
        label={t("apigroup.toolsMode")}
        value={draft.toolsMode ?? "auto"}
        onChange={(v) => set("toolsMode", v === "auto" ? undefined : v)}
        labels={{
          auto: t("apigroup.toolsMode.auto"),
          on: t("apigroup.toolsMode.on"),
          off: t("apigroup.toolsMode.off"),
        }}
      />
      <TriSwitch
        label={t("apigroup.thinkingMode")}
        value={draft.thinkingMode ?? "auto"}
        onChange={(v) => set("thinkingMode", v === "auto" ? undefined : v)}
        labels={{
          auto: t("apigroup.thinkingMode.auto"),
          on: t("apigroup.thinkingMode.on"),
          off: t("apigroup.thinkingMode.off"),
        }}
      />
      {caps ? (
        <TText style={[s.small, { color: colors.muted }]}>
          {caps.tools} · {caps.thinking}
        </TText>
      ) : null}
      {profileNote ? (
        <TText style={[s.small, { color: colors.muted }]}>
          {t("apigroup.profileNote")}：{profileNote}
        </TText>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button small busy={probing} onPress={() => void onProbe()}>
          {t(probing ? "apigroup.cap.probing" : "apigroup.cap.probe")}
        </Button>
        {profileNote ? (
          <Button small onPress={() => void onResetProfile()}>
            {t("apigroup.profileReset")}
          </Button>
        ) : null}
      </View>
    </View>
  );
}

function capKey(c: string): string {
  return c === "supported" ? "Yes" : c === "unsupported" ? "No" : "Unknown";
}

export function ApiSettingsScreen() {
  const colors = useColors();
  const s = useStyles();
  const { groups, activeId, loaded } = useApiGroups();
  const [editing, setEditing] = useState<ApiGroup | null | "new">(null);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <TText style={{ fontSize: 22, fontWeight: "700" }}>{t("apigroup.title")}</TText>
      <TText style={[s.small, { color: colors.muted }]}>{t("apigroup.subtitle")}</TText>

      <ModeSwitch />

      {/* Capability-grouped model routing (orchestration feature 1):
          one "分组" interface — input groups route, output groups back tools. */}
      <CapabilitySettingsSection />

      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <TText style={[s.small, { fontWeight: "700" }]}>
          {t("apigroup.title")} ({groups.length})
        </TText>
        <Button small icon={Plus} onPress={() => setEditing("new")}>
          {t("apigroup.add")}
        </Button>
      </View>

      {!loaded ? null : groups.length === 0 ? (
        <Card>
          <TText style={{ color: colors.muted }}>{t("apigroup.empty")}</TText>
        </Card>
      ) : (
        groups.map((g) => {
          const active = g.id === activeId;
          return (
            <Pressable
              key={g.id}
              onPress={() => void groupStore.setActive(g.id)}
              style={{
                padding: 12,
                borderRadius: radii.sm,
                borderWidth: 1,
                borderColor: active ? colors.blueDark : colors.line,
                backgroundColor: colors.card,
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
              }}
            >
              <View style={{ flex: 1 }}>
                <TText style={{ fontWeight: "700" }}>{g.name}</TText>
                <TText style={[s.small, { color: colors.muted }]}>{g.model}</TText>
              </View>
              {active ? <Check size={18} color={colors.blueDark} /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("apigroup.edit")}
                onPress={() => setEditing(g)}
                style={{ padding: 8 }}
              >
                <TText style={{ color: colors.blueDark }}>{t("apigroup.edit")}</TText>
              </Pressable>
            </Pressable>
          );
        })
      )}

      <VoiceSettingsSection />

      <Modal
        visible={editing !== null}
        animationType="slide"
        onRequestClose={() => setEditing(null)}
      >
        <View style={{ flex: 1, backgroundColor: colors.canvas, paddingTop: 48 }}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              paddingHorizontal: 16,
            }}
          >
            <TText style={{ fontSize: 18, fontWeight: "700" }}>
              {editing === "new" ? t("apigroup.add") : t("apigroup.edit")}
            </TText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={() => setEditing(null)}
              style={{ padding: 8 }}
            >
              <X size={20} color={colors.text} />
            </Pressable>
          </View>
          {editing !== null ? (
            <GroupEditor
              initial={editing === "new" ? null : editing}
              onClose={() => setEditing(null)}
            />
          ) : null}
        </View>
      </Modal>
    </ScrollView>
  );
}

/** Compact "she can see what the AI is doing" indicator for the chat header. */
export function ActiveGroupChip() {
  const { active } = useApiGroups();
  const mode = useChatMode();
  const s = useStyles();
  if (mode !== "local" || !active) return null;
  return (
    <Chip>
      <TText style={s.small}>
        {t("chat.activeGroup", { name: active.name, model: active.model })}
      </TText>
    </Chip>
  );
}
