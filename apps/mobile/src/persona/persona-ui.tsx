/**
 * Persona UI — list, editor, tags, world books, GLOBAL.md.
 * Sora gray, compact, lucide icons, zero emoji.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { Alert, ScrollView, Switch, TextInput, View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { Button, SectionHeading, useColors } from "../ui";
import { createGlobalMdStore } from "./global-md";
import { createPersonaStore } from "./store";
import { blankPersona, type Persona, type PersonaTag } from "./types";
import { createWorldBookStore } from "./world-book-store";
import { blankWorldBook, type WorldBook } from "./world-book";

const personaStore = createPersonaStore(AsyncStorage);
const worldBookStore = createWorldBookStore(AsyncStorage);
const globalMdStore = createGlobalMdStore(AsyncStorage);

export function PersonaSection() {
  const colors = useColors();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [tags, setTags] = useState<PersonaTag[]>([]);
  const [editing, setEditing] = useState<Persona | null>(null);
  const [books, setBooks] = useState<WorldBook[]>([]);
  const [globalMd, setGlobalMd] = useState("");

  const refresh = () => {
    void personaStore.list().then(setPersonas);
    void personaStore.listTags().then(setTags);
    void worldBookStore.list().then(setBooks);
    void globalMdStore.get().then(setGlobalMd);
  };

  useEffect(refresh, []);

  const savePersona = async (p: Persona) => {
    const err = await personaStore.upsert(p);
    if (err) {
      Alert.alert(t("common.error"), t(`persona.error.${err}` as Parameters<typeof t>[0]));
      return;
    }
    setEditing(null);
    refresh();
  };

  const deletePersona = (p: Persona) => {
    Alert.alert(t("persona.delete"), t("persona.deleteConfirm", { name: p.name }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () => void personaStore.remove(p.id).then(refresh),
      },
    ]);
  };

  if (editing) {
    return <PersonaEditor persona={editing} onSave={savePersona} onCancel={() => setEditing(null)} />;
  }

  return (
    <ScrollView>
      <SectionHeading title={t("persona.title")} />
      {personas.length === 0 && <TText style={{ color: colors.muted }}>{t("persona.noPersonas")}</TText>}
      {personas.map((p) => (
        <View key={p.id} style={{ padding: 12, borderBottomWidth: 1, borderColor: colors.line }}>
          <TText style={{ fontWeight: "600" }}>{p.name}</TText>
          {p.description ? <TText style={{ color: colors.muted }}>{p.description}</TText> : null}
          <View style={{ flexDirection: "row", marginTop: 8, gap: 8 }}>
            <Button onPress={() => setEditing(p)}>{t("common.edit")}</Button>
            <Button onPress={() => deletePersona(p)}>{t("persona.delete")}</Button>
          </View>
        </View>
      ))}
      <Button onPress={() => setEditing(personaStore.blank())}>{t("persona.create")}</Button>

      <SectionHeading title={t("persona.tags")} />
      <TagManager tags={tags} onRefresh={refresh} />

      <SectionHeading title={t("worldbook.title")} />
      {books.length === 0 && <TText style={{ color: colors.muted }}>{t("worldbook.noBooks")}</TText>}
      {books.map((b) => (
        <View key={b.id} style={{ padding: 12, borderBottomWidth: 1, borderColor: colors.line }}>
          <TText style={{ fontWeight: "600" }}>{b.name}</TText>
          <TText style={{ color: colors.muted }}>
            {b.entries.length} {t("worldbook.entries")}
          </TText>
        </View>
      ))}
      <Button
        onPress={() => {
          const b = worldBookStore.blank();
          b.name = t("worldbook.create");
          void worldBookStore.upsert(b).then(refresh);
        }}
      >
        {t("worldbook.create")}
      </Button>

      <SectionHeading title={t("globalmd.title")} />
      <TText style={{ color: colors.muted, marginBottom: 8 }}>{t("globalmd.hint")}</TText>
      <TextInput
        value={globalMd}
        onChangeText={setGlobalMd}
        placeholder={t("globalmd.placeholder")}
        multiline
        numberOfLines={6}
        style={{
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: 8,
          padding: 12,
          color: colors.text,
          minHeight: 120,
          textAlignVertical: "top",
        }}
      />
      <Button onPress={() => void globalMdStore.set(globalMd).then(() => Alert.alert(t("globalmd.saved")))}>
        {t("common.save")}
      </Button>
    </ScrollView>
  );
}

function TagManager({ tags, onRefresh }: { tags: PersonaTag[]; onRefresh: () => void }) {
  const colors = useColors();
  const [name, setName] = useState("");
  return (
    <View>
      {tags.map((tag) => (
        <View key={tag.id} style={{ flexDirection: "row", alignItems: "center", padding: 8 }}>
          <View
            style={{
              width: 12,
              height: 12,
              borderRadius: 6,
              backgroundColor: tag.color ?? colors.blue,
              marginRight: 8,
            }}
          />
          <TText style={{ flex: 1 }}>{tag.name}</TText>
          <Button
            onPress={() =>
              Alert.alert(t("persona.tags.manage"), t("persona.tags.deleteConfirm"), [
                { text: t("common.cancel"), style: "cancel" },
                {
                  text: t("common.delete"),
                  style: "destructive",
                  onPress: () => void personaStore.removeTag(tag.id).then(onRefresh),
                },
              ])
            }
          >
            {t("common.delete")}
          </Button>
        </View>
      ))}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={t("persona.tags.namePlaceholder")}
          style={{
            flex: 1,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: 8,
            padding: 8,
            color: colors.text,
          }}
        />
        <Button
          onPress={() => {
            if (!name.trim()) return;
            void personaStore.createTag(name).then(() => {
              setName("");
              onRefresh();
            });
          }}
        >
          {t("persona.tags.create")}
        </Button>
      </View>
    </View>
  );
}

function PersonaEditor({
  persona,
  onSave,
  onCancel,
}: {
  persona: Persona;
  onSave: (p: Persona) => void;
  onCancel: () => void;
}) {
  const colors = useColors();
  const [p, setP] = useState<Persona>(persona);
  const set = (patch: Partial<Persona>) => setP({ ...p, ...patch });

  const inputStyle = {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    padding: 10,
    color: colors.text,
    marginBottom: 12,
  };

  return (
    <ScrollView>
      <SectionHeading title={t("persona.edit")} />

      <TText>{t("persona.name")}</TText>
      <TextInput value={p.name} onChangeText={(v) => set({ name: v })} placeholder={t("persona.namePlaceholder")} style={inputStyle} />

      <TText>{t("persona.description")}</TText>
      <TextInput
        value={p.description}
        onChangeText={(v) => set({ description: v })}
        placeholder={t("persona.descriptionPlaceholder")}
        style={inputStyle}
      />

      <TText>{t("persona.systemPrompt")}</TText>
      <TextInput
        value={p.systemPrompt}
        onChangeText={(v) => set({ systemPrompt: v })}
        placeholder={t("persona.systemPromptPlaceholder")}
        multiline
        numberOfLines={4}
        style={[inputStyle, { minHeight: 100, textAlignVertical: "top" }]}
      />

      <TText>{t("persona.greeting")}</TText>
      <TextInput
        value={p.greeting}
        onChangeText={(v) => set({ greeting: v })}
        placeholder={t("persona.greetingPlaceholder")}
        style={inputStyle}
      />

      <TText>{t("persona.personality")}</TText>
      <TextInput
        value={p.personality}
        onChangeText={(v) => set({ personality: v })}
        placeholder={t("persona.personalityPlaceholder")}
        multiline
        numberOfLines={3}
        style={[inputStyle, { minHeight: 80, textAlignVertical: "top" }]}
      />

      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
        <TText style={{ flex: 1 }}>{t("persona.enabled")}</TText>
        <Switch value={p.enabled} onValueChange={(v) => set({ enabled: v })} />
      </View>

      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
        <Button onPress={() => onSave(p)}>{t("common.save")}</Button>
        <Button onPress={onCancel}>{t("common.cancel")}</Button>
      </View>
    </ScrollView>
  );
}
