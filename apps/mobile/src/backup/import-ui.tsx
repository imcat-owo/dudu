/**
 * Import UI — 迁入旧数据 (move in from another app).
 *
 * One auto-detect button plus per-app buttons, all routed through the
 * dudu-exchange v1 adapter registry (src/exchange/). Foreign imports ALWAYS
 * add new threads — they never touch existing data.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { EXCHANGE_ADAPTERS } from "../exchange/adapters";
import { importExchange } from "../exchange/import";
import { TText } from "../font";
import { t } from "../i18n";
import { Button, SectionHeading, useColors } from "../ui";

export function ImportSection() {
  const colors = useColors();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const doImport = async (adapterId?: string) => {
    setBusy(true);
    setNotice("");
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["application/json", "*/*"],
      });
      if (picked.canceled) return;
      const text = await FileSystem.readAsStringAsync(picked.assets[0].uri);
      const outcome = await importExchange(text, AsyncStorage, adapterId);
      if (!outcome.ok) {
        const key =
          outcome.code === "unknown-source"
            ? "import.unknownSource"
            : outcome.code === "import-no-conversations"
              ? "import.noConversations"
              : "import.failed";
        setNotice(t(key as Parameters<typeof t>[0]));
        return;
      }
      const { result, adapter } = outcome;
      let msg = t("import.doneFrom", {
        app: adapter.appName,
        conversations: String(result.conversations),
        messages: String(result.messages),
      });
      if (result.skipped > 0) {
        msg += t("import.skipped", { skipped: String(result.skipped) });
      }
      setNotice(msg);
    } catch {
      setNotice(t("import.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView>
      <SectionHeading title={t("import.title")} />
      <TText style={{ color: colors.muted, fontSize: 13, marginBottom: 12 }}>
        {t("import.hint")}
      </TText>
      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
        <Button primary onPress={() => void doImport()} disabled={busy}>
          {busy ? t("import.importing") : t("import.auto")}
        </Button>
        {EXCHANGE_ADAPTERS.map((a) => (
          <Button key={a.id} onPress={() => void doImport(a.id)} disabled={busy}>
            {t(`import.app.${a.id}` as Parameters<typeof t>[0])}
          </Button>
        ))}
      </View>
      {notice ? <TText style={{ marginTop: 10 }}>{notice}</TText> : null}
    </ScrollView>
  );
}
