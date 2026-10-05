/**
 * Character card UI: import button (pick -> preview -> confirm) and
 * export button (persona -> shareable card PNG), plus the "card extras"
 * section for imported personas.
 */
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import { Alert, Modal, ScrollView, View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { personaStore, worldBookStore } from "../persona/stores";
import type { Persona } from "../persona/types";
import { Button, useColors } from "../ui";
import type { CharaCard } from "./card";
import { exportCharaCardPng } from "./export";
import { type CharaImportCode, importCharaCard, previewCharaCard } from "./import";
import { getImportedCard } from "./persona-map";
import { base64ToBytes, bytesToBase64, utf8Decode } from "./png";

function codeToKey(code: CharaImportCode): string {
  switch (code) {
    case "empty":
      return "chara.error.empty";
    case "not-png":
      return "chara.error.notPng";
    case "no-card-chunk":
      return "chara.error.noCard";
    case "compressed-unsupported":
      return "chara.error.compressed";
    case "unsupported-spec":
      return "chara.error.unsupported";
    case "no-name":
      return "chara.error.noName";
    default:
      return "chara.error.badFile";
  }
}

const isPngName = (name: string) => /\.png$/i.test(name);

async function saveAvatarPng(bytes: Uint8Array, personaId: string): Promise<string | null> {
  try {
    const dir = `${FileSystem.documentDirectory}persona-avatars/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    const path = `${dir}${personaId}.png`;
    await FileSystem.writeAsStringAsync(path, bytesToBase64(bytes), {
      encoding: FileSystem.EncodingType.Base64,
    });
    return path;
  } catch {
    return null;
  }
}

export function CharaImportButton({ onImported }: { onImported?: () => void }) {
  const colors = useColors();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{
    card: CharaCard;
    fileName: string;
    fileBase64: string;
    isPng: boolean;
  } | null>(null);

  const pick = async () => {
    setBusy(true);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ["image/png", "application/json", "*.png", "*.json"],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      const name = asset.name ?? "card.png";
      const png = isPngName(name);
      const fileBase64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const input = png ? { pngBase64: fileBase64 } : { jsonText: BufferToText(fileBase64) };
      const pv = previewCharaCard(input);
      if (!pv.ok) {
        Alert.alert(t("common.error"), t(codeToKey(pv.code) as Parameters<typeof t>[0]));
        return;
      }
      setPreview({ card: pv.card, fileName: name, fileBase64, isPng: png });
    } catch {
      Alert.alert(t("common.error"), t("chara.error.badFile"));
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const input = preview.isPng
        ? { pngBase64: preview.fileBase64 }
        : { jsonText: BufferToText(preview.fileBase64) };
      const outcome = await importCharaCard(input, { personaStore, worldBookStore });
      if (!outcome.ok) {
        Alert.alert(t("common.error"), t(codeToKey(outcome.code) as Parameters<typeof t>[0]));
        return;
      }
      if (outcome.pngBytes) {
        const avatarPath = await saveAvatarPng(outcome.pngBytes, outcome.personaId);
        if (avatarPath) {
          const p = await personaStore.get(outcome.personaId);
          if (p) await personaStore.upsert({ ...p, avatar: avatarPath });
        }
      }
      setPreview(null);
      Alert.alert(t("chara.imported"), outcome.personaName);
      onImported?.();
    } finally {
      setBusy(false);
    }
  };

  const d = preview?.card.data;
  const spec = preview?.card.spec;
  return (
    <View>
      <Button onPress={pick} disabled={busy}>
        {busy ? "..." : t("chara.import")}
      </Button>
      <TText style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
        {t("chara.importHint")}
      </TText>
      <Modal
        visible={preview !== null}
        animationType="slide"
        onRequestClose={() => setPreview(null)}
      >
        <View style={{ flex: 1, backgroundColor: colors.canvas, padding: 20, paddingTop: 60 }}>
          <TText style={{ fontSize: 18, fontWeight: "700", marginBottom: 4 }}>
            {t("chara.previewTitle")}
          </TText>
          {d && (
            <ScrollView style={{ flex: 1, marginVertical: 12 }}>
              <TText style={{ fontSize: 16, fontWeight: "600" }}>{d.name}</TText>
              <TText style={{ color: colors.muted, marginTop: 4 }}>
                {t("chara.specVersion")}: {spec} · {t("chara.creator")}: {d.creator || "?"}
              </TText>
              {d.description ? (
                <TText style={{ marginTop: 8 }} numberOfLines={6}>
                  {d.description}
                </TText>
              ) : null}
              <TText style={{ color: colors.muted, marginTop: 8 }}>
                {t("chara.fields")}:{" "}
                {[
                  d.personality && "personality",
                  d.scenario && "scenario",
                  d.first_mes && "first_mes",
                  d.mes_example && "mes_example",
                  d.system_prompt && "system_prompt",
                  d.tags.length > 0 && `tags(${d.tags.length})`,
                  d.character_book && `lorebook(${d.character_book.entries.length})`,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </TText>
              {d.character_book && d.character_book.entries.length > 0 && (
                <TText style={{ color: colors.muted, marginTop: 4 }}>
                  {t("chara.lorebookNote")}
                </TText>
              )}
            </ScrollView>
          )}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button onPress={doImport} disabled={busy}>
              {t("chara.confirmImport")}
            </Button>
            <Button onPress={() => setPreview(null)}>{t("chara.cancel")}</Button>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** Base64 (of a UTF-8 JSON file) -> text. JSON cards are text, not binary. */
function BufferToText(fileBase64: string): string {
  try {
    return utf8Decode(base64ToBytes(fileBase64));
  } catch {
    return "";
  }
}

export function CharaExportButton({ persona }: { persona: Persona }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const tags = await personaStore.listTags();
      const result = await exportCharaCardPng(persona, tags, {
        resolveAvatarPng: async (avatar) => {
          if (!avatar || !/\.png$/i.test(avatar)) return null;
          try {
            const b64 = await FileSystem.readAsStringAsync(avatar, {
              encoding: FileSystem.EncodingType.Base64,
            });
            return base64ToBytes(b64);
          } catch {
            return null;
          }
        },
      });
      await personaStore.upsert(result.updatedPersona).catch(() => {});
      const path = `${FileSystem.cacheDirectory}${result.filename}`;
      await FileSystem.writeAsStringAsync(path, result.pngBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path);
      }
      Alert.alert(t("chara.exported"), result.filename);
    } catch {
      Alert.alert(t("common.error"), t("chara.error.badFile"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button onPress={run} disabled={busy}>
      {t("chara.export")}
    </Button>
  );
}

/** "Card extras" — everything the card carried that Dudu doesn't model. */
export function CharaExtrasSection({ persona }: { persona: Persona }) {
  const colors = useColors();
  const card = getImportedCard(persona);
  if (!card) return null;
  const d = card.data;
  const rows: Array<[string, string]> = [
    [t("chara.specVersion"), `${card.spec} (${card.spec_version})`],
  ];
  if (d.creator)
    rows.push([
      t("chara.creator"),
      d.creator + (d.character_version ? ` · v${d.character_version}` : ""),
    ]);
  if (d.nickname) rows.push(["nickname", d.nickname]);
  if (d.creator_notes) rows.push(["creator_notes", d.creator_notes]);
  if (d.post_history_instructions)
    rows.push(["post_history_instructions", d.post_history_instructions]);
  if (d.alternate_greetings.length > 0)
    rows.push([
      "alternate_greetings",
      d.alternate_greetings.map((g, i) => `#${i + 1} ${g.slice(0, 60)}`).join("\n"),
    ]);
  if (d.group_only_greetings && d.group_only_greetings.length > 0)
    rows.push(["group_only_greetings", `${d.group_only_greetings.length}`]);
  const extKeys = Object.keys(d.extensions);
  if (extKeys.length > 0) rows.push(["extensions", extKeys.join(", ")]);
  if (d.assets && d.assets.length > 0) rows.push(["assets", `${d.assets.length}`]);
  return (
    <View style={{ marginTop: 12 }}>
      <TText style={{ fontWeight: "600", marginBottom: 6 }}>{t("chara.extras")}</TText>
      {rows.map(([k, v]) => (
        <View key={k} style={{ marginBottom: 6 }}>
          <TText style={{ color: colors.muted, fontSize: 12 }}>{k}</TText>
          <TText numberOfLines={8}>{v}</TText>
        </View>
      ))}
    </View>
  );
}

/** Small tappable row used inside lists. */
export function CharaImportRow({ onImported }: { onImported?: () => void }) {
  return (
    <View style={{ marginVertical: 8 }}>
      <CharaImportButton onImported={onImported} />
    </View>
  );
}
