/**
 * AI photo share （主动发照片） — management UI for Our Space.
 * Master toggle (OPT-IN, default OFF) + the visible log of shared photos.
 * Nothing fires secretly: every share shows up here.
 */

import { useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { Card, useColors, useStyles } from "../ui";
import { photoshareStore } from "./instances";
import type { PhotoshareLogEntry } from "./store";

export function PhotoshareSection() {
  const colors = useColors();
  const s = useStyles();
  const [entries, setEntries] = useState<PhotoshareLogEntry[]>([]);
  const [enabled, setEnabled] = useState(false);

  const refresh = () => {
    void photoshareStore
      .listLog(20)
      .then(setEntries)
      .catch(() => {});
    void photoshareStore
      .getConfig()
      .then((c) => setEnabled(c.enabled))
      .catch(() => {});
  };

  useEffect(() => {
    refresh();
  }, []);

  const toggle = (on: boolean) => {
    setEnabled(on);
    void (async () => {
      try {
        await photoshareStore.setConfig({ enabled: on });
      } catch {
        // ignore — refresh shows the truth
      } finally {
        refresh();
      }
    })();
  };

  const shared = entries.filter((e) => e.outcome === "shared");

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
          <TText style={{ fontWeight: "700", fontSize: 16 }}>{t("photoshare.section.title")}</TText>
          <TText style={[s.small, { color: colors.muted, marginTop: 4 }]}>
            {t("photoshare.section.desc")}
          </TText>
        </View>
        <Switch value={enabled} onValueChange={toggle} />
      </View>

      <View style={{ marginTop: 12 }}>
        <TText style={[s.small, { color: colors.muted, marginBottom: 4 }]}>
          {t("photoshare.list.title")}
        </TText>
        {shared.length === 0 ? (
          <TText style={[s.small, { color: colors.muted, marginTop: 4 }]}>
            {t("photoshare.list.empty")}
          </TText>
        ) : (
          <View style={{ marginTop: 4, gap: 4 }}>
            {shared.map((entry) => (
              <View
                key={`${entry.at}-${entry.slotIndex}-${entry.captionPreview ?? ""}`}
                style={{
                  paddingVertical: 8,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.line,
                }}
              >
                <TText style={{ fontSize: 14, fontWeight: "600" }}>
                  {new Date(entry.at).toLocaleString("zh-CN", {
                    timeZone: "Asia/Shanghai",
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {entry.manual ? ` · ${t("photoshare.item.manual")}` : ""}
                </TText>
                {entry.captionPreview ? (
                  <TText style={[s.small, { color: colors.muted, marginTop: 2 }]}>
                    {entry.captionPreview}
                  </TText>
                ) : null}
              </View>
            ))}
          </View>
        )}
      </View>
    </Card>
  );
}
