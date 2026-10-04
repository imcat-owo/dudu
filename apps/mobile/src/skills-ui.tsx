/**
 * Skills (本事包） — settings UI.
 *
 * She writes capability packs for the AI: name + description + instructions.
 * List view with enable/disable toggle, tap to edit, create new, delete.
 * The AI can also create/update skills via tools — the store subscription
 * keeps this UI live.
 *
 * Sora gray, compact refined type, lucide icons only. Zero emoji.
 */

import { Pencil, Plus, Sparkles, Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Switch, TextInput, TouchableOpacity, View } from "react-native";
import { TText } from "./font";
import { t } from "./i18n";
import { skillStore } from "./skills/instance";
import type { Skill } from "./skills/store";
import { SoraAmbient } from "./sora-ambient";
import { Button, Sheet, useColors, useStyles } from "./ui";

function IconBtn({ onPress, children }: { onPress: () => void; children: React.ReactNode }) {
  return (
    <TouchableOpacity onPress={onPress} style={{ padding: 6 }}>
      {children}
    </TouchableOpacity>
  );
}

function SkillRow({
  skill,
  onEdit,
  onToggle,
  onDelete,
}: {
  skill: Skill;
  onEdit: () => void;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
}) {
  const colors = useColors();
  const s = useStyles();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: colors.line,
        gap: 10,
      }}
    >
      <Sparkles size={18} color={skill.enabled ? colors.blueDark : colors.muted} />
      <View style={{ flex: 1 }}>
        <TText style={[s.text, { fontWeight: "600" }]}>
          {skill.name}
          {skill.isExample ? ` · ${t("skill.example")}` : ""}
        </TText>
        {!!skill.description && (
          <TText style={s.small} numberOfLines={2}>
            {skill.description}
          </TText>
        )}
      </View>
      <Switch value={skill.enabled} onValueChange={onToggle} />
      <IconBtn onPress={onEdit}>
        <Pencil size={16} color={colors.muted} />
      </IconBtn>
      <IconBtn
        onPress={() =>
          Alert.alert(t("skill.deleteTitle"), t("skill.deleteConfirm", { name: skill.name }), [
            { text: t("common.cancel"), style: "cancel" },
            { text: t("common.delete"), style: "destructive", onPress: onDelete },
          ])
        }
      >
        <Trash2 size={16} color={colors.muted} />
      </IconBtn>
    </View>
  );
}

function SkillEditor({
  skill,
  onSave,
  onCancel,
}: {
  skill: Skill | null;
  onSave: (input: { name: string; description: string; instructions: string }) => void;
  onCancel: () => void;
}) {
  const colors = useColors();
  const s = useStyles();
  const [name, setName] = useState(skill?.name ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [instructions, setInstructions] = useState(skill?.instructions ?? "");
  return (
    <View>
      <TText style={[s.small, { marginBottom: 4 }]}>{t("skill.name")}</TText>
      <TextInput
        style={s.input}
        value={name}
        onChangeText={setName}
        placeholder={t("skill.nameHint")}
        placeholderTextColor={colors.muted}
        maxLength={40}
      />
      <TText style={[s.small, { marginBottom: 4, marginTop: 10 }]}>{t("skill.description")}</TText>
      <TextInput
        style={s.input}
        value={description}
        onChangeText={setDescription}
        placeholder={t("skill.descriptionHint")}
        placeholderTextColor={colors.muted}
        maxLength={120}
      />
      <TText style={[s.small, { marginBottom: 4, marginTop: 10 }]}>{t("skill.instructions")}</TText>
      <TextInput
        style={[s.input, { minHeight: 140, textAlignVertical: "top" }]}
        value={instructions}
        onChangeText={setInstructions}
        placeholder={t("skill.instructionsHint")}
        placeholderTextColor={colors.muted}
        multiline
      />
      <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
        <Button
          primary
          onPress={() => {
            const n = name.trim();
            if (!n) {
              Alert.alert(t("skill.nameRequired"));
              return;
            }
            onSave({ name: n, description: description.trim(), instructions: instructions.trim() });
          }}
        >
          {t("common.save")}
        </Button>
        <Button onPress={onCancel}>{t("common.cancel")}</Button>
      </View>
    </View>
  );
}

export function SkillsSheet({ onClose }: { onClose: () => void }) {
  const colors = useColors();
  const s = useStyles();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Skill | null | "new">(null);

  const refresh = () => {
    skillStore
      .listSkills()
      .then(setSkills)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    return skillStore.subscribe(refresh);
  }, []);

  const handleSave = (input: { name: string; description: string; instructions: string }) => {
    if (editing === "new") {
      skillStore
        .createSkill({ ...input, createdBy: "her" })
        .then(() => setEditing(null))
        .catch((e) => Alert.alert(String(e instanceof Error ? e.message : e)));
    } else if (editing) {
      skillStore
        .updateSkill(editing.id, input)
        .then(() => setEditing(null))
        .catch((e) => Alert.alert(String(e instanceof Error ? e.message : e)));
    }
  };

  return (
    <Sheet title={t("skill.title")} onClose={onClose}>
      {loading ? (
        <ActivityIndicator color={colors.blueDark} />
      ) : editing !== null ? (
        <SkillEditor
          skill={editing === "new" ? null : editing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <View style={{ gap: 4 }}>
          <TText style={[s.small, { marginBottom: 8 }]}>{t("skill.intro")}</TText>
          {skills.length === 0 && (
            <View style={{ alignItems: "center", paddingVertical: 20 }}>
              <SoraAmbient video="idle" slot="skills" size={64} />
              <TText style={[s.small, { marginTop: 12, textAlign: "center" }]}>
                {t("skill.empty")}
              </TText>
            </View>
          )}
          {skills.map((sk) => (
            <SkillRow
              key={sk.id}
              skill={sk}
              onEdit={() => setEditing(sk)}
              onToggle={(enabled) => void skillStore.setEnabled(sk.id, enabled).then(refresh)}
              onDelete={() => void skillStore.deleteSkill(sk.id).then(refresh)}
            />
          ))}
          <View style={{ marginTop: 12 }}>
            <Button icon={Plus} onPress={() => setEditing("new")}>
              {t("skill.create")}
            </Button>
          </View>
        </View>
      )}
    </Sheet>
  );
}
