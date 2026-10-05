/**
 * Web apps UI — list, add, edit, delete, open.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { Alert, Linking, ScrollView, TextInput, View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { Button, SectionHeading, useColors } from "../ui";
import { createWebAppStore, type WebApp } from "./web-apps";

const store = createWebAppStore(AsyncStorage);

export function WebAppsSection() {
  const colors = useColors();
  const [apps, setApps] = useState<WebApp[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  const refresh = () => void store.list().then(setApps);

  useEffect(refresh, []);

  const add = async () => {
    const { app, error } = await store.add(name, url);
    if (error) {
      Alert.alert(t("common.error"), t(`webapps.error.${error}` as Parameters<typeof t>[0]));
      return;
    }
    setName("");
    setUrl("");
    refresh();
  };

  const remove = (app: WebApp) => {
    Alert.alert(t("webapps.delete"), t("webapps.deleteConfirm", { name: app.name }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () => void store.remove(app.id).then(refresh),
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
      <SectionHeading title={t("webapps.title")} />
      <TText style={{ color: colors.muted, fontSize: 13, marginBottom: 12 }}>{t("webapps.hint")}</TText>

      {apps.length === 0 && <TText style={{ color: colors.muted }}>{t("webapps.empty")}</TText>}
      {apps.map((app) => (
        <View
          key={app.id}
          style={{ flexDirection: "row", alignItems: "center", padding: 12, borderBottomWidth: 1, borderColor: colors.line }}
        >
          <View style={{ flex: 1 }}>
            <TText style={{ fontWeight: "600" }}>{app.name}</TText>
            <TText style={{ color: colors.muted, fontSize: 12 }}>{app.url}</TText>
          </View>
          <Button onPress={() => void Linking.openURL(app.url)}>{t("common.open")}</Button>
          <Button onPress={() => remove(app)}>{t("common.delete")}</Button>
        </View>
      ))}

      <SectionHeading title={t("webapps.create")} />
      <TextInput value={name} onChangeText={setName} placeholder={t("webapps.namePlaceholder")} style={inputStyle} />
      <TextInput
        value={url}
        onChangeText={setUrl}
        placeholder={t("webapps.urlPlaceholder")}
        autoCapitalize="none"
        keyboardType="url"
        style={inputStyle}
      />
      <Button primary onPress={() => void add()}>
        {t("webapps.create")}
      </Button>
    </ScrollView>
  );
}
