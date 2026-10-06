/**
 * 真人式分段发送 — per-persona toggle UI for the persona editor.
 * Default ON (conservative: only long replies split). She controls it;
 * the AI never changes it.
 */

import { useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { segmentStore } from "./instances";

export function SegmentSection({ personaId }: { personaId: string }) {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    let alive = true;
    void segmentStore
      .isEnabled(personaId)
      .then((v) => {
        if (alive) setEnabled(v);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [personaId]);

  const onChange = (v: boolean) => {
    setEnabled(v);
    void segmentStore.setEnabled(personaId, v).catch(() => setEnabled(!v));
  };

  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
        <TText style={{ flex: 1 }}>{t("persona.segmentedSending")}</TText>
        <Switch value={enabled} onValueChange={onChange} />
      </View>
      <TText style={{ fontSize: 12, opacity: 0.65 }}>{t("persona.segmentedSendingHint")}</TText>
    </View>
  );
}
