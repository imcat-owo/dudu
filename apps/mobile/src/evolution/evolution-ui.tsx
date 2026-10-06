/**
 * Personality evolution （性格进化） — management UI for Our Space.
 *
 * Shows what the AI has learned about being with her: every evolution
 * note for the active persona (content + source citation), each editable
 * and deletable. Master toggle + reset-to-card-baseline. Nothing evolves
 * secretly: this list is the whole record.
 */

import { Pencil, RotateCcw, Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, Pressable, Switch, TextInput, View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { personaStore } from "../persona/stores";
import { radii } from "../theme/radii";
import { Card, useColors, useStyles } from "../ui";
import { evolutionStore } from "./instances";
import type { EvolutionNote } from "./types";

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
  });
}

export function EvolutionSection() {
  const colors = useColors();
  const s = useStyles();
  const [notes, setNotes] = useState<EvolutionNote[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [personaId, setPersonaId] = useState<string | null>(null);
  const [personaName, setPersonaName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  const refresh = () => {
    void (async () => {
      try {
        const pid = await personaStore.getActiveId().catch(() => null);
        setPersonaId(pid);
        if (pid) {
          const p = await personaStore.get(pid).catch(() => null);
          setPersonaName(p?.name ?? "");
          setNotes(await evolutionStore.list(pid));
        } else {
          setNotes([]);
        }
        setEnabled(await evolutionStore.isEnabled());
      } catch {
        // ignore — UI shows what it can
      }
    })();
  };

  useEffect(() => {
    refresh();
  }, []);

  const toggle = (on: boolean) => {
    setEnabled(on);
    void evolutionStore.setEnabled(on).catch(() => {});
  };

  const doDelete = (note: EvolutionNote) =>
    Alert.alert(t("evolution.actions.delete") as string, `「${note.content}」`, [
      { text: t("common.cancel") as string, style: "cancel" },
      {
        text: t("common.delete") as string,
        style: "destructive",
        onPress: () =>
          void evolutionStore
            .remove(note.id)
            .catch(() => {})
            .finally(refresh),
      },
    ]);

  const doReset = () =>
    Alert.alert(
      t("evolution.actions.resetTitle") as string,
      t("evolution.actions.resetBody") as string,
      [
        { text: t("common.cancel") as string, style: "cancel" },
        {
          text: t("common.delete") as string,
          style: "destructive",
          onPress: () =>
            void (async () => {
              try {
                if (personaId) await evolutionStore.reset(personaId);
              } catch {
                // ignore
              } finally {
                refresh();
              }
            })(),
        },
      ],
    );

  const startEdit = (note: EvolutionNote) => {
    setEditingId(note.id);
    setEditingText(note.content);
  };

  const saveEdit = (note: EvolutionNote) => {
    const text = editingText.trim();
    if (!text) {
      setEditingId(null);
      return;
    }
    void evolutionStore
      .edit(note.id, { content: text })
      .catch(() => {})
      .finally(() => {
        setEditingId(null);
        refresh();
      });
  };

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1 }}>
          <TText style={{ fontWeight: "700", fontSize: 16 }}>{t("evolution.section.title")}</TText>
          <TText style={[s.small, { color: colors.muted, marginTop: 4 }]}>
            {t("evolution.section.desc")}
          </TText>
        </View>
        <Switch value={enabled} onValueChange={toggle} />
      </View>

      {personaName ? (
        <TText style={[s.small, { color: colors.muted, marginTop: 8 }]}>
          {t("evolution.section.persona")}
          {personaName}
        </TText>
      ) : null}

      {notes.length === 0 ? (
        <TText style={[s.small, { color: colors.muted, marginTop: 12 }]}>
          {t("evolution.list.empty")}
        </TText>
      ) : (
        <View style={{ marginTop: 8, gap: 4 }}>
          {notes.map((note) => (
            <View
              key={note.id}
              style={{
                paddingVertical: 8,
                borderBottomWidth: 1,
                borderBottomColor: colors.line,
              }}
            >
              {editingId === note.id ? (
                <View>
                  <TextInput
                    value={editingText}
                    onChangeText={setEditingText}
                    multiline
                    style={{
                      color: colors.text,
                      fontSize: 14,
                      borderWidth: 1,
                      borderColor: colors.line,
                      borderRadius: radii.sm,
                      padding: 8,
                    }}
                  />
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "flex-end",
                      marginTop: 6,
                      gap: 8,
                    }}
                  >
                    <Pressable
                      onPress={() => setEditingId(null)}
                      style={{ padding: 6, borderRadius: radii.sm }}
                    >
                      <TText style={[s.small, { color: colors.muted }]}>{t("common.cancel")}</TText>
                    </Pressable>
                    <Pressable
                      onPress={() => saveEdit(note)}
                      style={{
                        paddingVertical: 6,
                        paddingHorizontal: 12,
                        borderRadius: radii.sm,
                        backgroundColor: colors.blue,
                      }}
                    >
                      <TText style={[s.small, { color: "#fff" }]}>{t("common.save")}</TText>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <TText style={{ fontSize: 14, fontWeight: "600" }}>{note.content}</TText>
                    <TText style={[s.small, { color: colors.muted, marginTop: 2 }]}>
                      {fmtDate(note.source.dateMs)} ·{" "}
                      {note.source.kind === "manual"
                        ? t("evolution.item.fromHer")
                        : note.source.ref}
                    </TText>
                  </View>
                  <View style={{ flexDirection: "row" }}>
                    <Pressable
                      accessibilityLabel={t("evolution.actions.edit") as string}
                      onPress={() => startEdit(note)}
                      style={{ padding: 8, borderRadius: radii.sm }}
                    >
                      <Pencil size={16} color={colors.muted} />
                    </Pressable>
                    <Pressable
                      accessibilityLabel={t("evolution.actions.delete") as string}
                      onPress={() => doDelete(note)}
                      style={{ padding: 8, borderRadius: radii.sm }}
                    >
                      <Trash2 size={16} color={colors.muted} />
                    </Pressable>
                  </View>
                </View>
              )}
            </View>
          ))}
        </View>
      )}

      <Pressable
        onPress={doReset}
        style={{
          marginTop: 12,
          padding: 8,
          borderRadius: radii.sm,
          borderWidth: 1,
          borderColor: colors.line,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <RotateCcw size={14} color={colors.muted} />
        <TText style={[s.small, { color: colors.muted, marginLeft: 6 }]}>
          {t("evolution.actions.reset")}
        </TText>
      </Pressable>
    </Card>
  );
}
