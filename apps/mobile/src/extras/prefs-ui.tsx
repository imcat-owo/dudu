/**
 * Batch 7 — settings UI for the small chat/display features.
 *
 * ChatComfortSection: the toggles (I6/I7/I8/I9/I10/I11/I12/I13/I14) plus
 * entry buttons for the stats page (I3), translate page (I1), QR scan (I4)
 * and config audit (I15). VoiceOver (I5) is automatic — it gets an info
 * row, not a toggle.
 */

import { BarChart3, FileSearch, Languages, Minus, Plus, QrCode } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Switch, View } from "react-native";
import { useApiGroups } from "../api-groups/store";
import { TText } from "../font";
import { t } from "../i18n";
import { Card, SectionHeading, Sheet, useColors } from "../ui";
import { ConfigAuditPage } from "./config-audit-ui";
import { hapticTap } from "./haptics";
import { type ExtrasPrefs, setExtrasPref, useExtrasPrefs } from "./prefs";
import { QrScanSheet } from "./qr-scan-ui";
import { StatsPage } from "./stats-ui";
import { TranslatePage } from "./translate-ui";

function PrefToggle<K extends keyof ExtrasPrefs>({
  prefKey,
  title,
  detail,
  disabled,
}: {
  prefKey: K;
  title: string;
  detail?: string;
  disabled?: boolean;
}) {
  const colors = useColors();
  const { prefs } = useExtrasPrefs();
  const value = prefs[prefKey];
  if (typeof value !== "boolean") return null;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 10,
        gap: 12,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <TText style={{ color: colors.text, fontSize: 15 }}>{title}</TText>
        {!!detail && <TText style={{ color: colors.muted, fontSize: 13 }}>{detail}</TText>}
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={(v) => {
          hapticTap();
          void setExtrasPref(prefKey, v as ExtrasPrefs[K]);
        }}
      />
    </View>
  );
}

function Stepper({
  title,
  detail,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  title: string;
  detail?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  const colors = useColors();
  const btn = (icon: React.ReactNode, delta: number, disabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={() => {
        hapticTap();
        onChange(Math.min(max, Math.max(min, value + delta)));
      }}
      style={{
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: colors.card,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {icon}
    </Pressable>
  );
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 12 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <TText style={{ color: colors.text, fontSize: 15 }}>{title}</TText>
        {!!detail && <TText style={{ color: colors.muted, fontSize: 13 }}>{detail}</TText>}
      </View>
      {btn(<Minus size={15} color={colors.text} />, -step, value <= min)}
      <TText style={{ color: colors.text, fontSize: 15, minWidth: 64, textAlign: "center" }}>
        {value}
        {unit}
      </TText>
      {btn(<Plus size={15} color={colors.text} />, step, value >= max)}
    </View>
  );
}

function PageButton({
  icon,
  title,
  detail,
  onOpen,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  onOpen: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        hapticTap();
        onOpen();
      }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 12,
        gap: 12,
      }}
    >
      {icon}
      <View style={{ flex: 1, gap: 2 }}>
        <TText style={{ color: colors.text, fontSize: 15 }}>{title}</TText>
        <TText style={{ color: colors.muted, fontSize: 13 }}>{detail}</TText>
      </View>
      <TText style={{ color: colors.muted, fontSize: 16 }}>›</TText>
    </Pressable>
  );
}

