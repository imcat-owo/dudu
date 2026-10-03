/**
 * Backup & restore UI — Sora gray, compact, lucide icons, zero emoji.
 * Mounted in AppearanceScreen (settings).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Download, History, Upload } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { refreshChatMode } from "./api-groups/mode";
import { groupStore } from "./api-groups/store";
import { refreshFontSizeOption } from "./app-settings";
import {
  applyBackup,
  type BackupParseError,
  collectBackup,
  getLastBackupAt,
  markBackedUp,
  parseBackup,
  serializeBackup,
} from "./backup";
import { TText } from "./font";
import { t } from "./i18n";
import { Button, SectionHeading, useColors } from "./ui";
import { voiceStore } from "./voice/store";

function secureBackend() {
  return {
    getItem: async (key: string) => {
      const { getItemAsync } = await import("expo-secure-store");
      return getItemAsync(key);
    },
    setItem: async (key: string, value: string) => {
      const { setItemAsync } = await import("expo-secure-store");
      return setItemAsync(key, value);
    },
  };
}

function errorText(code: BackupParseError): string {
  return t(`backup.errors.${code}` as Parameters<typeof t>[0]);
}

export function BackupSection() {
  const colors = useColors();
  const [lastAt, setLastAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void getLastBackupAt(AsyncStorage).then((v) => {
      if (active) setLastAt(v);
    });
    return () => {
      active = false;
    };
  }, []);

  async function onBackup() {
    setBusy(true);
    setNotice("");
    try {
      const backup = await collectBackup(AsyncStorage, secureBackend());
      const json = serializeBackup(backup);
      const FileSystem = await import("expo-file-system/legacy");
      const Sharing = await import("expo-sharing");
      const stamp = new Date().toISOString().slice(0, 10);
      const path = `${FileSystem.cacheDirectory}openmuse-backup-${stamp}.json`;
      await FileSystem.writeAsStringAsync(path, json);
      await markBackedUp(AsyncStorage);
      setLastAt(new Date().toISOString());
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path);
      }
      setNotice(t("backup.backupDone"));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onRestore() {
    setBusy(true);
    setNotice("");
    try {
      const Picker = await import("expo-document-picker");
      const picked = await Picker.getDocumentAsync({ type: "application/json" });
      if (picked.canceled) return;
      const FileSystem = await import("expo-file-system/legacy");
      const text = await FileSystem.readAsStringAsync(picked.assets[0].uri);
      const parsed = parseBackup(text);
      if (!parsed.ok) {
        setNotice(errorText(parsed.code));
        return;
      }
      Alert.alert(t("backup.title"), t("backup.confirmRestore"), [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("backup.restore"),
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                await applyBackup(parsed.backup, AsyncStorage, secureBackend());
                // Refresh in-memory store mirrors so the UI shows the
                // restored data immediately (no app restart needed).
                await groupStore.refresh();
                await voiceStore.refresh();
                await refreshChatMode();
                await refreshFontSizeOption();
                setNotice(t("backup.restoreDone"));
              } catch (e) {
                setNotice(e instanceof Error ? e.message : String(e));
              }
            })();
          },
        },
      ]);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <SectionHeading title={t("backup.title")} />
      <TText style={{ color: colors.muted, fontSize: 13, marginBottom: 6 }}>
        {t("backup.intro")}
      </TText>
      <TText style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>
        {t("backup.includes")}
      </TText>
      <TText style={{ color: colors.muted, fontSize: 12, marginBottom: 10 }}>
        {t("backup.secretsNote")}
      </TText>
      <TText style={{ color: colors.muted, fontSize: 12, marginBottom: 10 }}>
        {t("backup.lastBackup")}: {lastAt ? new Date(lastAt).toLocaleString() : t("backup.never")}
      </TText>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Button icon={Upload} onPress={() => void onBackup()} disabled={busy}>
          {t("backup.now")}
        </Button>
        <Button icon={Download} onPress={() => void onRestore()} disabled={busy}>
          {t("backup.restore")}
        </Button>
      </View>
      {notice ? (
        <TText style={{ color: colors.text, fontSize: 13, marginTop: 8 }}>
          <History size={13} /> {notice}
        </TText>
      ) : null}
    </View>
  );
}
