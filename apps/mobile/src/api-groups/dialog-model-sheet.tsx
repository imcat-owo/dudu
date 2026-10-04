/**
 * Per-dialog model switching UI (对话框内切换模型入口).
 *
 * The chat header shows a model chip: one tap opens a sheet listing her
 * API groups. Picking one sets a per-thread override (this conversation
 * only); "恢复默认" clears it back to the global active group. No settings
 * trip needed.
 */

import { Check, ChevronDown, RotateCcw, X } from "lucide-react-native";
import { useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { Chip, useColors, useStyles } from "../ui";
import { useDialogModelOverride } from "./dialog-model-override";
import { useChatMode } from "./mode";
import { useApiGroups } from "./store";

export function DialogModelChip({ threadId }: { threadId: string }) {
  const { groups, active } = useApiGroups();
  const { overrideGroupId, setOverride, clearOverride } = useDialogModelOverride(threadId);
  const mode = useChatMode();
  const s = useStyles();
  const colors = useColors();
  const [open, setOpen] = useState(false);

  if (mode !== "local") return null;
  const effective = groups.find((g) => g.id === overrideGroupId) ?? active;
  if (!effective) return null;
  const overridden = overrideGroupId !== null && overrideGroupId === effective.id;

  const pick = async (groupId: string | null) => {
    if (groupId) await setOverride(groupId);
    else await clearOverride();
    setOpen(false);
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("dialogmodel.title")}
        onPress={() => setOpen(true)}
      >
        <Chip>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            {overridden ? (
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: colors.blueDark,
                }}
              />
            ) : null}
            <TText style={s.small}>
              {t("chat.activeGroup", { name: effective.name, model: effective.model })}
            </TText>
            <ChevronDown size={12} color={colors.muted} />
          </View>
        </Chip>
      </Pressable>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: colors.canvas, paddingTop: 48 }}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              paddingHorizontal: 16,
              marginBottom: 4,
            }}
          >
            <TText style={{ fontSize: 18, fontWeight: "700" }}>{t("dialogmodel.title")}</TText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("dialogmodel.close")}
              onPress={() => setOpen(false)}
              style={{ padding: 8 }}
            >
              <X size={20} color={colors.text} />
            </Pressable>
          </View>
          <TText
            style={[s.small, { color: colors.muted, paddingHorizontal: 16, marginBottom: 12 }]}
          >
            {t("dialogmodel.subtitle")}
          </TText>
          <ScrollView style={{ paddingHorizontal: 16 }}>
            {/* Shown whenever an override id is stored — even a stale one
                pointing at a deleted group, so she can always clear it. */}
            {overrideGroupId !== null && active ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void pick(null)}
                style={{
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: colors.line,
                  backgroundColor: colors.card,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  padding: 14,
                  marginBottom: 8,
                }}
              >
                <RotateCcw size={16} color={colors.muted} />
                <View style={{ flex: 1 }}>
                  <TText style={{ fontWeight: "700" }}>
                    {t("dialogmodel.useDefault", { name: active.name })}
                  </TText>
                </View>
              </Pressable>
            ) : null}
            {groups.map((g) => {
              const isCurrent = g.id === effective.id;
              return (
                <Pressable
                  key={g.id}
                  accessibilityRole="button"
                  onPress={() => void pick(g.id)}
                  style={{
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: isCurrent ? colors.blueDark : colors.line,
                    backgroundColor: colors.card,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    padding: 14,
                    marginBottom: 8,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <TText style={{ fontWeight: "700" }}>{g.name}</TText>
                    <TText style={[s.small, { color: colors.muted }]}>{g.model}</TText>
                  </View>
                  {isCurrent ? <Check size={18} color={colors.blueDark} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}
