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

import AsyncStorage from "@react-native-async-storage/async-storage";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { Check, ChevronDown, Plus, Trash2, X } from "lucide-react-native";
import { useEffect, useState, type ReactNode } from "react";
import { Alert, Modal, Pressable, ScrollView, Switch, TextInput, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { TText } from "../font";
import { t } from "../i18n";
import { radii } from "../theme/radii";
import { Button, Card, Chip, Field, Sheet, useColors, useStyles } from "../ui";
import { VoiceSettingsSection } from "../voice/voice-settings";
import { blankApiKey, maskKey } from "./api-keys";
import { queryBalance } from "./balance";
import { CapabilitySettingsSection } from "./capability-settings";
import { clearDiagEntries, listDiagEntries, type DiagEntry } from "./diagnostics";
import { resolveAuth, testConnection } from "./direct-transport";
import { classifyError } from "./error-classifier";
import { type ChatMode, CLOUD_MODE_AVAILABLE, useChatMode, useSetChatMode } from "./mode";
import { loadModelSlots, MODEL_SLOT_IDS, saveModelSlots, type ModelSlot, type ModelSlotId } from "./model-slots";
import { modelProfileStore } from "./model-profiles";
import {
  buildAuthorizeUrl,
  exchangeCode,
  newOAuthAccountId,
  OAUTH_PRESETS,
  OAUTH_REDIRECT,
  oauthStore,
  parseOAuthRedirect,
  randomVerifier,
  type OAuthAccount,
  type OAuthProviderPreset,
} from "./oauth";
import { aggregateUsage, loadUsageRecords, type SpendStats } from "./pricing";
import { loadUserGroups, newUserGroupId, saveUserGroups, type UserProviderGroup } from "./provider-groups";
import { decodeShare, encodeShare, payloadToGroup } from "./sharing";
import { speedTestModel, type SpeedTestResult } from "./speed-test";
import { groupStore, useApiGroups } from "./store";
import {
  type ApiGroup,
  type ApiKeyEntry,
  type ApiVendor,
  type KeyRotationStrategy,
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
          // user P2-5 / product P2: cloud backend isn't deployed — a live
          // switch to a dead end is forbidden. Disabled + honest note.
          const disabled = o.id === "cloud" && !CLOUD_MODE_AVAILABLE;
          return (
            <Pressable
              key={o.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: active, disabled }}
              disabled={disabled}
              onPress={() => void setMode(o.id)}
              style={{
                flex: 1,
                padding: 10,
                borderRadius: radii.sm,
                borderWidth: 1,
                borderColor: active ? colors.blueDark : colors.line,
                backgroundColor: active ? colors.sky : colors.card,
                opacity: disabled ? 0.45 : 1,
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
  // P2-12: model names offered by /models after a successful test.
  const [models, setModels] = useState<string[]>([]);
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

  /** Replace the whole draft (used by share-import). Saving afterwards
      creates a new group via the existing onSave flow. */
  function replaceDraft(g: ApiGroup) {
    setDraft(g);
    setVendor(
      g.vendor === "anthropic" || g.vendor === "gemini" ? "custom" : g.vendor,
    );
    setError("");
    setTestResult(null);
    setModels([]);
  }

  async function onTest() {
    const problem = validateGroup(draft);
    if (problem) {
      setError(t(`apigroup.validation.${problem}` as Parameters<typeof t>[0]));
      return;
    }
    setTesting(true);
    setTestResult(null);
    setModels([]);
    try {
      // P2-12: testConnection returns the /models list (Kelivo-style) —
      // offer it as a picker so she never has to hand-type a model name.
      const { models } = await testConnection({
        ...draft,
        baseUrl: normalizeBaseUrl(draft.baseUrl),
      });
      setModels(models);
      setTestResult({ ok: true, text: t("apigroup.testOk") });
    } catch (e) {
      // P2-11: human words by error class, not raw technical English.
      const cls = classifyError(e);
      const key =
        cls === "auth_error"
          ? "apigroup.testFailAuth"
          : cls === "rate_limit"
            ? "apigroup.testFailRate"
            : cls === "network_error"
              ? "apigroup.testFailNetwork"
              : null;
      setTestResult({
        ok: false,
        text: key
          ? (t(key) as string)
          : t("apigroup.testFail", { error: e instanceof Error ? e.message : String(e) }),
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
      // B4: keep the custom provider group whose name matches the group's
      // tag in sync (add to it, remove from the others).
      await syncProviderGroupMembership(draft.id, (draft.userGroup ?? "").trim());
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
      {/* P2-12: pick from the server's /models list instead of hand-typing. */}
      {models.length > 0 && (
        <View style={{ gap: 6 }}>
          <TText style={[s.small, { color: colors.muted }]}>{t("apigroup.pickModel")}</TText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {models.slice(0, 24).map((m) => {
              const selected = m === draft.model;
              return (
                <Pressable
                  key={m}
                  onPress={() => set("model", m)}
                  accessibilityRole="button"
                  accessibilityLabel={m}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: radii.lg,
                    borderWidth: 1,
                    borderColor: selected ? colors.text : colors.line,
                    backgroundColor: selected ? colors.sky : "transparent",
                  }}
                >
                  <TText style={[s.small, { color: colors.text }]} numberOfLines={1}>
                    {m}
                  </TText>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

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

      {/* ---- Batch 2: model/API extras. Each section is self-contained and
          collapsible; the core fields above are untouched. ---- */}
      <UserGroupField draft={draft} set={set} />
      <Field
        label={t("apigroup.userAgent.label")}
        value={draft.userAgent ?? ""}
        onChangeText={(v) => set("userAgent", v || undefined)}
        placeholder={t("apigroup.userAgent.ph")}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Collapsible title={t("apigroup.oauth.title")}>
        <OAuthSection draft={draft} set={set} />
      </Collapsible>
      <Collapsible title={t("apigroup.keys.title")}>
        <KeyPoolSection draft={draft} set={set} />
      </Collapsible>
      <Collapsible title={t("apigroup.balance.title")}>
        <BalanceSection draft={draft} set={set} />
      </Collapsible>
      <Collapsible title={t("apigroup.extras.title")}>
        <ExtrasSection draft={draft} set={set} />
      </Collapsible>
      <Collapsible title={t("apigroup.caching.title")}>
        <CachingSection draft={draft} set={set} />
      </Collapsible>
      <Collapsible title={t("apigroup.sampling.title")}>
        <SamplingSection draft={draft} set={set} />
      </Collapsible>
      <Collapsible title={t("apigroup.azure.title")}>
        <AzureSection draft={draft} set={set} />
      </Collapsible>
      <Collapsible title={t("apigroup.speed.title")}>
        <SpeedSection draft={draft} />
      </Collapsible>
      <Collapsible title={t("apigroup.share.title")}>
        <ShareSection draft={draft} replaceDraft={replaceDraft} />
      </Collapsible>
      <Collapsible title={t("apigroup.diag.title")}>
        <DiagSection draft={draft} />
      </Collapsible>
      <Collapsible title={t("apigroup.usage.title")}>
        <UsageSection />
      </Collapsible>

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
      const { probeCapabilities } = await import("./capability-probe");
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

      <ProviderGroupsCard />

      <ModelSlotsSection />

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
              accessibilityLabel={t("a11y.close")}
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

/* ================= Batch 2 settings sections ================= */

type DraftSetter = <K extends keyof ApiGroup>(key: K, value: ApiGroup[K]) => void;

/** Collapsible wrapper — keeps the long editor scannable. */
function Collapsible({ title, children }: { title: string; children: ReactNode }) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radii.md,
        overflow: "hidden",
        backgroundColor: colors.card,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          padding: 12,
        }}
      >
        <TText style={{ fontWeight: "700" }}>{title}</TText>
        <ChevronDown
          size={16}
          color={colors.muted}
          style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}
        />
      </Pressable>
      {open ? <View style={{ gap: 10, padding: 12, paddingTop: 2 }}>{children}</View> : null}
    </View>
  );
}

/** Numeric input; empty commits null (= vendor default). */
function NumField({
  label,
  value,
  onChange,
  integer,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  integer?: boolean;
}) {
  const s = useStyles();
  const colors = useColors();
  const [text, setText] = useState(value == null ? "" : String(value));
  // Resync when the value is reset from outside (e.g. "use default"),
  // but don't clobber mid-typing ("0." while typing "0.5").
  useEffect(() => {
    const cur = text.trim() === "" ? null : Number(text);
    if (typeof cur === "number" && Number.isNaN(cur)) return;
    if (cur !== (value ?? null)) setText(value == null ? "" : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <View style={{ gap: 4 }}>
      <TText style={[s.small, { fontWeight: "600", color: colors.text }]}>{label}</TText>
      <TextInput
        style={s.input}
        value={text}
        keyboardType={integer ? "number-pad" : "decimal-pad"}
        placeholder={t("apigroup.sampling.reset")}
        placeholderTextColor={colors.muted}
        onChangeText={(v) => {
          setText(v);
          const trimmed = v.trim();
          if (trimmed === "") {
            onChange(null);
            return;
          }
          const n = Number(trimmed);
          if (Number.isFinite(n)) onChange(integer ? Math.round(n) : n);
        }}
      />
    </View>
  );
}

/** B1: OAuth login (ChatGPT / Grok / Kimi / Claude presets). */
function OAuthSection({ draft, set }: { draft: ApiGroup; set: DraftSetter }) {
  const colors = useColors();
  const s = useStyles();
  const [providerId, setProviderId] = useState<OAuthProviderPreset["id"]>("chatgpt");
  const [account, setAccount] = useState<OAuthAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    let live = true;
    if (draft.oauthAccountId) {
      void oauthStore.get(draft.oauthAccountId).then((a) => {
        if (live) setAccount(a);
      });
    } else {
      setAccount(null);
    }
    return () => {
      live = false;
    };
  }, [draft.oauthAccountId]);

  async function onLogin() {
    const preset = OAUTH_PRESETS.find((p) => p.id === providerId);
    if (!preset) return;
    setBusy(true);
    setNote("");
    try {
      // PKCE S256 challenge via expo-crypto (base64url, no padding).
      const verifier = randomVerifier();
      const b64 = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        verifier,
        { encoding: Crypto.CryptoEncoding.BASE64 },
      );
      const challenge = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const state = randomVerifier();
      const result = await WebBrowser.openAuthSessionAsync(
        buildAuthorizeUrl(preset, challenge, state),
        OAUTH_REDIRECT,
      );
      if (result.type !== "success") {
        setNote(t("apigroup.oauth.cancelled"));
        return;
      }
      const parsed = parseOAuthRedirect(result.url, state);
      if ("error" in parsed) throw new Error(parsed.error);
      const tokens = await exchangeCode(preset, parsed.code, verifier);
      const acc: OAuthAccount = {
        id: newOAuthAccountId(),
        providerId: preset.id,
        displayName: preset.displayName,
        email: tokens.email ?? null,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
        createdAt: Date.now(),
      };
      await oauthStore.upsert(acc);
      setAccount(acc);
      set("oauthAccountId", acc.id);
      // Helpful prefill: don't clobber a hand-typed URL.
      if (!draft.baseUrl.trim()) set("baseUrl", preset.baseUrl);
    } catch (e) {
      setNote(t("apigroup.oauth.failed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  }

  function onLogout() {
    if (!account) return;
    Alert.alert(
      t("apigroup.oauth.logout"),
      t("apigroup.oauth.logoutConfirm", { name: account.displayName }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("apigroup.oauth.logout"),
          style: "destructive",
          onPress: () => {
            void oauthStore.remove(account.id).then(() => {
              setAccount(null);
              set("oauthAccountId", undefined);
            });
          },
        },
      ],
    );
  }

  const preset = OAUTH_PRESETS.find((p) => p.id === providerId);
  return (
    <View style={{ gap: 10 }}>
      <TText style={[s.small, { color: colors.muted }]}>{t("apigroup.oauth.desc")}</TText>
      {account ? (
        <View
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
        >
          <TText style={{ fontWeight: "600", flex: 1, marginRight: 8 }} numberOfLines={1}>
            {t("apigroup.oauth.linked", { email: account.email ?? account.displayName })}
          </TText>
          <Button small danger onPress={onLogout}>
            {t("apigroup.oauth.logout")}
          </Button>
        </View>
      ) : (
        <>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {OAUTH_PRESETS.map((p) => {
              const active = p.id === providerId;
              return (
                <Pressable
                  key={p.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  onPress={() => setProviderId(p.id)}
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
                    style={{
                      color: active ? colors.blueDark : colors.text,
                      fontWeight: active ? "600" : "400",
                    }}
                  >
                    {p.displayName}
                  </TText>
                </Pressable>
              );
            })}
          </View>
          <Button busy={busy} onPress={() => void onLogin()}>
            {busy
              ? t("apigroup.oauth.loggingIn")
              : t("apigroup.oauth.login", { name: preset?.displayName ?? "" })}
          </Button>
        </>
      )}
      {note ? <TText style={[s.small, { color: colors.danger }]}>{note}</TText> : null}
      <TText style={[s.small, { color: colors.muted }]}>{t("apigroup.oauth.reNote")}</TText>
    </View>
  );
}

/** B2: key pool with rotation strategies. */
function KeyPoolSection({ draft, set }: { draft: ApiGroup; set: DraftSetter }) {
  const colors = useColors();
  const s = useStyles();
  const keys = draft.apiKeys ?? [];
  const [form, setForm] = useState<{
    id: string | null;
    name: string;
    key: string;
    priority: string;
  } | null>(null);
  const strategies: KeyRotationStrategy[] = ["roundRobin", "priority", "leastUsed", "random"];

  function saveForm() {
    if (!form || !form.key.trim()) return;
    const priority = Math.min(10, Math.max(1, Math.round(Number(form.priority) || 5)));
    if (form.id) {
      set(
        "apiKeys",
        keys.map((k) =>
          k.id === form.id
            ? { ...k, name: form.name.trim(), key: form.key, priority }
            : k,
        ),
      );
    } else {
      const entry: ApiKeyEntry = {
        ...blankApiKey(form.name.trim()),
        key: form.key,
        priority,
      };
      set("apiKeys", [...keys, entry]);
    }
    setForm(null);
  }

  function removeKey(id: string) {
    Alert.alert(t("apigroup.keys.delete"), t("apigroup.keys.deleteConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("apigroup.keys.delete"),
        style: "destructive",
        onPress: () => set("apiKeys", keys.filter((k) => k.id !== id)),
      },
    ]);
  }

  function toggleEnabled(k: ApiKeyEntry) {
    set(
      "apiKeys",
      keys.map((x) => (x.id === k.id ? { ...x, enabled: !x.enabled } : x)),
    );
  }

  const now = Date.now();
  return (
    <View style={{ gap: 10 }}>
      <TText style={[s.small, { color: colors.muted }]}>{t("apigroup.keys.desc")}</TText>
      {keys.map((k) => {
        const until = k.disabledUntil;
        const autoDisabled = until != null && until > now;
        const status = !k.enabled
          ? t("apigroup.keys.statusDisabled")
          : autoDisabled && until != null
            ? t("apigroup.keys.statusAutoDisabled", {
                n: Math.max(1, Math.ceil((until - now) / 60000)),
              })
            : t("apigroup.keys.statusOk");
        return (
          <View
            key={k.id}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              padding: 10,
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: radii.md,
            }}
          >
            <View style={{ flex: 1 }}>
              <TText style={{ fontWeight: "600" }}>
                {k.name || t("apigroup.keys.unnamed")}
              </TText>
              <TText style={[s.small, { color: colors.muted }]}>
                {maskKey(k.key)} · {status}
              </TText>
            </View>
            <Switch value={k.enabled} onValueChange={() => toggleEnabled(k)} />
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                setForm({ id: k.id, name: k.name, key: k.key, priority: String(k.priority) })
              }
              style={{ padding: 6 }}
            >
              <TText style={[s.small, { color: colors.blueDark }]}>
                {t("apigroup.keys.editKey")}
              </TText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("apigroup.keys.delete")}
              onPress={() => removeKey(k.id)}
              style={{ padding: 6 }}
            >
              <Trash2 size={15} color={colors.danger} />
            </Pressable>
          </View>
        );
      })}
      {form ? (
        <View
          style={{
            gap: 8,
            padding: 10,
            borderWidth: 1,
            borderColor: colors.blueDark,
            borderRadius: radii.md,
          }}
        >
          <TextInput
            style={s.input}
            value={form.name}
            onChangeText={(v) => setForm({ ...form, name: v })}
            placeholder={t("apigroup.keys.namePh")}
            placeholderTextColor={colors.muted}
          />
          <TextInput
            style={s.input}
            value={form.key}
            onChangeText={(v) => setForm({ ...form, key: v })}
            placeholder={t("apigroup.keys.keyPh")}
            placeholderTextColor={colors.muted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={s.input}
            value={form.priority}
            onChangeText={(v) => setForm({ ...form, priority: v })}
            placeholder={t("apigroup.keys.priorityLabel")}
            placeholderTextColor={colors.muted}
            keyboardType="number-pad"
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button small primary disabled={!form.key.trim()} onPress={saveForm}>
              {t("apigroup.keys.saveKey")}
            </Button>
            <Button small onPress={() => setForm(null)}>
              {t("common.cancel")}
            </Button>
          </View>
        </View>
      ) : (
        <Button
          small
          icon={Plus}
          onPress={() => setForm({ id: null, name: "", key: "", priority: "5" })}
        >
          {t("apigroup.keys.add")}
        </Button>
      )}
      {keys.length > 0 ? (
        <>
          <TText style={[s.small, { fontWeight: "600" }]}>
            {t("apigroup.keys.rotationLabel")}
          </TText>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {strategies.map((st) => {
              const active = (draft.keyRotation ?? "roundRobin") === st;
              return (
                <Pressable
                  key={st}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  onPress={() => set("keyRotation", st)}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: radii.lg,
                    borderWidth: 1,
                    borderColor: active ? colors.blueDark : colors.line,
                    backgroundColor: active ? colors.sky : colors.card,
                  }}
                >
                  <TText
                    style={[
                      s.small,
                      { color: active ? colors.blueDark : colors.text, fontWeight: active ? "600" : "400" },
                    ]}
                  >
                    {t(`apigroup.keys.rotation.${st}` as Parameters<typeof t>[0])}
                  </TText>
                </Pressable>
              );
            })}
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <NumField
                label={t("apigroup.keys.autoDisableAfter")}
                value={draft.keyAutoDisableAfter ?? null}
                integer
                onChange={(v) => set("keyAutoDisableAfter", v ?? undefined)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <NumField
                label={t("apigroup.keys.recoverMinutes")}
                value={draft.keyRecoverAfterMinutes ?? null}
                integer
                onChange={(v) => set("keyRecoverAfterMinutes", v ?? undefined)}
              />
            </View>
          </View>
        </>
      ) : null}
    </View>
  );
}

/** B3: balance query badge. */
function BalanceSection({ draft, set }: { draft: ApiGroup; set: DraftSetter }) {
  const colors = useColors();
  const s = useStyles();
  const [checking, setChecking] = useState(false);
  const [badge, setBadge] = useState<string | null>(null);
  const [seen, setSeen] = useState(false);
  const cfg = draft.balance;
  const enabled = cfg?.enabled ?? false;

  function setCfg(patch: Partial<NonNullable<ApiGroup["balance"]>>) {
    set("balance", {
      enabled: false,
      apiPath: "",
      resultPath: "",
      ...(cfg ?? {}),
      ...patch,
    });
  }

  async function onCheck() {
    setChecking(true);
    try {
      const auth = await resolveAuth(draft);
      const v = await queryBalance(draft, auth.headers);
      setBadge(v);
      setSeen(true);
    } finally {
      setChecking(false);
    }
  }

  return (
    <View style={{ gap: 10 }}>
      <View
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
      >
        <TText style={{ fontWeight: "600" }}>{t("apigroup.balance.enable")}</TText>
        <Switch value={enabled} onValueChange={(v) => setCfg({ enabled: v })} />
      </View>
      <TText style={[s.small, { color: colors.muted }]}>{t("apigroup.balance.desc")}</TText>
      {enabled ? (
        <>
          <Field
            label={t("apigroup.balance.apiPath")}
            value={cfg?.apiPath ?? ""}
            onChangeText={(v) => setCfg({ apiPath: v })}
            placeholder={t("apigroup.balance.apiPathPh")}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Field
            label={t("apigroup.balance.resultPath")}
            value={cfg?.resultPath ?? ""}
            onChangeText={(v) => setCfg({ resultPath: v })}
            placeholder={t("apigroup.balance.resultPathPh")}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Button small busy={checking} onPress={() => void onCheck()}>
              {t(checking ? "apigroup.balance.checking" : "apigroup.balance.check")}
            </Button>
            {seen ? (
              <TText style={{ fontWeight: "700", fontSize: 16 }}>
                {badge ?? t("apigroup.balance.unknown")}
              </TText>
            ) : null}
          </View>
        </>
      ) : null}
    </View>
  );
}

/** B6: bodyExtras JSON editor — invalid JSON never reaches the draft. */
function ExtrasSection({ draft, set }: { draft: ApiGroup; set: DraftSetter }) {
  const colors = useColors();
  const s = useStyles();
  const [text, setText] = useState(() => JSON.stringify(draft.bodyExtras ?? {}, null, 2));
  const [err, setErr] = useState("");
  useEffect(() => {
    setText(JSON.stringify(draft.bodyExtras ?? {}, null, 2));
    setErr("");
  }, [draft.id]);

  function onChange(v: string) {
    setText(v);
    const trimmed = v.trim();
    if (!trimmed) {
      set("bodyExtras", {});
      setErr("");
      return;
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error(t("apigroup.extras.needObject"));
      }
      set("bodyExtras", parsed as Record<string, unknown>);
      setErr("");
    } catch (e) {
      setErr(t("apigroup.extras.invalid", { error: e instanceof Error ? e.message : String(e) }));
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <TText style={[s.small, { color: colors.muted }]}>{t("apigroup.extras.desc")}</TText>
      <TextInput
        style={[s.input, { minHeight: 110, textAlignVertical: "top" }]}
        value={text}
        onChangeText={onChange}
        placeholder={t("apigroup.extras.ph")}
        placeholderTextColor={colors.muted}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
      />
      {err ? <TText style={[s.small, { color: colors.danger }]}>{err}</TText> : null}
    </View>
  );
}

/** B7: prompt caching toggle. */
function CachingSection({ draft, set }: { draft: ApiGroup; set: DraftSetter }) {
  const colors = useColors();
  const s = useStyles();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <View style={{ flex: 1, marginRight: 12 }}>
        <TText style={{ fontWeight: "600" }}>{t("apigroup.caching.title")}</TText>
        <TText style={[s.small, { color: colors.muted, marginTop: 2 }]}>
          {t("apigroup.caching.desc")}
        </TText>
      </View>
      <Switch
        value={draft.caching?.enabled ?? false}
        onValueChange={(v) => set("caching", { enabled: v })}
      />
    </View>
  );
}

/** B11: sampling parameters; null = vendor default (not sent). */
function SamplingSection({ draft, set }: { draft: ApiGroup; set: DraftSetter }) {
  const colors = useColors();
  const s = useStyles();
  const cur: NonNullable<ApiGroup["sampling"]> = {
    temperature: null,
    topP: null,
    maxTokens: null,
    ...draft.sampling,
  };
  function patch(p: Partial<NonNullable<ApiGroup["sampling"]>>) {
    set("sampling", { ...cur, ...p });
  }
  return (
    <View style={{ gap: 10 }}>
      <TText style={[s.small, { color: colors.muted }]}>{t("apigroup.sampling.desc")}</TText>
      <NumField
        label={t("apigroup.sampling.temperature")}
        value={cur.temperature ?? null}
        onChange={(v) => patch({ temperature: v })}
      />
      <NumField
        label={t("apigroup.sampling.topP")}
        value={cur.topP ?? null}
        onChange={(v) => patch({ topP: v })}
      />
      <NumField
        label={t("apigroup.sampling.maxTokens")}
        value={cur.maxTokens ?? null}
        integer
        onChange={(v) => patch({ maxTokens: v })}
      />
    </View>
  );
}

/** B14: Azure OpenAI mode. */
function AzureSection({ draft, set }: { draft: ApiGroup; set: DraftSetter }) {
  const colors = useColors();
  const s = useStyles();
  const az = draft.azure;
  const enabled = az?.enabled ?? false;
  return (
    <View style={{ gap: 10 }}>
      <View
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
      >
        <TText style={{ fontWeight: "600" }}>{t("apigroup.azure.enable")}</TText>
        <Switch
          value={enabled}
          onValueChange={(v) =>
            set("azure", {
              enabled: v,
              deploymentUrl: az?.deploymentUrl ?? "",
              apiVersion: az?.apiVersion ?? "",
            })
          }
        />
      </View>
      <TText style={[s.small, { color: colors.muted }]}>{t("apigroup.azure.desc")}</TText>
      {enabled ? (
        <>
          <Field
            label={t("apigroup.azure.deploymentUrl")}
            value={az?.deploymentUrl ?? ""}
            onChangeText={(v) =>
              set("azure", { enabled: true, deploymentUrl: v, apiVersion: az?.apiVersion ?? "" })
            }
            placeholder={t("apigroup.azure.deploymentUrlPh")}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Field
            label={t("apigroup.azure.apiVersion")}
            value={az?.apiVersion ?? ""}
            onChangeText={(v) =>
              set("azure", { enabled: true, deploymentUrl: az?.deploymentUrl ?? "", apiVersion: v })
            }
            placeholder={t("apigroup.azure.apiVersionPh")}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </>
      ) : null}
    </View>
  );
}

/** B16: speed test probe. */
function SpeedSection({ draft }: { draft: ApiGroup }) {
  const colors = useColors();
  const s = useStyles();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SpeedTestResult | null>(null);
  const canRun = draft.model.trim().length > 0 && draft.baseUrl.trim().length > 0;

  async function onRun() {
    setRunning(true);
    try {
      setResult(await speedTestModel(draft));
    } finally {
      setRunning(false);
    }
  }

  return (
    <View style={{ gap: 10 }}>
      <Button small busy={running} disabled={!canRun} onPress={() => void onRun()}>
        {t(running ? "apigroup.speed.testing" : "apigroup.speed.test")}
      </Button>
      {result ? (
        result.ok ? (
          <View style={{ gap: 4 }}>
            <TText style={{ fontWeight: "600" }}>
              {t("apigroup.speed.ttfb")}: {result.ttfbMs ?? t("apigroup.balance.unknown")}ms ·{" "}
              {t("apigroup.speed.total")}: {result.totalMs ?? t("apigroup.balance.unknown")}ms
            </TText>
            {result.preview ? (
              <TText style={[s.small, { color: colors.muted }]} numberOfLines={3}>
                {t("apigroup.speed.preview")}: {result.preview}
              </TText>
            ) : null}
          </View>
        ) : (
          <TText style={{ color: colors.danger }}>
            {t("apigroup.speed.fail", { error: result.error ?? "" })}
          </TText>
        )
      ) : null}
    </View>
  );
}

/** B12: share via QR / import via scan or paste. */
function ShareSection({
  draft,
  replaceDraft,
}: {
  draft: ApiGroup;
  replaceDraft: (g: ApiGroup) => void;
}) {
  const colors = useColors();
  const s = useStyles();
  const [includeKeys, setIncludeKeys] = useState(false);
  const [qrText, setQrText] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [note, setNote] = useState("");

  function doImport(text: string) {
    const payload = decodeShare(text);
    if (!payload) {
      setNote(t("apigroup.share.invalid"));
      return;
    }
    // Opens as a new draft; she saves through the existing onSave flow.
    replaceDraft(payloadToGroup(payload));
    setNote(t("apigroup.share.imported"));
    setScanOpen(false);
  }

  return (
    <View style={{ gap: 10 }}>
      <TText style={[s.small, { color: colors.muted }]}>{t("apigroup.share.desc")}</TText>
      <View
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
      >
        <TText style={{ fontWeight: "600" }}>{t("apigroup.share.withKeys")}</TText>
        <Switch value={includeKeys} onValueChange={setIncludeKeys} />
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button small onPress={() => setQrText(encodeShare(draft, includeKeys))}>
            {t("apigroup.share.qr")}
          </Button>
        </View>
        <View style={{ flex: 1 }}>
          <Button
            small
            onPress={() => {
              setNote("");
              setScanOpen(true);
            }}
          >
            {t("apigroup.share.scan")}
          </Button>
        </View>
      </View>
      {note ? <TText style={[s.small, { color: colors.muted }]}>{note}</TText> : null}

      {qrText !== null ? (
        <Sheet title={t("apigroup.share.qr")} onClose={() => setQrText(null)}>
          <View style={{ gap: 12, alignItems: "center", paddingVertical: 8 }}>
            <QRCode value={qrText} size={220} />
            {includeKeys ? (
              <TText style={[s.small, { color: colors.danger, textAlign: "center" }]}>
                {t("apigroup.share.keyWarning")}
              </TText>
            ) : null}
          </View>
        </Sheet>
      ) : null}

      {scanOpen ? (
        <ScanSheet
          onClose={() => setScanOpen(false)}
          onImport={doImport}
        />
      ) : null}
    </View>
  );
}

function ScanSheet({ onClose, onImport }: { onClose: () => void; onImport: (t: string) => void }) {
  const colors = useColors();
  const s = useStyles();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [paste, setPaste] = useState("");

  if (!permission) {
    return (
      <Sheet title={t("apigroup.share.scan")} onClose={onClose}>
        <View style={{ padding: 20 }}>
          <TText style={{ color: colors.muted }}>{t("common.loading")}</TText>
        </View>
      </Sheet>
    );
  }
  if (!permission.granted) {
    return (
      <Sheet title={t("apigroup.share.scan")} onClose={onClose}>
        <View style={{ gap: 12, paddingVertical: 8 }}>
          <TText style={{ color: colors.text }}>{t("apigroup.share.cameraDenied")}</TText>
          <Button primary onPress={() => void requestPermission()}>
            {t("apigroup.share.scan")}
          </Button>
        </View>
      </Sheet>
    );
  }
  return (
    <Sheet title={t("apigroup.share.scan")} onClose={onClose}>
      <View style={{ gap: 12, paddingVertical: 4 }}>
        <View style={{ borderRadius: radii.lg, overflow: "hidden" }}>
          <CameraView
            style={{ height: 300 }}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={(e) => {
              if (scanned) return;
              setScanned(true);
              onImport(e.data);
            }}
          />
        </View>
        <TextInput
          style={[s.input, { minHeight: 80, textAlignVertical: "top" }]}
          value={paste}
          onChangeText={setPaste}
          placeholder={t("apigroup.share.pastePh")}
          placeholderTextColor={colors.muted}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button small disabled={!paste.trim()} onPress={() => onImport(paste)}>
          {t("apigroup.share.import")}
        </Button>
      </View>
    </Sheet>
  );
}

/** B8: diagnostic log viewer (entries are sanitized at log time). */
function DiagSection({ draft }: { draft: ApiGroup }) {
  const colors = useColors();
  const s = useStyles();
  const [entries, setEntries] = useState<DiagEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const all = await listDiagEntries();
      setEntries(all.filter((e) => e.groupId === draft.id).slice(-50).reverse());
    } finally {
      setLoading(false);
    }
  }

  function onClear() {
    Alert.alert(t("apigroup.diag.clear"), t("apigroup.diag.clearConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("apigroup.diag.clear"),
        style: "destructive",
        onPress: () => {
          void clearDiagEntries().then(() => setEntries([]));
        },
      },
    ]);
  }

  return (
    <View style={{ gap: 10 }}>
      <TText style={[s.small, { color: colors.muted }]}>{t("apigroup.diag.desc")}</TText>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button small busy={loading} onPress={() => void load()}>
          {t("apigroup.diag.view")}
        </Button>
        {entries && entries.length > 0 ? (
          <Button small danger onPress={onClear}>
            {t("apigroup.diag.clear")}
          </Button>
        ) : null}
      </View>
      {entries ? (
        entries.length === 0 ? (
          <TText style={[s.small, { color: colors.muted }]}>{t("apigroup.diag.empty")}</TText>
        ) : (
          entries.map((e) => (
            <View
              key={e.id}
              style={{
                padding: 8,
                borderWidth: 1,
                borderColor: colors.line,
                borderRadius: radii.sm,
                gap: 2,
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <TText style={[s.small, { fontWeight: "700" }]}>{e.kind}</TText>
                <TText
                  style={[
                    s.small,
                    {
                      color: e.response.ok ? colors.blueDark : colors.danger,
                      fontWeight: "700",
                    },
                  ]}
                >
                  {e.response.ok ? t("apigroup.diag.ok") : t("apigroup.diag.fail")}
                </TText>
              </View>
              <TText style={[s.small, { color: colors.muted }]} numberOfLines={1}>
                {e.request.url}
              </TText>
              <TText style={[s.small, { color: colors.muted }]}>
                {e.request.model} · {e.response.ms}ms
                {e.response.status ? ` · ${e.response.status}` : ""}
              </TText>
              {e.response.error ? (
                <TText style={[s.small, { color: colors.danger }]} numberOfLines={2}>
                  {e.response.error}
                </TText>
              ) : null}
            </View>
          ))
        )
      ) : null}
    </View>
  );
}

/** B9: usage ledger (estimated cost from the price table). */
function UsageSection() {
  const colors = useColors();
  const s = useStyles();
  const [stats, setStats] = useState<SpendStats | null>(null);

  async function load() {
    const recs = await loadUsageRecords();
    setStats(aggregateUsage(recs, 0));
  }

  useEffect(() => {
    void load();
  }, []);

  function onClear() {
    Alert.alert(t("apigroup.usage.clear"), t("apigroup.usage.clearConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("apigroup.usage.clear"),
        style: "destructive",
        // pricing.ts exposes no clear; the doc is plain AsyncStorage JSON.
        onPress: () => {
          void AsyncStorage.removeItem("dudu.usage.v1").then(() => void load());
        },
      },
    ]);
  }

  const requestCount = stats ? stats.byModel.reduce((a, b) => a + b.requests, 0) : 0;
  return (
    <View style={{ gap: 10 }}>
      <TText style={[s.small, { color: colors.muted }]}>{t("apigroup.usage.desc")}</TText>
      {stats ? (
        stats.totalUsd === 0 && stats.byModel.length === 0 ? (
          <TText style={[s.small, { color: colors.muted }]}>{t("apigroup.usage.empty")}</TText>
        ) : (
          <View style={{ gap: 6 }}>
            <TText style={{ fontWeight: "700" }}>
              {t("apigroup.usage.total")}: ${stats.totalUsd.toFixed(4)}
            </TText>
            <TText style={[s.small, { color: colors.muted }]}>
              {t("apigroup.usage.tokens")}: {stats.totalInput + stats.totalOutput} ·{" "}
              {t("apigroup.usage.requests")}: {requestCount}
            </TText>
            {stats.byModel.map((m) => (
              <View key={m.model} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <TText style={[s.small, { flex: 1, marginRight: 8 }]} numberOfLines={1}>
                  {m.model} × {m.requests}
                </TText>
                <TText style={s.small}>${m.usd.toFixed(4)}</TText>
              </View>
            ))}
            <Button small danger onPress={onClear}>
              {t("apigroup.usage.clear")}
            </Button>
          </View>
        )
      ) : null}
    </View>
  );
}

/** B4: per-group tag + quick-pick from her custom groups. */
function UserGroupField({ draft, set }: { draft: ApiGroup; set: DraftSetter }) {
  const colors = useColors();
  const s = useStyles();
  const [tags, setTags] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void loadUserGroups().then((ugs) => {
      if (live) setTags(ugs.map((u) => u.name));
    });
    return () => {
      live = false;
    };
  }, []);
  return (
    <View style={{ gap: 6 }}>
      <Field
        label={t("apigroup.usergroup.label")}
        value={draft.userGroup ?? ""}
        onChangeText={(v) => set("userGroup", v || undefined)}
        placeholder={t("apigroup.usergroup.ph")}
      />
      {tags.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {tags.map((tag) => {
            const active = draft.userGroup === tag;
            return (
              <Pressable
                key={tag}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                onPress={() => set("userGroup", active ? undefined : tag)}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: radii.lg,
                  borderWidth: 1,
                  borderColor: active ? colors.blueDark : colors.line,
                  backgroundColor: active ? colors.sky : colors.card,
                }}
              >
                <TText style={[s.small, { color: active ? colors.blueDark : colors.text }]}>
                  {tag}
                </TText>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/** B4: keep the custom group matching the group's tag in sync on save. */
async function syncProviderGroupMembership(groupId: string, tag: string): Promise<void> {
  try {
    const ugs = await loadUserGroups();
    let changed = false;
    const next = ugs.map((ug) => {
      const has = ug.groupIds.includes(groupId);
      const want = tag !== "" && ug.name === tag;
      if (has === want) return ug;
      changed = true;
      return {
        ...ug,
        groupIds: want ? [...ug.groupIds, groupId] : ug.groupIds.filter((id) => id !== groupId),
      };
    });
    if (changed) await saveUserGroups(next);
  } catch {
    // Non-fatal: the tag itself is already saved on the group.
  }
}

/** B4: her own custom provider groups (create/delete), on the main screen. */
function ProviderGroupsCard() {
  const colors = useColors();
  const s = useStyles();
  const [ugs, setUgs] = useState<UserProviderGroup[]>([]);
  const [name, setName] = useState("");

  useEffect(() => {
    let live = true;
    void loadUserGroups().then((g) => {
      if (live) setUgs(g);
    });
    return () => {
      live = false;
    };
  }, []);

  async function onAdd() {
    const n = name.trim();
    if (!n) return;
    const next: UserProviderGroup[] = [
      ...ugs,
      { id: newUserGroupId(), name: n, groupIds: [], createdAt: Date.now() },
    ];
    await saveUserGroups(next);
    setUgs(next);
    setName("");
  }

  function onDelete(ug: UserProviderGroup) {
    Alert.alert(
      t("apigroup.pgroups.delete"),
      t("apigroup.pgroups.deleteConfirm", { name: ug.name }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("apigroup.pgroups.delete"),
          style: "destructive",
          onPress: () => {
            const next = ugs.filter((u) => u.id !== ug.id);
            void saveUserGroups(next).then(() => setUgs(next));
          },
        },
      ],
    );
  }

  return (
    <Card>
      <View style={{ gap: 10 }}>
        <TText style={{ fontWeight: "700" }}>{t("apigroup.pgroups.title")}</TText>
        <TText style={[s.small, { color: colors.muted }]}>{t("apigroup.pgroups.desc")}</TText>
        {ugs.length === 0 ? (
          <TText style={[s.small, { color: colors.muted }]}>
            {t("apigroup.pgroups.empty")}
          </TText>
        ) : (
          ugs.map((ug) => (
            <View
              key={ug.id}
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <View style={{ flex: 1 }}>
                <TText style={{ fontWeight: "600" }}>{ug.name}</TText>
                <TText style={[s.small, { color: colors.muted }]}>
                  {t("apigroup.pgroups.members", { n: ug.groupIds.length })}
                </TText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("apigroup.pgroups.delete")}
                onPress={() => onDelete(ug)}
                style={{ padding: 8 }}
              >
                <Trash2 size={15} color={colors.danger} />
              </Pressable>
            </View>
          ))
        )}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput
            style={[s.input, { flex: 1 }]}
            value={name}
            onChangeText={setName}
            placeholder={t("apigroup.pgroups.namePh")}
            placeholderTextColor={colors.muted}
          />
          <Button small primary disabled={!name.trim()} onPress={() => void onAdd()}>
            {t("apigroup.pgroups.add")}
          </Button>
        </View>
      </View>
    </Card>
  );
}

/** B13: per-purpose model slots (global, not per-group) — on the main screen. */
function ModelSlotsSection() {
  const colors = useColors();
  const s = useStyles();
  const [slots, setSlots] = useState<Record<ModelSlotId, ModelSlot> | null>(null);
  const [savedTick, setSavedTick] = useState(false);

  useEffect(() => {
    let live = true;
    void loadModelSlots().then((loaded) => {
      if (live) setSlots(loaded);
    });
    return () => {
      live = false;
    };
  }, []);

  async function onSave() {
    if (!slots) return;
    await saveModelSlots(slots);
    setSavedTick(true);
    setTimeout(() => setSavedTick(false), 2000);
  }

  if (!slots) return null;
  return (
    <Card>
      <View style={{ gap: 10 }}>
        <TText style={{ fontWeight: "700" }}>{t("apigroup.slots.title")}</TText>
        <TText style={[s.small, { color: colors.muted }]}>{t("apigroup.slots.desc")}</TText>
        {MODEL_SLOT_IDS.map((id) => (
          <View key={id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <TText style={[s.small, { fontWeight: "600", width: 76 }]}>
              {t(`apigroup.slot.${id}` as Parameters<typeof t>[0])}
            </TText>
            <TextInput
              style={[s.input, { flex: 1 }]}
              value={slots[id].model ?? ""}
              onChangeText={(v) =>
                setSlots({ ...slots, [id]: { ...slots[id], model: v.trim() ? v : null } })
              }
              placeholder={t("apigroup.slots.modelPh")}
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        ))}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Button small primary onPress={() => void onSave()}>
            {t("apigroup.slots.save")}
          </Button>
          {savedTick ? (
            <TText style={[s.small, { color: colors.blueDark }]}>
              {t("apigroup.slots.saved")}
            </TText>
          ) : null}
        </View>
      </View>
    </Card>
  );
}
