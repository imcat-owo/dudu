/**
 * Google Fonts picker UI — search, download, apply.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { ScrollView, TextInput, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Font from "expo-font";
import { TText } from "../font";
import { t } from "../i18n";
import { Button, SectionHeading, useColors } from "../ui";
import {
  downloadFont,
  fetchFontCatalog,
  fontFilename,
  searchFonts,
  type GoogleFontEntry,
} from "./google-fonts";

const FONT_DIR = "dudu/fonts";
const FONT_KEY = "dudu.font.v1";

export function GoogleFontsSection() {
  const colors = useColors();
  const [entries, setEntries] = useState<GoogleFontEntry[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void fetchFontCatalog(AsyncStorage)
      .then(setEntries)
      .catch(() => setNotice(t("fonts.catalogFailed")))
      .finally(() => setLoading(false));
  }, []);

  const filtered = searchFonts(entries, query);

  const applyFont = async (entry: GoogleFontEntry) => {
    setDownloading(entry.family);
    setNotice("");
    try {
      const bytes = await downloadFont(entry);
      const dir = `${FileSystem.documentDirectory}${FONT_DIR}/`;
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      const filename = fontFilename(entry);
      const uri = `${dir}${filename}`;
      // Write bytes to file.
      const base64 = Buffer.from(bytes).toString("base64");
      await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
      // Register with expo-font.
      await Font.loadAsync("DuduCustom", { uri });
      // Persist.
      await AsyncStorage.setItem(FONT_KEY, JSON.stringify({ name: entry.family, file: filename }));
      setNotice(t("fonts.downloaded"));
    } catch {
      setNotice(t("fonts.downloadFailed"));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <ScrollView>
      <SectionHeading title={t("fonts.download")} />
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={t("fonts.search")}
        style={{
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: 8,
          padding: 10,
          color: colors.text,
          marginBottom: 12,
        }}
      />
      {loading && <TText style={{ color: colors.muted }}>…</TText>}
      {!loading && filtered.length === 0 && <TText style={{ color: colors.muted }}>{t("fonts.noResults")}</TText>}
      {filtered.map((e) => (
        <View
          key={e.family}
          style={{ flexDirection: "row", alignItems: "center", padding: 10, borderBottomWidth: 1, borderColor: colors.line }}
        >
          <View style={{ flex: 1 }}>
            <TText style={{ fontWeight: "600" }}>{e.family}</TText>
            <TText style={{ color: colors.muted, fontSize: 12 }}>{e.subsets.join(", ")}</TText>
          </View>
          <Button onPress={() => void applyFont(e)} disabled={downloading !== null}>
            {downloading === e.family ? t("fonts.downloading") : t("fonts.download")}
          </Button>
        </View>
      ))}
      {notice ? <TText style={{ marginTop: 8 }}>{notice}</TText> : null}
    </ScrollView>
  );
}