export function ChatComfortSection() {
  const colors = useColors();
  const { prefs } = useExtrasPrefs();
  const { active } = useApiGroups();
  const [page, setPage] = useState<"stats" | "translate" | "scan" | "audit" | null>(null);

  return (
    <View>
      <SectionHeading title={t("extras.sectionTitle")} />
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        <PageButton
          icon={<BarChart3 size={18} color={colors.text} />}
          title={t("extras.stats.title")}
          detail={t("extras.stats.intro")}
          onOpen={() => setPage("stats")}
        />
        <PageButton
          icon={<Languages size={18} color={colors.text} />}
          title={t("extras.translate.title")}
          detail={t("extras.translate.intro")}
          onOpen={() => setPage("translate")}
        />
        <PageButton
          icon={<QrCode size={18} color={colors.text} />}
          title={t("extras.scan.title")}
          detail={t("extras.scan.intro")}
          onOpen={() => setPage("scan")}
        />
        <PageButton
          icon={<FileSearch size={18} color={colors.text} />}
          title={t("extras.audit.title")}
          detail={t("extras.audit.intro")}
          onOpen={() => setPage("audit")}
        />
      </Card>

      <View style={{ height: 14 }} />
      <SectionHeading title={t("extras.composerTitle")} />
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        <PrefToggle
          prefKey="enterToSendMobile"
          title={t("extras.enterToSend.title")}
          detail={t("extras.enterToSend.detail")}
        />
        <PrefToggle
          prefKey="draftTokenCount"
          title={t("extras.draftTokens.title")}
          detail={t("extras.draftTokens.detail")}
        />
      </Card>

      <View style={{ height: 14 }} />
      <SectionHeading title={t("extras.displayTitle")} />
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        <PrefToggle
          prefKey="showModelName"
          title={t("extras.showModelName.title")}
          detail={t("extras.showModelName.detail")}
        />
        <PrefToggle
          prefKey="showTimestamp"
          title={t("extras.showTimestamp.title")}
          detail={t("extras.showTimestamp.detail")}
        />
        <PrefToggle
          prefKey="showAvatars"
          title={t("extras.showAvatars.title")}
          detail={t("extras.showAvatars.detail")}
        />
        <PrefToggle
          prefKey="autoScroll"
          title={t("extras.autoScroll.title")}
          detail={t("extras.autoScroll.detail")}
        />
        {prefs.autoScroll && (
          <Stepper
            title={t("extras.autoScrollIdle.title")}
            detail={t("extras.autoScrollIdle.detail")}
            value={prefs.autoScrollIdleSeconds}
            min={1}
            max={120}
            step={1}
            unit={t("extras.unitSeconds")}
            onChange={(v) => void setExtrasPref("autoScrollIdleSeconds", v)}
          />
        )}
        <PrefToggle
          prefKey="collapseLongUserMessages"
          title={t("extras.collapse.title")}
          detail={t("extras.collapse.detail")}
        />
        {prefs.collapseLongUserMessages && (
          <Stepper
            title={t("extras.collapseChars.title")}
            detail={t("extras.collapseChars.detail")}
            value={prefs.collapseThresholdChars}
            min={50}
            max={100000}
            step={50}
            unit={t("extras.unitChars")}
            onChange={(v) => void setExtrasPref("collapseThresholdChars", v)}
          />
        )}
      </Card>

      <View style={{ height: 14 }} />
      <SectionHeading title={t("extras.markdownTitle")} />
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        <PrefToggle prefKey="markdownUser" title={t("extras.markdownUser.title")} />
        <PrefToggle prefKey="markdownAssistant" title={t("extras.markdownAssistant.title")} />
        <PrefToggle prefKey="markdownReasoning" title={t("extras.markdownReasoning.title")} />
      </Card>

      <View style={{ height: 14 }} />
      <SectionHeading title={t("extras.behaviorTitle")} />
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        <PrefToggle
          prefKey="newChatOnLaunch"
          title={t("extras.newChatLaunch.title")}
          detail={t("extras.newChatLaunch.detail")}
        />
        <PrefToggle
          prefKey="newChatOnPersonaSwitch"
          title={t("extras.newChatPersona.title")}
          detail={t("extras.newChatPersona.detail")}
        />
        <PrefToggle
          prefKey="newChatAfterDelete"
          title={t("extras.newChatDelete.title")}
          detail={t("extras.newChatDelete.detail")}
        />
        <PrefToggle
          prefKey="keepScreenOnWhileGenerating"
          title={t("extras.keepAwake.title")}
          detail={t("extras.keepAwake.detail")}
        />
      </Card>

      <View style={{ height: 14 }} />
      <SectionHeading title={t("extras.feelTitle")} />
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        <PrefToggle
          prefKey="hapticsEnabled"
          title={t("extras.haptics.title")}
          detail={t("extras.haptics.detail")}
        />
        <PrefToggle
          prefKey="hapticsOnSend"
          title={t("extras.hapticsSend.title")}
          disabled={!prefs.hapticsEnabled}
        />
        <PrefToggle
          prefKey="hapticsOnReceive"
          title={t("extras.hapticsReceive.title")}
          disabled={!prefs.hapticsEnabled}
        />
      </Card>

      <View style={{ height: 14 }} />
      <Card>
        <TText style={{ color: colors.muted, fontSize: 13 }}>{t("extras.voiceoverNote")}</TText>
      </Card>

      {page === "stats" && (
        <Sheet title={t("extras.stats.title")} onClose={() => setPage(null)}>
          <StatsPage />
        </Sheet>
      )}
      {page === "translate" && (
        <Sheet title={t("extras.translate.title")} onClose={() => setPage(null)}>
          <TranslatePage group={active} />
        </Sheet>
      )}
      {page === "scan" && <QrScanSheet onClose={() => setPage(null)} />}
      {page === "audit" && (
        <Sheet title={t("extras.audit.title")} onClose={() => setPage(null)}>
          <ConfigAuditPage />
        </Sheet>
      )}
    </View>
  );
}
