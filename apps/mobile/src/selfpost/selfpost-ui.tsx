/**
 * AI self-post trigger （自发帖触发器） — management UI for Our Space.
 * Toggle, slot count, daily cap, today's slots, and the "AI 今天想发没发"
 * decision log. Sits next to the initiative section — same "AI reaches
 * her" family, separate budget.
 */

import { useEffect, useState } from "react";
import { Pressable, Switch, View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { radii } from "../theme/radii";
import { Card, useColors, useStyles } from "../ui";
import { fireSelfpostSlot } from "./executor";
import { buildSelfpostDeps, selfpostStore } from "./instances";
import { checkDueSelfpostSlots } from "./scheduler";
import { SELFPOST_SLOT_COUNT_MAX, SELFPOST_SLOT_COUNT_MIN, selfpostSlotsToday } from "./slots";
import {
  SELFPOST_DAILY_CAP_MAX,
  SELFPOST_DAILY_CAP_MIN,
  type SelfpostConfig,
  type SelfpostLogEntry,
} from "./store";

function reasonLabel(reason: string): string {
  const key = `selfpost.reason.${reason}`;
  const label = t(key as never);
  return label === key ? reason : label;
}

function fmtTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function Stepper({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
}) {
  const colors = useColors();
  const btn = {
    width: 32,
    height: 32,
    borderRadius: radii.md,
    backgroundColor: colors.secondaryBg,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <TText style={{ flex: 1 }}>{label}</TText>
      <Pressable
        accessibilityLabel={`${label}-minus`}
        onPress={() => onChange(Math.max(min, value - 1))}
        style={btn}
      >
        <TText>−</TText>
      </Pressable>
      <TText style={{ minWidth: 24, textAlign: "center" }}>{value}</TText>
      <Pressable
        accessibilityLabel={`${label}-plus`}
        onPress={() => onChange(Math.min(max, value + 1))}
        style={btn}
      >
        <TText>+</TText>
      </Pressable>
    </View>
  );
}

export function SelfpostSection() {
  const colors = useColors();
  const s = useStyles();
  const [config, setConfig] = useState<SelfpostConfig | null>(null);
  const [postsToday, setPostsToday] = useState(0);
  const [log, setLog] = useState<SelfpostLogEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    void selfpostStore
      .getConfig()
      .then(setConfig)
      .catch(() => {});
    void selfpostStore
      .countSendsToday(Date.now())
      .then(setPostsToday)
      .catch(() => {});
    void selfpostStore
      .listLog(10)
      .then(setLog)
      .catch(() => {});
  };

  useEffect(() => {
    refresh();
  }, []);

  const update = (patch: Partial<SelfpostConfig>) => {
    void selfpostStore
      .setConfig(patch)
      .then((c) => setConfig(c))
      .catch(() => {});
  };

  const postNow = () => {
    if (busy) return;
    setBusy(true);
    void buildSelfpostDeps({ isIncognito: () => false })
      .then((deps) => fireSelfpostSlot(deps, { index: -1, atMs: Date.now(), label: "manual" }))
      .then(() => refresh())
      .catch(() => {})
      .finally(() => setBusy(false));
  };

  // Also give the quiet-slot sweep a nudge when she opens this section —
  // the foreground tick is the real driver; this is just a friendly poke.
  const checkNow = () => {
    void buildSelfpostDeps({ isIncognito: () => false })
      .then((deps) => checkDueSelfpostSlots(deps))
      .then(() => refresh())
      .catch(() => {});
  };

  if (!config) return null;
  const now = Date.now();
  const slots = selfpostSlotsToday(config.slotCount, now);

  return (
    <Card style={s.card}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <TText style={{ fontWeight: "700", fontSize: 16 }}>{t("selfpost.section.title")}</TText>
        <View style={{ flex: 1 }} />
        <Switch
          accessibilityLabel={t("selfpost.section.toggle")}
          value={config.enabled}
          onValueChange={(v) => update({ enabled: v })}
        />
      </View>
      <TText style={{ color: colors.muted, marginTop: 4 }}>{t("selfpost.section.desc")}</TText>

      {config.enabled && (
        <View style={{ gap: 8, marginTop: 12 }}>
          <Stepper
            label={t("selfpost.section.slots")}
            value={config.slotCount}
            min={SELFPOST_SLOT_COUNT_MIN}
            max={SELFPOST_SLOT_COUNT_MAX}
            onChange={(v) => update({ slotCount: v })}
          />
          <Stepper
            label={t("selfpost.section.cap")}
            value={config.dailyCap}
            min={SELFPOST_DAILY_CAP_MIN}
            max={SELFPOST_DAILY_CAP_MAX}
            onChange={(v) => update({ dailyCap: v })}
          />
          <TText style={{ color: colors.muted }}>
            {t("selfpost.section.today", {
              posts: postsToday,
              cap: config.dailyCap,
              slots: slots.map((x) => fmtTime(x.atMs)).join("、"),
            })}
          </TText>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              accessibilityLabel={t("selfpost.section.postNow")}
              onPress={postNow}
              disabled={busy}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 14,
                borderRadius: radii.md,
                backgroundColor: colors.secondaryBg,
              }}
            >
              <TText>{t("selfpost.section.postNow")}</TText>
            </Pressable>
            <Pressable
              accessibilityLabel={t("selfpost.section.checkNow")}
              onPress={checkNow}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 14,
                borderRadius: radii.md,
                backgroundColor: colors.secondaryBg,
              }}
            >
              <TText>{t("selfpost.section.checkNow")}</TText>
            </Pressable>
          </View>
        </View>
      )}

      {log.length > 0 && (
        <View style={{ gap: 6, marginTop: 12 }}>
          <TText style={{ color: colors.muted }}>{t("selfpost.section.logTitle")}</TText>
          {log.map((e) => (
            <TText key={`${e.at}-${e.slotIndex}`} style={{ color: colors.muted }}>
              {fmtTime(e.at)} ·{" "}
              {e.outcome === "posted"
                ? t("selfpost.section.logPosted", { text: e.textPreview ?? "" })
                : t("selfpost.section.logSkipped", { reason: reasonLabel(e.reason) })}
            </TText>
          ))}
        </View>
      )}
    </Card>
  );
}
