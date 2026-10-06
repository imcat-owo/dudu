/**
 * 图片表情包 UI — WeChat-style sticker picker + pack management.
 *
 * StickerPanel: pack tabs on top (AI library first), sticker grid below,
 * tap to send, gear opens the manager. Slides up above the chat input.
 * StickerManager: modal — create/rename/delete packs, add/remove stickers
 * from the photo library. The AI library pack can't be deleted (it's the
 * AI's library), but she can add to it and trim it.
 *
 * Sora gray, compact, lucide icons, zero emoji.
 */

import { Pencil, Plus, Settings2, Trash2, X } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { Button, Card, SectionHeading, useColors } from "../ui";
import { addStickerFile, deletePackFiles, deleteStickerFile, stickerFileUri } from "./files";
import { ensureAiPackSeeded, stickerStore } from "./instances";
import { AI_PACK_ID, type Sticker, type StickerPack } from "./types";

export interface ResolvedSticker extends Sticker {
  uri: string;
}

async function resolveStickers(packId: string): Promise<ResolvedSticker[]> {
  const stickers = await stickerStore.listStickers(packId);
  return Promise.all(
    stickers.map(async (s) => ({ ...s, uri: await stickerFileUri(packId, s.fileName) })),
  );
}

async function pickLibraryImage(): Promise<string | null> {
  const ImagePicker = await import("expo-image-picker");
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert(t("sticker.title"), t("perm.photoDenied"));
    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 0.9,
  });
  if (result.canceled || !result.assets?.length) return null;
  return result.assets[0].uri;
}

/** WeChat-style sticker bubble: chromeless, compact, no photo-bubble chrome. */
export function StickerBubble({ sticker }: { sticker: { uri: string; name: string } }) {
  const colors = useColors();
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <View style={{ padding: 12, alignItems: "center", maxWidth: 160 }}>
        <TText style={{ color: colors.muted, fontSize: 12, textAlign: "center" }}>
          {t("sticker.loadFailed")}
        </TText>
      </View>
    );
  }
  return (
    <Image
      source={{ uri: sticker.uri }}
      accessibilityLabel={sticker.name}
      onError={() => setFailed(true)}
      style={{ width: 140, height: 140 }}
      resizeMode="contain"
    />
  );
}

