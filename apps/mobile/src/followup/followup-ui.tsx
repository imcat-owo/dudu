/**
 * Memory-driven next-day follow-up （次日跟进） — management UI for Our Space.
 * Master toggle + the visible list of tracked items (what, event date,
 * follow-up time), each deletable. Nothing fires secretly: everything the
 * AI is tracking shows up here.
 */

import { Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, Pressable, Switch, View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { cancelInitiativeSchedule, initiativeStore } from "../initiative/instances";
import { radii } from "../theme/radii";
import { Card, useColors, useStyles } from "../ui";
import { followupStore } from "./instances";
import type { FollowupItem } from "./store";

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function FollowupSection() {
  const colors = useColors();
  const s = useStyles();
  const [items, setItems] = useState<FollowupItem[]>([]);
  const [enabled, setEnabled] = useState(true);

  const refresh = () => {
    void followupStore
      .list(true)
      .then(setItems)
      .catch(() => {});
    void followupStore
      .isEnabled()
      .then(setEnabled)
      .catch(() => {});
  };

  useEffect(() => {
    refresh();
  }, []);

  const toggle = (on: boolean) => {
    setEnabled(on);
    void (async () => {
      try {
        await followupStore.setEnabled(on);
        const actives = await followupStore.list(false);
        for (const item of actives) {
          if (on) {
            await initiativeStore.setStatus(item.ruleId, "active").catch(() => {});
            const rule = await initiativeStore.get(item.ruleId).catch(() => null);
            if (rule) {
              const { rescheduleInitiativeRule } = await import("../initiative/instances");
              await rescheduleInitiativeRule(rule).catch(() => {});
            }
          } else {
            await cancelInitiativeSchedule(item.ruleId).catch(() => {});
            await initiativeStore.setStatus(item.ruleId, "archived").catch(() => {});
          }
        }
      } catch {
        // ignore — refresh shows the truth
      } finally {
        refresh();
      }
    })();
  };

  const doDelete = (item: FollowupItem) =>
    Alert.alert(t("followup.actions.delete") as string, `「${item.what}」`, [
      { text: t("common.cancel") as string, style: "cancel" },
      {
        text: t("common.delete") as string,
        style: "destructive",
        onPress: () =>
          void (async () => {
            try {
              await cancelInitiativeSchedule(item.ruleId).catch(() => {});
              await initiativeStore.setStatus(item.ruleId, "archived").catch(() => {});
              await followupStore.remove(item.id);
            } catch {
              // ignore
            } finally {
              refresh();
            }
          })(),
      },
    ]);

  const actives = items.filter((i) => i.status === "active");

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
          <TText style={{ fontWeight: "700", fontSize: 16 }}>{t("followup.section.title")}</TText>
          <TText style={[s.small, { color: colors.muted, marginTop: 4 }]}>
            {t("followup.section.desc")}
          </TText>
        </View>
        <Switch value={enabled} onValueChange={toggle} />
      </View>

      {actives.length === 0 ? (
        <TText style={[s.small, { color: colors.muted, marginTop: 12 }]}>
          {t("followup.list.empty")}
        </TText>
      ) : (
        <View style={{ marginTop: 8, gap: 4 }}>
          {actives.map((item) => (
            <View
              key={item.id}
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
                <TText style={{ fontSize: 14, fontWeight: "600" }}>{item.what}</TText>
                <TText style={[s.small, { color: colors.muted, marginTop: 2 }]}>
                  {item.eventLabel} · {t("followup.item.followUpAt")}
                  {formatWhen(item.followUpAtMs)}
                </TText>
              </View>
              <Pressable
                accessibilityLabel={t("followup.actions.delete") as string}
                onPress={() => doDelete(item)}
                style={{
                  padding: 8,
                  borderRadius: radii.sm,
                }}
              >
                <Trash2 size={16} color={colors.muted} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}
