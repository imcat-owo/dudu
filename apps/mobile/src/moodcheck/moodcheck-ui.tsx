/**
 * Daily mood check-in （每日心情 check-in） — management UI for Our Space.
 * Master toggle + hour presets + the visible mood timeline (date → mood +
 * note), each entry deletable. Nothing fires secretly: the check-in and
 * everything it recorded shows up here.
 */

import { Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, Pressable, Switch, View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { radii } from "../theme/radii";
import { Card, useColors, useStyles } from "../ui";
import { moodcheckStore } from "./instances";
import type { MoodEntry } from "./store";

/** Evening/night presets — she's nocturnal; 06:00–16:00 is never offered. */
const HOUR_PRESETS = [18, 19, 20, 21, 22, 23];

export function MoodcheckSection() {
  const colors = useColors();
  const s = useStyles();
  const [entries, setEntries] = useState<MoodEntry[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [hour, setHour] = useState(20);

  const refresh = () => {
    void moodcheckStore
      .list(30)
      .then(setEntries)
      .catch(() => {});
    void moodcheckStore
      .getConfig()
      .then((c) => {
        setEnabled(c.enabled);
        setHour(c.hour);
      })
      .catch(() => {});
  };

  useEffect(() => {
    refresh();
  }, []);

  const toggle = (on: boolean) => {
    setEnabled(on);
    void (async () => {
      try {
        await moodcheckStore.setConfig({ enabled: on });
      } catch {
        // ignore — refresh shows the truth
      } finally {
        refresh();
      }
    })();
  };

  const pickHour = (h: number) => {
    setHour(h);
    void (async () => {
      try {
        await moodcheckStore.setConfig({ hour: h });
      } catch {
        // ignore — refresh shows the truth
      } finally {
        refresh();
      }
    })();
  };

  const doDelete = (entry: MoodEntry) =>
    Alert.alert(t("moodcheck.actions.delete") as string, `「${entry.mood}」 · ${entry.dayKey}`, [
      { text: t("common.cancel") as string, style: "cancel" },
      {
        text: t("common.delete") as string,
        style: "destructive",
        onPress: () =>
          void (async () => {
            try {
              await moodcheckStore.remove(entry.id);
            } catch {
              // ignore
            } finally {
              refresh();
            }
          })(),
      },
    ]);

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
          <TText style={{ fontWeight: "700", fontSize: 16 }}>{t("moodcheck.section.title")}</TText>
          <TText style={[s.small, { color: colors.muted, marginTop: 4 }]}>
            {t("moodcheck.section.desc")}
          </TText>
        </View>
        <Switch value={enabled} onValueChange={toggle} />
      </View>

      <View style={{ marginTop: 12 }}>
        <TText style={[s.small, { color: colors.muted, marginBottom: 8 }]}>
          {t("moodcheck.config.hourLabel")}
        </TText>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {HOUR_PRESETS.map((h) => {
            const active = h === hour;
            return (
              <Pressable
                key={h}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => pickHour(h)}
                style={{
                  borderWidth: 1,
                  borderColor: active ? colors.text : colors.line,
                  backgroundColor: active ? colors.text : "transparent",
                  borderRadius: radii.lg,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                }}
              >
                <TText
                  style={{
                    fontSize: 13,
                    color: active ? colors.card : colors.text,
                    fontWeight: active ? "700" : "400",
                  }}
                >
                  {h}:00
                </TText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ marginTop: 12 }}>
        <TText style={[s.small, { color: colors.muted, marginBottom: 4 }]}>
          {t("moodcheck.list.title")}
        </TText>
        {entries.length === 0 ? (
          <TText style={[s.small, { color: colors.muted, marginTop: 4 }]}>
            {t("moodcheck.list.empty")}
          </TText>
        ) : (
          <View style={{ marginTop: 4, gap: 4 }}>
            {entries.map((entry) => (
              <View
                key={entry.id}
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
                    {entry.dayKey} · {entry.mood}
                  </TText>
                  {entry.note ? (
                    <TText style={[s.small, { color: colors.muted, marginTop: 2 }]}>
                      {entry.note}
                    </TText>
                  ) : null}
                  <TText style={[s.small, { color: colors.muted, marginTop: 2 }]}>
                    {t(
                      entry.source === "checkin"
                        ? "moodcheck.item.fromCheckin"
                        : "moodcheck.item.fromChat",
                    )}
                  </TText>
                </View>
                <Pressable
                  accessibilityLabel={t("moodcheck.actions.delete") as string}
                  onPress={() => doDelete(entry)}
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
      </View>
    </Card>
  );
}
