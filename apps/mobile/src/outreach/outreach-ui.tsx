/**
 * Proactive outreach (主动触达) — frequency setting UI.
 * Three levels, her decision (2026-10-05): 积极 / 适度 / 安静, default 适度.
 * Lives in Our Space (the relationship space), next to 稍后告诉她 —
 * the queue the outreach draws from.
 */
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { TText } from "../font";
import { t, type StringKey } from "../i18n";
import { radii } from "../theme/radii";
import { Card, useColors, useStyles } from "../ui";
import { DEFAULT_FREQUENCY, OutreachStore } from "./store";
import { requestNotificationPermission } from "../device-permissions";
import type { OutreachFrequency } from "./engine";

const store = new OutreachStore(AsyncStorage);

const OPTIONS: { value: OutreachFrequency; labelKey: StringKey; descKey: StringKey }[] = [
  { value: "active", labelKey: "outreach.freq.active", descKey: "outreach.freq.activeDesc" },
  { value: "moderate", labelKey: "outreach.freq.moderate", descKey: "outreach.freq.moderateDesc" },
  { value: "quiet", labelKey: "outreach.freq.quiet", descKey: "outreach.freq.quietDesc" },
];

export function OutreachFrequencySection() {
  const colors = useColors();
  const s = useStyles();
  const [freq, setFreq] = useState<OutreachFrequency>(DEFAULT_FREQUENCY);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void store.getFrequency().then((f) => {
      if (alive) {
        setFreq(f);
        setLoaded(true);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const pick = (v: OutreachFrequency) => {
    setFreq(v);
    void store.setFrequency(v).catch(() => {
      // Revert on failure — never show a lie.
      void store.getFrequency().then(setFreq).catch(() => {});
    });
    // The feature only works with notification permission. Ask exactly once,
    // at the moment she turns it on — never nag.
    if (v !== "quiet") {
      void requestNotificationPermission().catch(() => {});
    }
  };

  return (
    <Card>
      <TText style={{ fontWeight: "700" }}>{t("outreach.freq.title")}</TText>
      <TText style={[s.small, { color: colors.muted, marginTop: 4 }]}>{t("outreach.freq.desc")}</TText>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        {OPTIONS.map((o) => {
          const selected = loaded && freq === o.value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => pick(o.value)}
              style={{
                flex: 1,
                paddingVertical: 10,
                paddingHorizontal: 6,
                borderRadius: radii.sm,
                borderWidth: 1.5,
                borderColor: selected ? colors.blueDark : colors.line,
                backgroundColor: selected ? colors.sky : colors.card,
                alignItems: "center",
                gap: 2,
              }}
            >
              <TText style={{ fontWeight: "700", fontSize: 14 }}>{t(o.labelKey)}</TText>
              <TText style={[s.small, { color: colors.muted, textAlign: "center" }]}>{t(o.descKey)}</TText>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}
