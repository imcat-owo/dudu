/**
 * Import UI — Cherry Studio / ChatBox backup import.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { TText } from "../font";
import { t } from "../i18n";
import { Button, SectionHeading, useColors } from "../ui";
import { importConversations, parseChatBoxBackup, parseCherryBackup } from "./import";

export function ImportSection() {
  const colors = useColors();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const doImport = async (kind: "cherry" | "chatbox") => {
    setBusy(true);
    setNotice("");
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: ["application/json", "*/*"] });
      if (picked.canceled) return;
      const text = await FileSystem.readAsStringAsync(picked.assets[0].uri);
      const convs = kind === "cherry" ? parseCherryBackup(text) : parseChatBoxBackup(text);
      if (convs.length === 0) {
        setNotice(t("import.noConversations"));
        return;
      }
      const result = await importConversations(convs, AsyncStorage);
      let msg = t("import.done", {
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
      <TText style={{ color: colors.muted, fontSize: 13, marginBottom: 12 }}>{t("import.hint")}</TText>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Button primary onPress={() => void doImport("cherry")} disabled={busy}>
          {busy ? t("import.importing") : t("import.cherry")}
        </Button>
        <Button primary onPress={() => void doImport("chatbox")} disabled={busy}>
          {busy ? t("import.importing") : t("import.chatbox")}
        </Button>
      </View>
      {notice ? <TText style={{ marginTop: 10 }}>{notice}</TText> : null}
    </ScrollView>
  );
}
