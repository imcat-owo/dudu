/**
 * 图片表情包 — per-persona "may the AI send stickers" toggle for the
 * persona editor. Default ON. She controls it; the AI never changes it.
 * Mirrors SegmentSection (segments/segment-ui.tsx).
 */

import { useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { stickerStore } from "./instances";

export function StickerToggleSection({ personaId }: { personaId: string }) {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    let alive = true;
    void stickerStore
      .isAiEnabled(personaId)
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
    void stickerStore.setAiEnabled(personaId, v).catch(() => setEnabled(!v));
  };

  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
        <TText style={{ flex: 1 }}>{t("persona.stickerSending")}</TText>
        <Switch value={enabled} onValueChange={onChange} />
      </View>
      <TText style={{ fontSize: 12, opacity: 0.65 }}>{t("persona.stickerSendingHint")}</TText>
    </View>
  );
}
