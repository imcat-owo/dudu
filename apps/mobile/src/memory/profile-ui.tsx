/**
 * User profile UI — view/edit the AI-maintained profile card.
 */

import { useEffect, useState } from "react";
import { Alert, ScrollView, TextInput, View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { Button, SectionHeading, useColors } from "../ui";
import { memoryStore } from "./instance";
import type { ProfileEntry } from "./types";

const KNOWN_KEYS = [
  "preferred_name",
  "gender",
  "pronouns",
  "preferred_language",
  "timezone",
  "occupation",
  "location",
];

export function ProfileSection() {
  const colors = useColors();
  const [entries, setEntries] = useState<ProfileEntry[]>([]);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const refresh = () => {
    void memoryStore.getProfile().then(setEntries);
  };

  useEffect(refresh, []);

  const keyName = (key: string) => {
    if (key.startsWith("custom.")) return key.slice(7);
    return t(`profile.known.${key}` as Parameters<typeof t>[0]);
  };

  const saveEntry = async (key: string, value: string) => {
    if (!value.trim()) return;
    await memoryStore.setProfile(key, value.trim(), "user");
    refresh();
  };

  const deleteEntry = (key: string) => {
    Alert.alert(t("profile.deleteConfirm"), keyName(key), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () => void memoryStore.deleteProfile(key).then(refresh),
      },
    ]);
  };

  const inputStyle = {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    padding: 10,
    color: colors.text,
    marginBottom: 8,
  };

  return (
    <ScrollView>
      <SectionHeading title={t("profile.title")} />
      <TText style={{ color: colors.muted, fontSize: 13, marginBottom: 12 }}>{t("profile.hint")}</TText>

      {entries.length === 0 && <TText style={{ color: colors.muted }}>{t("profile.empty")}</TText>}

      {entries.map((e) => (
        <ProfileRow
          key={e.key}
          entry={e}
          displayName={keyName(e.key)}
          onSave={(v) => void saveEntry(e.key, v)}
          onDelete={() => deleteEntry(e.key)}
        />
      ))}

      <SectionHeading title={t("profile.add")} />
      <TextInput
        value={newKey}
        onChangeText={setNewKey}
        placeholder={t("profile.keyPlaceholder")}
        style={inputStyle}
      />
      <TextInput
        value={newValue}
        onChangeText={setNewValue}
        placeholder={t("profile.valuePlaceholder")}
        style={inputStyle}
      />
      <Button
        onPress={() => {
          const key = newKey.trim();
          if (!key || !newValue.trim()) return;
          // Custom keys get the custom. prefix.
          const fullKey = KNOWN_KEYS.includes(key) ? key : `custom.${key}`;
          void saveEntry(fullKey, newValue).then(() => {
            setNewKey("");
            setNewValue("");
          });
        }}
      >
        {t("profile.add")}
      </Button>
    </ScrollView>
  );
}

function ProfileRow({
  entry,
  displayName,
  onSave,
  onDelete,
}: {
  entry: ProfileEntry;
  displayName: string;
  onSave: (v: string) => void;
  onDelete: () => void;
}) {
  const colors = useColors();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(entry.value);

  if (!editing) {
    return (
      <View style={{ padding: 12, borderBottomWidth: 1, borderColor: colors.line }}>
        <TText style={{ fontWeight: "600" }}>{displayName}</TText>
        <TText style={{ color: colors.muted, marginTop: 4 }}>{entry.value}</TText>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
          <Button onPress={() => setEditing(true)}>{t("common.edit")}</Button>
          <Button onPress={onDelete}>{t("common.delete")}</Button>
        </View>
      </View>
    );
  }

  return (
    <View style={{ padding: 12, borderBottomWidth: 1, borderColor: colors.line }}>
      <TText style={{ fontWeight: "600", marginBottom: 8 }}>{displayName}</TText>
      <TextInput
        value={value}
        onChangeText={setValue}
        style={{
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: 8,
          padding: 10,
          color: colors.text,
          marginBottom: 8,
        }}
      />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button
          onPress={() => {
            onSave(value);
            setEditing(false);
          }}
        >
          {t("common.save")}
        </Button>
        <Button
          onPress={() => {
            setValue(entry.value);
            setEditing(false);
          }}
        >
          {t("common.cancel")}
        </Button>
      </View>
    </View>
  );
}