/** WeChat-style sticker picker panel (pack tabs + grid). */
export function StickerPanel({
  onPick,
  onManage,
}: {
  onPick: (sticker: ResolvedSticker) => void;
  onManage: () => void;
}) {
  const colors = useColors();
  const [packs, setPacks] = useState<StickerPack[]>([]);
  const [activeId, setActiveId] = useState<string>(AI_PACK_ID);
  const [stickers, setStickers] = useState<ResolvedSticker[]>([]);

  const refresh = useCallback(async () => {
    await ensureAiPackSeeded();
    const ps = await stickerStore.listPacks();
    setPacks(ps);
    const active = ps.some((p) => p.id === activeId) ? activeId : ps[0]?.id;
    if (active) {
      setActiveId(active);
      setStickers(await resolveStickers(active));
    }
  }, [activeId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const switchPack = (id: string) => {
    setActiveId(id);
    void resolveStickers(id).then(setStickers);
  };

  return (
    <View
      style={{
        height: 300,
        borderTopWidth: 1,
        borderTopColor: colors.line,
        backgroundColor: colors.card,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 8 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", paddingVertical: 8 }}>
            {packs.map((p) => {
              const selected = p.id === activeId;
              return (
                <Pressable
                  key={p.id}
                  accessibilityRole="button"
                  onPress={() => switchPack(p.id)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 14,
                    marginRight: 6,
                    backgroundColor: selected ? colors.blue : "transparent",
                  }}
                >
                  <TText
                    style={{
                      fontSize: 13,
                      fontWeight: selected ? "600" : "400",
                      color: selected ? colors.onBlue : colors.text,
                    }}
                  >
                    {p.owner === "ai" ? t("sticker.aiPack") : p.name}
                  </TText>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("sticker.manage")}
          onPress={onManage}
          style={{ padding: 10 }}
        >
          <Settings2 size={20} color={colors.muted} />
        </Pressable>
      </View>
      {stickers.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
          <TText style={{ color: colors.muted, fontSize: 13, textAlign: "center" }}>
            {t("sticker.empty")}
          </TText>
          <Button small onPress={onManage} style={{ marginTop: 10 }}>
            {t("sticker.addSticker")}
          </Button>
        </View>
      ) : (
        <FlatList
          data={stickers}
          keyExtractor={(s) => s.id}
          numColumns={4}
          contentContainerStyle={{ padding: 8 }}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.name}
              onPress={() => onPick(item)}
              style={{ flex: 1 / 4, aspectRatio: 1, padding: 6 }}
            >
              <Image
                source={{ uri: item.uri }}
                style={{ width: "100%", height: "100%", borderRadius: 8 }}
                resizeMode="contain"
              />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

/** Pack management modal: packs + stickers, all hers to arrange. */
export function StickerManager({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const colors = useColors();
  const [packs, setPacks] = useState<StickerPack[]>([]);
  const [openPackId, setOpenPackId] = useState<string | null>(null);
  const [stickers, setStickers] = useState<ResolvedSticker[]>([]);
  const [newPackName, setNewPackName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  const refresh = useCallback(async () => {
    await ensureAiPackSeeded();
    const ps = await stickerStore.listPacks();
    setPacks(ps);
    if (openPackId) setStickers(await resolveStickers(openPackId));
  }, [openPackId]);

  useEffect(() => {
    if (visible) void refresh();
  }, [visible, refresh]);

  const openPack = (id: string) => {
    const next = openPackId === id ? null : id;
    setOpenPackId(next);
    if (next) void resolveStickers(next).then(setStickers);
  };

  const createPack = async () => {
    const { pack, error } = await stickerStore.createPack(newPackName);
    if (error || !pack) {
      Alert.alert(
        t("sticker.title"),
        t(`sticker.error.${error ?? "unknown"}` as Parameters<typeof t>[0]),
      );
      return;
    }
    setNewPackName("");
    void refresh();
  };

  const doRename = async (pack: StickerPack) => {
    const err = await stickerStore.renamePack(pack.id, renameText);
    if (err) {
      Alert.alert(t("sticker.title"), t(`sticker.error.${err}` as Parameters<typeof t>[0]));
      return;
    }
    setRenamingId(null);
    void refresh();
  };

  const doDeletePack = (pack: StickerPack) => {
    void (async () => {
      const n = (await stickerStore.listStickers(pack.id)).length;
      Alert.alert(t("sticker.deletePack"), t("sticker.deletePackConfirm", { name: pack.name, n }), [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: () =>
            void (async () => {
              const err = await stickerStore.deletePack(pack.id);
              if (err) {
                Alert.alert(
                  t("sticker.title"),
                  t(`sticker.error.${err}` as Parameters<typeof t>[0]),
                );
                return;
              }
              await deletePackFiles(pack.id);
              if (openPackId === pack.id) setOpenPackId(null);
              void refresh();
            })(),
        },
      ]);
    })();
  };

  const addSticker = async (pack: StickerPack) => {
    const src = await pickLibraryImage();
    if (!src) return;
    try {
      const fileName = await addStickerFile(pack.id, src);
      const base = src.split("/").pop()?.split(".")[0] ?? "sticker";
      const { sticker, error } = await stickerStore.addSticker(pack.id, {
        name: base.slice(0, 40) || "sticker",
        fileName,
      });
      if (error || !sticker) {
        await deleteStickerFile(pack.id, fileName);
        Alert.alert(
          t("sticker.title"),
          t(`sticker.error.${error ?? "unknown"}` as Parameters<typeof t>[0]),
        );
        return;
      }
      void refresh();
    } catch {
      Alert.alert(t("sticker.title"), t("sticker.addFailed"));
    }
  };

  const removeSticker = (pack: StickerPack, s: ResolvedSticker) => {
    Alert.alert(t("sticker.removeSticker"), t("sticker.removeStickerConfirm", { name: s.name }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () =>
          void (async () => {
            const err = await stickerStore.removeSticker(pack.id, s.id);
            if (!err) await deleteStickerFile(pack.id, s.fileName);
            void refresh();
          })(),
      },
    ]);
  };

  const inputStyle = {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    padding: 10,
    color: colors.text,
    marginBottom: 12,
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.canvas, paddingTop: 60 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 16,
            marginBottom: 8,
          }}
        >
          <TText style={{ flex: 1, fontSize: 18, fontWeight: "700", color: colors.text }}>
            {t("sticker.manageTitle")}
          </TText>
          <Pressable accessibilityRole="button" onPress={onClose} style={{ padding: 8 }}>
            <X size={22} color={colors.text} />
          </Pressable>
        </View>
        <TText
          style={{ paddingHorizontal: 16, marginBottom: 8, fontSize: 12, color: colors.muted }}
        >
          {t("sticker.localOnlyHint")}
        </TText>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
          <SectionHeading title={t("sticker.createPack")} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              value={newPackName}
              onChangeText={setNewPackName}
              placeholder={t("sticker.packNamePlaceholder")}
              placeholderTextColor={colors.muted}
              style={[inputStyle, { flex: 1, marginBottom: 0 }]}
            />
            <Button onPress={() => void createPack()}>
              <Plus size={16} color={colors.onBlue} />
            </Button>
          </View>

          {packs.map((pack) => {
            const isAi = pack.id === AI_PACK_ID;
            const open = openPackId === pack.id;
            return (
              <Card key={pack.id} style={{ marginTop: 12, padding: 12 }}>
                <Pressable onPress={() => openPack(pack.id)}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <TText style={{ flex: 1, fontWeight: "600", color: colors.text }}>
                      {isAi ? t("sticker.aiPack") : pack.name}
                    </TText>
                    {!isAi && (
                      <>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t("sticker.rename")}
                          onPress={() => {
                            setRenamingId(pack.id);
                            setRenameText(pack.name);
                          }}
                          style={{ padding: 8 }}
                        >
                          <Pencil size={16} color={colors.muted} />
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t("sticker.deletePack")}
                          onPress={() => doDeletePack(pack)}
                          style={{ padding: 8 }}
                        >
                          <Trash2 size={16} color={colors.muted} />
                        </Pressable>
                      </>
                    )}
                  </View>
                </Pressable>
                {renamingId === pack.id && (
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                    <TextInput
                      value={renameText}
                      onChangeText={setRenameText}
                      placeholderTextColor={colors.muted}
                      style={[inputStyle, { flex: 1, marginBottom: 0 }]}
                    />
                    <Button small onPress={() => void doRename(pack)}>
                      {t("common.save")}
                    </Button>
                  </View>
                )}
                {open && (
                  <View style={{ marginTop: 8 }}>
                    <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                      {stickers.map((s) => (
                        <View key={s.id} style={{ width: "25%", aspectRatio: 1, padding: 4 }}>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t("sticker.removeSticker")}
                            onLongPress={() => removeSticker(pack, s)}
                            style={{ flex: 1 }}
                          >
                            <Image
                              source={{ uri: s.uri }}
                              style={{ width: "100%", height: "100%", borderRadius: 8 }}
                              resizeMode="contain"
                            />
                          </Pressable>
                        </View>
                      ))}
                    </View>
                    <Button small onPress={() => void addSticker(pack)} style={{ marginTop: 8 }}>
                      {t("sticker.addSticker")}
                    </Button>
                    <TText style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>
                      {t("sticker.removeHint")}
                    </TText>
                  </View>
                )}
              </Card>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}
