/**
 * Outfit / dress-up system （换装系统） — wardrobe UI for the persona
 * editor. Sora gray, compact, lucide icons, zero emoji.
 *
 * Shows one persona's wardrobe: every outfit, which one is worn, wear /
 * delete per item, and an add form. Her look changes flow into the next
 * generated photos (prompt-level — see manuals/outfit.ts); the static
 * avatar is not redrawn.
 */

import { Check, Shirt, Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { radii } from "../theme/radii";
import { Button, useColors, useStyles } from "../ui";
import { outfitStore } from "./instances";
import type { Wardrobe } from "./types";
import { OUTFIT_DESCRIPTION_MAX, OUTFIT_NAME_MAX } from "./types";

export function WardrobeSection({ personaId }: { personaId: string }) {
  const colors = useColors();
  const s = useStyles();
  const [wardrobe, setWardrobe] = useState<Wardrobe>({ outfits: [], activeId: null });
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const refresh = () => {
    void outfitStore
      .getWardrobe(personaId)
      .then(setWardrobe)
      .catch(() => {});
  };

  useEffect(refresh, [personaId]);

  const wear = (outfitId: string | null) => {
    void (async () => {
      try {
        await outfitStore.setActive(personaId, outfitId);
      } catch {
        // ignore — refresh shows the truth
      } finally {
        refresh();
      }
    })();
  };

  const doDelete = (outfit: { id: string; name: string }) =>
    Alert.alert(t("outfit.actions.delete") as string, `「${outfit.name}」`, [
      { text: t("common.cancel") as string, style: "cancel" },
      {
        text: t("common.delete") as string,
        style: "destructive",
        onPress: () =>
          void (async () => {
            try {
              await outfitStore.remove(personaId, outfit.id);
            } catch {
              // ignore
            } finally {
              refresh();
            }
          })(),
      },
    ]);

  const doAdd = () => {
    const n = name.trim();
    const d = description.trim();
    if (!n || !d) return;
    if (n.length > OUTFIT_NAME_MAX || d.length > OUTFIT_DESCRIPTION_MAX) return;
    void (async () => {
      try {
        await outfitStore.add(personaId, { name: n, description: d, createdBy: "her" });
        setName("");
        setDescription("");
      } catch {
        // ignore
      } finally {
        refresh();
      }
    })();
  };

  const inputStyle = {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    padding: 10,
    color: colors.text,
    marginBottom: 8,
  };

  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
        <Shirt size={16} color={colors.muted} />
        <TText style={{ fontWeight: "700", fontSize: 15, marginLeft: 6 }}>
          {t("outfit.section.title")}
        </TText>
      </View>
      <TText style={[s.small, { color: colors.muted, marginBottom: 8 }]}>
        {t("outfit.section.desc")}
      </TText>

      {wardrobe.outfits.length === 0 ? (
        <TText style={[s.small, { color: colors.muted, marginBottom: 8 }]}>
          {t("outfit.list.empty")}
        </TText>
      ) : (
        <View style={{ marginBottom: 8 }}>
          {wardrobe.outfits.map((o) => {
            const active = wardrobe.activeId === o.id;
            return (
              <View
                key={o.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingVertical: 8,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.line,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={t("outfit.actions.setActive") as string}
                  onPress={() => wear(active ? null : o.id)}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: active ? colors.text : colors.line,
                    backgroundColor: active ? colors.text : "transparent",
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: 10,
                  }}
                >
                  {active ? <Check size={14} color={colors.card} /> : null}
                </Pressable>
                <View style={{ flex: 1 }}>
                  <TText style={{ fontSize: 14, fontWeight: active ? "700" : "400" }}>
                    {o.name}
                    {active ? ` · ${t("outfit.item.wearing")}` : ""}
                  </TText>
                  <TText style={[s.small, { color: colors.muted, marginTop: 2 }]} numberOfLines={2}>
                    {o.description}
                  </TText>
                </View>
                <Pressable
                  accessibilityLabel={t("outfit.actions.delete") as string}
                  onPress={() => doDelete(o)}
                  style={{ padding: 8 }}
                >
                  <Trash2 size={16} color={colors.muted} />
                </Pressable>
              </View>
            );
          })}
        </View>
      )}

      <TextInput
        value={name}
        onChangeText={setName}
        placeholder={t("outfit.add.namePlaceholder") as string}
        maxLength={OUTFIT_NAME_MAX}
        style={inputStyle}
      />
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder={t("outfit.add.descPlaceholder") as string}
        maxLength={OUTFIT_DESCRIPTION_MAX}
        multiline
        numberOfLines={2}
        style={[inputStyle, { minHeight: 56, textAlignVertical: "top" }]}
      />
      <Button onPress={doAdd}>{t("outfit.add.submit")}</Button>
    </View>
  );
}
