/**
 * Together-days milestone celebrations — management UI for Our Space.
 * Master toggle + the visible list of milestones (celebrated / pending /
 * skipped / upcoming). Pending celebrations can be cancelled here — off
 * means silent, cancelled never comes back.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, Pressable, Switch, View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { cancelInitiativeSchedule, initiativeStore } from "../initiative/instances";
import { ourSpaceStore } from "../our-space/instance";
import { daysTogether, resolveTogetherSince } from "../our-space/together";
import { radii } from "../theme/radii";
import { Card, useColors, useStyles } from "../ui";
import { runMilestoneTick } from "./instances";
import {
  loadMilestoneCelebrationsEnabled,
  loadMilestoneLedger,
  type MilestoneLedger,
  milestoneId,
  saveMilestoneCelebrationsEnabled,
  saveMilestoneLedger,
  TOGETHER_MILESTONE_DAYS,
} from "./milestones";

type RowStatus = "celebrated" | "pending" | "skipped" | "upcoming";

const EMPTY_LEDGER: MilestoneLedger = { celebrated: [], skipped: [], pending: {} };

export function MilestoneSection() {
  const colors = useColors();
  const s = useStyles();
  const [enabled, setEnabled] = useState(true);
  const [ledger, setLedger] = useState<MilestoneLedger>(EMPTY_LEDGER);
  const [days, setDays] = useState<number | null>(null);
  const [hasDate, setHasDate] = useState(false);

  const refresh = () => {
    void (async () => {
      try {
        const [en, lg, p, anniversaries] = await Promise.all([
          loadMilestoneCelebrationsEnabled(AsyncStorage).catch(() => true),
          loadMilestoneLedger(AsyncStorage).catch(() => EMPTY_LEDGER),
          ourSpaceStore.getCoupleProfile().catch(() => null),
          ourSpaceStore.listAnniversaries().catch(() => []),
        ]);
        setEnabled(en);
        setLedger(lg);
        const since = resolveTogetherSince(p, anniversaries);
        setHasDate(since !== null);
        setDays(daysTogether(since, new Date()));
      } catch {
        // ignore — refresh shows the truth
      }
    })();
  };

  useEffect(() => {
    refresh();
  }, []);

  const toggle = (on: boolean) => {
    setEnabled(on);
    void (async () => {
      try {
        await saveMilestoneCelebrationsEnabled(AsyncStorage, on);
        if (!on) {
          const lg = await loadMilestoneLedger(AsyncStorage);
          for (const ruleId of Object.values(lg.pending)) {
            await cancelInitiativeSchedule(ruleId).catch(() => {});
            await initiativeStore.setStatus(ruleId, "archived").catch(() => {});
          }
          await saveMilestoneLedger(AsyncStorage, { ...lg, pending: {} });
        } else {
          // Turning back on: run a tick so a due milestone isn't missed.
          await runMilestoneTick().catch(() => {});
        }
      } catch {
        // ignore — refresh shows the truth
      } finally {
        refresh();
      }
    })();
  };

  const doCancel = (d: number) =>
    Alert.alert(
      t("space.milestone.cancelTitle") as string,
      t("space.milestone.days", { n: d }) as string,
      [
        { text: t("common.cancel") as string, style: "cancel" },
        {
          text: t("common.delete") as string,
          style: "destructive",
          onPress: () =>
            void (async () => {
              try {
                const lg = await loadMilestoneLedger(AsyncStorage);
                const id = milestoneId(d);
                const ruleId = lg.pending[id];
                if (ruleId) {
                  await cancelInitiativeSchedule(ruleId).catch(() => {});
                  await initiativeStore.setStatus(ruleId, "archived").catch(() => {});
                  delete lg.pending[id];
                }
                if (!lg.skipped.includes(id) && !lg.celebrated.includes(id)) {
                  lg.skipped.push(id);
                }
                await saveMilestoneLedger(AsyncStorage, lg);
              } catch {
                // ignore
              } finally {
                refresh();
              }
            })(),
        },
      ],
    );

  const rowStatus = (d: number): RowStatus => {
    const id = milestoneId(d);
    if (ledger.celebrated.includes(id)) return "celebrated";
    if (ledger.pending[id]) return "pending";
    if (ledger.skipped.includes(id)) return "skipped";
    return "upcoming";
  };

  const statusKey = {
    celebrated: "space.milestone.status.celebrated",
    pending: "space.milestone.status.pending",
    skipped: "space.milestone.status.skipped",
    upcoming: "space.milestone.status.upcoming",
  } as const;

  return (
    <Card>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <View style={{ flex: 1 }}>
          <TText style={{ fontWeight: "700", fontSize: 16 }}>{t("space.milestone.title")}</TText>
          <TText style={[s.small, { color: colors.muted, marginTop: 4 }]}>
            {hasDate && days !== null
              ? (t("space.milestone.descWithDays", { n: days }) as string)
              : (t("space.milestone.descNoDate") as string)}
          </TText>
        </View>
        <Switch value={enabled} onValueChange={toggle} />
      </View>

      <View style={{ marginTop: 8, gap: 4 }}>
        {TOGETHER_MILESTONE_DAYS.map((d) => {
          const st = rowStatus(d);
          return (
            <View
              key={d}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingVertical: 8,
                borderBottomWidth: 1,
                borderBottomColor: colors.line,
              }}
            >
              <View style={{ flex: 1 }}>
                <TText style={{ fontSize: 14, fontWeight: "600" }}>
                  {t("space.milestone.days", { n: d })}
                </TText>
                <TText style={[s.small, { color: colors.muted, marginTop: 2 }]}>
                  {t(statusKey[st])}
                </TText>
              </View>
              {st === "pending" && (
                <Pressable
                  accessibilityLabel={t("common.delete") as string}
                  onPress={() => doCancel(d)}
                  style={{ padding: 8, borderRadius: radii.sm }}
                >
                  <Trash2 size={16} color={colors.muted} />
                </Pressable>
              )}
            </View>
          );
        })}
      </View>
    </Card>
  );
}
