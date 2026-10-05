/**
 * Batch 7 I15 — config audit view.
 *
 * "看最终生效的配置" — one page showing the resolved, effective
 * configuration for debugging ("我查问题用"). Reads the real stores;
 * secrets are never shown (key pool shows a count, URLs are host-only).
 * Copy button exports the same view as JSON.
 */

import * as Clipboard from "expo-clipboard";
import { Check, Copy } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useApiGroups } from "../api-groups/store";
import { useFontSizeSetting } from "../app-settings";
import { TText } from "../font";
import { getLocale, t } from "../i18n";
import { useTheme } from "../theme/ThemeContext";
import { Button, Card, SectionHeading, useColors, useStyles } from "../ui";
import { useVoiceConfig } from "../voice/store";
import { type ExtrasPrefs, getExtrasPrefs } from "./prefs";

interface AuditRow {
  label: string;
  value: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function boolLabel(v: boolean): string {
  return v ? t("extras.audit.on") : t("extras.audit.off");
}

export function ConfigAuditPage() {
  const colors = useColors();
  const s = useStyles();
  const { active } = useApiGroups();
  const { tts } = useVoiceConfig();
  const { bundle } = useTheme();
  const { option: fontSize } = useFontSizeSetting();
  const [personaName, setPersonaName] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const prefs: ExtrasPrefs = getExtrasPrefs();

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { createPersonaStore } = await import("../persona/store");
        const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
        const store = createPersonaStore(AsyncStorage);
        const id = await store.getActiveId();
        if (!alive) return;
        if (!id) {
          setPersonaName(t("extras.audit.none"));
          return;
        }
        const p = await store.get(id);
        if (alive) setPersonaName(p?.name ?? id);
      } catch {
        if (alive) setPersonaName(t("extras.audit.unknown"));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const sampling = active?.sampling;
  const rows: AuditRow[] = [
    {
      label: t("extras.audit.appVersion"),
      // package.json version (@dudu/mobile). Read statically to avoid a
      // native-module dependency for one string.
      value: "0.1.0",
    },
    { label: t("extras.audit.locale"), value: getLocale() },
    {
      label: t("extras.audit.apiGroup"),
      value: active ? active.name : t("extras.audit.none"),
    },
    {
      label: t("extras.audit.model"),
      value: active ? active.model : t("extras.audit.none"),
    },
    {
      label: t("extras.audit.endpoint"),
      value: active ? hostOf(active.baseUrl) : t("extras.audit.none"),
    },
    {
      label: t("extras.audit.sampling"),
      value: !active
        ? t("extras.audit.none")
        : sampling &&
            (sampling.temperature != null || sampling.topP != null || sampling.maxTokens != null)
          ? [
              sampling.temperature != null ? `T=${sampling.temperature}` : null,
              sampling.topP != null ? `topP=${sampling.topP}` : null,
              sampling.maxTokens != null ? `max=${sampling.maxTokens}` : null,
            ]
              .filter(Boolean)
              .join(" ")
          : t("extras.audit.default"),
    },
    {
      label: t("extras.audit.toolsMode"),
      value: active ? (active.toolsMode ?? "auto") : t("extras.audit.none"),
    },
    {
      label: t("extras.audit.thinkingMode"),
      value: active ? (active.thinkingMode ?? "auto") : t("extras.audit.none"),
    },
    {
      label: t("extras.audit.keyPool"),
      value: !active
        ? t("extras.audit.none")
        : active.oauthAccountId
          ? t("extras.audit.oauth")
          : `${active.apiKeys?.length ?? (active.apiKey ? 1 : 0)}`,
    },
    {
      label: t("extras.audit.tts"),
      value: `${tts.provider} / ${tts.voice}${tts.rate && tts.rate !== 1 ? ` ×${tts.rate}` : ""}`,
    },
    { label: t("extras.audit.themeMode"), value: bundle.mode },
    { label: t("extras.audit.fontSize"), value: fontSize },
    { label: t("extras.audit.persona"), value: personaName ?? t("common.loading") },
    { label: t("extras.audit.enterToSend"), value: boolLabel(prefs.enterToSendMobile) },
    { label: t("extras.audit.keepAwake"), value: boolLabel(prefs.keepScreenOnWhileGenerating) },
    { label: t("extras.audit.haptics"), value: boolLabel(prefs.hapticsEnabled) },
    { label: t("extras.audit.autoScroll"), value: boolLabel(prefs.autoScroll) },
    {
      label: t("extras.audit.markdown"),
      value: [
        prefs.markdownUser ? "user" : null,
        prefs.markdownAssistant ? "assistant" : null,
        prefs.markdownReasoning ? "reasoning" : null,
      ]
        .filter(Boolean)
        .join("+"),
    },
  ];

  const copyJson = () => {
    const obj: Record<string, string> = {};
    for (const r of rows) obj[r.label] = r.value;
    void Clipboard.setStringAsync(JSON.stringify(obj, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <View style={{ gap: 12 }}>
      <SectionHeading title={t("extras.audit.title")} />
      <Card style={{ gap: 0 }}>
        {rows.map((r, i) => (
          <View
            key={r.label}
            style={{
              flexDirection: "row",
              paddingVertical: 9,
              borderBottomWidth: i < rows.length - 1 ? 1 : 0,
              borderBottomColor: colors.line,
              gap: 12,
            }}
          >
            <TText style={[s.small, { color: colors.muted, width: 110 }]}>{r.label}</TText>
            <TText style={{ flex: 1, color: colors.text, fontSize: 14 }} selectable>
              {r.value}
            </TText>
          </View>
        ))}
      </Card>
      <Button small icon={copied ? Check : Copy} onPress={copyJson}>
        {copied ? t("extras.scan.copied") : t("extras.audit.copyJson")}
      </Button>
    </View>
  );
}
