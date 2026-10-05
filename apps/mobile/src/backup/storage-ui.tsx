/**
 * Storage UI — storage space breakdown by category.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { SectionHeading, useColors } from "../ui";
import { calculateStorage, formatBytes, type StorageReport } from "./storage";

export function StorageSection() {
  const colors = useColors();
  const [report, setReport] = useState<StorageReport | null>(null);

  useEffect(() => {
    void calculateStorage(AsyncStorage).then(setReport);
  }, []);

  const catName = (id: string) => t(`storage.category.${id}` as Parameters<typeof t>[0]);

  return (
    <ScrollView>
      <SectionHeading title={t("storage.title")} />
      {!report && <TText style={{ color: colors.muted }}>…</TText>}
      {report && (
        <View>
          <TText style={{ fontSize: 16, fontWeight: "600", marginBottom: 12 }}>
            {t("storage.total")}：{formatBytes(report.totalBytes)}
          </TText>
          {report.categories.map((c) => {
            const pct = report.totalBytes > 0 ? Math.round((c.bytes / report.totalBytes) * 100) : 0;
            return (
              <View key={c.id} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                  <TText>{catName(c.id)}</TText>
                  <TText style={{ color: colors.muted }}>
                    {formatBytes(c.bytes)} · {pct}%
                  </TText>
                </View>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.line }}>
                  <View
                    style={{
                      height: 6,
                      borderRadius: 3,
                      width: `${pct}%`,
                      backgroundColor: colors.blue,
                    }}
                  />
                </View>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}
