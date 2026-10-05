/**
 * Batch 7 I3 — usage stats page.
 *
 * Aligned with Kelivo's stats page (lib/features/stats, researched
 * 2026-10-05): heatmap + metric grid + model/group ranking over date-range
 * presets. Data comes from the real usage ledger (api-groups/pricing.ts,
 * B9 — recordUsage is already called per completed request in
 * direct-transport.ts), aggregated here. No fake numbers: an empty ledger
 * shows an honest empty state.
 */

import { BarChart3 } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { loadUsageRecords, type UsageRecord } from "../api-groups/pricing";
import { TText } from "../font";
import { t } from "../i18n";
import { Card, Empty, useColors, useStyles } from "../ui";
import { hapticTap } from "./haptics";
import {
  formatTokens,
  formatUsd,
  rangeEndMs,
  rangeStartMs,
  type StatsRange,
  type StatsSummary,
  summarizeUsage,
} from "./stats";

export type { StatsRange, StatsSummary };

/** GitHub-style heatmap of daily request counts, last 16 weeks. */
function Heatmap({ byDay, now }: { byDay: StatsSummary["byDay"]; now: number }) {
  const colors = useColors();
  const weeks = useMemo(() => {
    const days: Array<{ key: string; count: number }> = [];
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    // Align to Monday-start weeks.
    const start = new Date(today);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - 7 * 15);
    for (let i = 0; i < 16 * 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      if (d.getTime() > today.getTime()) break;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      days.push({ key, count: byDay.get(key)?.requests ?? 0 });
    }
    const out: Array<Array<{ key: string; count: number }>> = [];
    for (let w = 0; w < 16; w++) out.push(days.slice(w * 7, w * 7 + 7));
    return out;
  }, [byDay, now]);
  const max = Math.max(1, ...weeks.flat().map((d) => d.count));
  return (
    <View style={{ flexDirection: "row", gap: 3, justifyContent: "space-between" }}>
      {weeks.map((week) => {
        const weekKey = week[0]?.key ?? `w${week.length}`;
        return (
          <View key={weekKey} style={{ gap: 3, flex: 1 }}>
            {week.map((d) => {
              const intensity = d.count === 0 ? 0 : 0.25 + 0.75 * (d.count / max);
              return (
                <View
                  key={d.key}
                  style={{
                    aspectRatio: 1,
                    borderRadius: 3,
                    backgroundColor: d.count === 0 ? colors.line : colors.blueDark,
                    opacity: d.count === 0 ? 0.5 : intensity,
                  }}
                />
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={{ flex: 1, gap: 2, alignItems: "center", paddingVertical: 8 }}>
      <TText style={{ fontSize: 20, fontWeight: "700", color: colors.text }}>{value}</TText>
      <TText style={{ fontSize: 12, color: colors.muted }}>{label}</TText>
    </View>
  );
}

const RANGES: StatsRange[] = ["30d", "month", "all"];

export function StatsPage() {
  const colors = useColors();
  const s = useStyles();
  const [records, setRecords] = useState<UsageRecord[] | null>(null);
  const [range, setRange] = useState<StatsRange>("30d");
  const now = useMemo(() => Date.now(), []);
  useEffect(() => {
    let alive = true;
    void loadUsageRecords().then((r) => {
      if (alive) setRecords(r);
    });
    return () => {
      alive = false;
    };
  }, []);
  const summary = useMemo(
    () =>
      records ? summarizeUsage(records, rangeStartMs(range, now), rangeEndMs(range, now)) : null,
    [records, range, now],
  );

  if (!records || !summary) {
    return (
      <View style={{ paddingVertical: 40, alignItems: "center" }}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }
  if (records.length === 0) {
    return (
      <Empty
        icon={BarChart3}
        title={t("extras.stats.emptyTitle")}
        detail={t("extras.stats.emptyDetail")}
      />
    );
  }
  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {RANGES.map((r) => {
          const selected = r === range;
          return (
            <Pressable
              key={r}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => {
                hapticTap();
                setRange(r);
              }}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 999,
                backgroundColor: selected ? colors.text : colors.card,
              }}
            >
              <TText style={{ color: selected ? colors.canvas : colors.text, fontSize: 13 }}>
                {t(`extras.stats.range.${r}`)}
              </TText>
            </Pressable>
          );
        })}
      </View>

      <Card>
        <View style={{ flexDirection: "row" }}>
          <Metric label={t("extras.stats.spend")} value={formatUsd(summary.totalUsd)} />
          <Metric label={t("extras.stats.tokens")} value={formatTokens(summary.totalTokens)} />
        </View>
        <View style={{ flexDirection: "row" }}>
          <Metric label={t("extras.stats.requests")} value={`${summary.requests}`} />
          <Metric label={t("extras.stats.activeDays")} value={`${summary.activeDays}`} />
        </View>
      </Card>

      <View style={{ gap: 8 }}>
        <TText style={s.heading}>{t("extras.stats.heatmap")}</TText>
        <Card>
          <Heatmap byDay={summary.byDay} now={now} />
        </Card>
      </View>

      {summary.byModel.length > 0 && (
        <View style={{ gap: 8 }}>
          <TText style={s.heading}>{t("extras.stats.byModel")}</TText>
          <Card style={{ gap: 0 }}>
            {summary.byModel.slice(0, 8).map((m, i) => (
              <View
                key={m.model}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingVertical: 10,
                  borderBottomWidth: i < Math.min(8, summary.byModel.length) - 1 ? 1 : 0,
                  borderBottomColor: colors.line,
                  gap: 8,
                }}
              >
                <TText style={{ width: 22, color: colors.muted, fontSize: 13 }}>{i + 1}</TText>
                <TText style={{ flex: 1, color: colors.text, fontSize: 14 }} numberOfLines={1}>
                  {m.model}
                </TText>
                <TText style={{ color: colors.muted, fontSize: 12 }}>
                  {m.requests}
                  {t("extras.stats.reqUnit")} · {formatTokens(m.tokens)}
                </TText>
                <TText style={{ color: colors.text, fontSize: 14, fontWeight: "600" }}>
                  {formatUsd(m.usd)}
                </TText>
              </View>
            ))}
          </Card>
        </View>
      )}

      {summary.byGroup.length > 1 && (
        <View style={{ gap: 8 }}>
          <TText style={s.heading}>{t("extras.stats.byGroup")}</TText>
          <Card style={{ gap: 0 }}>
            {summary.byGroup.map((g, i) => (
              <View
                key={g.groupId}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingVertical: 10,
                  borderBottomWidth: i < summary.byGroup.length - 1 ? 1 : 0,
                  borderBottomColor: colors.line,
                }}
              >
                <TText style={{ flex: 1, color: colors.text, fontSize: 14 }} numberOfLines={1}>
                  {g.groupName}
                </TText>
                <TText style={{ color: colors.text, fontSize: 14, fontWeight: "600" }}>
                  {formatUsd(g.usd)}
                </TText>
              </View>
            ))}
          </Card>
        </View>
      )}
    </View>
  );
}
