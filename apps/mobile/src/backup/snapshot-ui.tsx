/**
 * Snapshot UI — auto-snapshot settings + list/restore/delete.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { Alert, ScrollView, Switch, TextInput, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { TText } from "../font";
import { t } from "../i18n";
import { Button, SectionHeading, useColors } from "../ui";
import { createSnapshotStore, type SnapshotInfo, type SnapshotSettings } from "./snapshot";
import { applyBackup, collectBackup, parseBackup, serializeBackup } from "../backup";
import { getKnowledgeStore } from "../knowledge/instance";

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

function fileBackend() {
  return {
    writeFile: (p: string, c: string) => FileSystem.writeAsStringAsync(`${FileSystem.documentDirectory}${p}`, c),
    readFile: (p: string) => FileSystem.readAsStringAsync(`${FileSystem.documentDirectory}${p}`),
    deleteFile: (p: string) => FileSystem.deleteAsync(`${FileSystem.documentDirectory}${p}`, { idempotent: true }),
    listFiles: async (dir: string) => {
      try {
        const names = await FileSystem.readDirectoryAsync(`${FileSystem.documentDirectory}${dir}`);
        return names;
      } catch {
        return [];
      }
    },
  };
}

const store = createSnapshotStore(AsyncStorage, fileBackend());

export function SnapshotSection() {
  const colors = useColors();
  const [settings, setSettings] = useState<SnapshotSettings | null>(null);
  const [snaps, setSnaps] = useState<SnapshotInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const refresh = () => {
    void store.getSettings().then(setSettings);
    void store.list().then(setSnaps);
  };

  useEffect(refresh, []);

  const takeNow = async () => {
    setBusy(true);
    try {
      const backup = await collectBackup(AsyncStorage, secureBackend(), await getKnowledgeStore());
      await store.take(serializeBackup(backup), "manual");
      refresh();
      setNotice(t("snapshot.manual"));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const restoreSnap = (s: SnapshotInfo) => {
    Alert.alert(t("snapshot.restore"), new Date(s.createdAt).toLocaleString(), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("snapshot.restore"),
        style: "destructive",
        onPress: () =>
          void (async () => {
            setBusy(true);
            try {
              // Safety: snapshot current state before restoring.
              const cur = await collectBackup(AsyncStorage, secureBackend(), await getKnowledgeStore());
              await store.take(serializeBackup(cur), "pre-restore");
              const text = await store.read(s.id);
              const parsed = parseBackup(text);
              if (!parsed.ok) {
                setNotice(t("import.failed"));
                return;
              }
              await applyBackup(parsed.backup, AsyncStorage, secureBackend(), await getKnowledgeStore(), {
                mode: "overwrite",
              });
              setNotice(t("backup.restoreDone"));
              refresh();
            } catch (e) {
              setNotice(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          })(),
      },
    ]);
  };

  const reasonText = (r: SnapshotInfo["reason"]) => t(`snapshot.reason.${r}` as Parameters<typeof t>[0]);

  return (
    <ScrollView>
      <SectionHeading title={t("snapshot.title")} />
      {settings && (
        <View>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
            <TText style={{ flex: 1 }}>{t("snapshot.enabled")}</TText>
            <Switch
              value={settings.enabled}
              onValueChange={(v) => void store.updateSettings({ enabled: v }).then(setSettings)}
            />
          </View>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
            <Button primary={settings.frequency === "daily"} onPress={() => void store.updateSettings({ frequency: "daily" }).then(setSettings)}>
              {t("snapshot.frequency.daily")}
            </Button>
            <Button primary={settings.frequency === "weekly"} onPress={() => void store.updateSettings({ frequency: "weekly" }).then(setSettings)}>
              {t("snapshot.frequency.weekly")}
            </Button>
          </View>
          <TText>{t("snapshot.keepCount")}</TText>
          <TextInput
            value={String(settings.keepCount)}
            onChangeText={(v) => {
              const n = parseInt(v, 10);
              if (!Number.isNaN(n)) void store.updateSettings({ keepCount: n }).then(setSettings);
            }}
            keyboardType="number-pad"
            style={{
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: 8,
              padding: 10,
              color: colors.text,
              marginBottom: 6,
              width: 100,
            }}
          />
          <TText style={{ color: colors.muted, fontSize: 12, marginBottom: 10 }}>{t("snapshot.keepCountHint")}</TText>
        </View>
      )}

      <Button primary onPress={() => void takeNow()} disabled={busy}>
        {t("snapshot.manual")}
      </Button>

      <SectionHeading title={t("snapshot.list")} />
      {snaps.length === 0 && <TText style={{ color: colors.muted }}>{t("snapshot.empty")}</TText>}
      {snaps.map((s) => (
        <View key={s.id} style={{ padding: 10, borderBottomWidth: 1, borderColor: colors.line }}>
          <TText style={{ fontWeight: "600" }}>{new Date(s.createdAt).toLocaleString()}</TText>
          <TText style={{ color: colors.muted, fontSize: 12 }}>
            {reasonText(s.reason)}
            {s.reason === "pre-restore" ? ` · ${t("snapshot.preRestore")}` : ""}
          </TText>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
            <Button onPress={() => restoreSnap(s)} disabled={busy}>
              {t("snapshot.restore")}
            </Button>
            <Button
              onPress={() =>
                Alert.alert(
                  t("snapshot.delete"),
                  t("snapshot.deleteConfirm", { time: new Date(s.createdAt).toLocaleString() }),
                  [
                    { text: t("common.cancel"), style: "cancel" },
                    {
                      text: t("common.delete"),
                      style: "destructive",
                      onPress: () => void store.remove(s.id).then(refresh),
                    },
                  ],
                )
              }
              disabled={busy}
            >
              {t("snapshot.delete")}
            </Button>
          </View>
        </View>
      ))}
      {notice ? <TText style={{ marginTop: 8 }}>{notice}</TText> : null}
    </ScrollView>
  );
}
