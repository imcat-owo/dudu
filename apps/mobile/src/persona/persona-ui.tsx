/**
 * Persona UI — list, editor, tags, world books, GLOBAL.md.
 * Sora gray, compact, lucide icons, zero emoji.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Switch, TextInput, View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { Button, SectionHeading, useColors } from "../ui";
import { createGlobalMdStore } from "./global-md";
import { createPersonaStore } from "./store";
import { blankPersona, type Persona, type PersonaTag } from "./types";
import { createWorldBookStore } from "./world-book-store";
import { blankWorldBook, type WorldBook } from "./world-book";
import { CharaExportButton, CharaExtrasSection, CharaImportRow } from "../chara/chara-ui";

const personaStore = createPersonaStore(AsyncStorage);
const worldBookStore = createWorldBookStore(AsyncStorage);
const globalMdStore = createGlobalMdStore(AsyncStorage);

/** Small tag chip. Pressable when onPress is given, static otherwise. */
function TagChip({
  tag,
  selected,
  onPress,
}: {
  tag: PersonaTag;
  selected?: boolean;
  onPress?: () => void;
}) {
  const colors = useColors();
  const accent = tag.color ?? colors.blue;
  const body = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        borderWidth: selected ? 2 : 1,
        borderColor: accent,
        marginRight: 6,
        marginBottom: 6,
      }}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: accent,
          marginRight: 6,
        }}
      />
      <TText style={{ color: colors.text, fontSize: 12, fontWeight: selected ? "600" : "400" }}>
        {tag.name}
      </TText>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!selected }}>
      {body}
    </Pressable>
  );
}

/** Resolve a persona's tagIds to tag objects (drops stale ids). */
function resolvePersonaTags(p: Persona, tagsById: Map<string, PersonaTag>): PersonaTag[] {
  const out: PersonaTag[] = [];
  for (const id of p.tagIds) {
    const tag = tagsById.get(id);
    if (tag) out.push(tag);
  }
  return out;
}

export function PersonaSection() {
  const colors = useColors();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [tags, setTags] = useState<PersonaTag[]>([]);
  const [editing, setEditing] = useState<Persona | null>(null);
  const [books, setBooks] = useState<WorldBook[]>([]);
  const [globalMd, setGlobalMd] = useState("");
  const [filterTagId, setFilterTagId] = useState<string | null>(null);

  const refresh = () => {
    void personaStore.list().then(setPersonas);
    void personaStore.listTags().then(setTags);
    void worldBookStore.list().then(setBooks);
    void globalMdStore.get().then(setGlobalMd);
  };

  useEffect(refresh, []);

  const tagsById = useMemo(() => {
    const m = new Map<string, PersonaTag>();
    for (const tag of tags) m.set(tag.id, tag);
    return m;
  }, [tags]);

  const visiblePersonas = useMemo(
    () =>
      filterTagId ? personas.filter((p) => p.tagIds.includes(filterTagId)) : personas,
    [personas, filterTagId],
  );

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
    return (
      <PersonaEditor
        persona={editing}
        tags={tags}
        onSave={savePersona}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <ScrollView>
      <SectionHeading title={t("persona.title")} />
      {tags.length > 0 && (
        <View style={{ marginBottom: 8 }}>
          <TText style={{ color: colors.muted, fontSize: 12, marginBottom: 6 }}>
            {t("persona.tags.filterBy")}
          </TText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <TagChip
              tag={{ id: "", name: t("persona.tags.filterAll"), createdAt: 0 }}
              selected={filterTagId === null}
              onPress={() => setFilterTagId(null)}
            />
            {tags.map((tag) => (
              <TagChip
                key={tag.id}
                tag={tag}
                selected={filterTagId === tag.id}
                onPress={() => setFilterTagId(filterTagId === tag.id ? null : tag.id)}
              />
            ))}
          </ScrollView>
        </View>
      )}
      {visiblePersonas.length === 0 && (
        <TText style={{ color: colors.muted }}>
          {filterTagId ? t("persona.tags.noMatch") : t("persona.noPersonas")}
        </TText>
      )}
      {visiblePersonas.map((p) => {
        const pTags = resolvePersonaTags(p, tagsById);
        return (
          <View key={p.id} style={{ padding: 12, borderBottomWidth: 1, borderColor: colors.line }}>
            <TText style={{ fontWeight: "600" }}>{p.name}</TText>
            {p.description ? <TText style={{ color: colors.muted }}>{p.description}</TText> : null}
            {pTags.length > 0 && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 6 }}>
                {pTags.map((tag) => (
                  <TagChip key={tag.id} tag={tag} />
                ))}
              </View>
            )}
            <View style={{ flexDirection: "row", marginTop: 8, gap: 8 }}>
              <Button onPress={() => setEditing(p)}>{t("common.edit")}</Button>
              <CharaExportButton persona={p} />
              <Button onPress={() => deletePersona(p)}>{t("persona.delete")}</Button>
            </View>
          </View>
        );
      })}
      <Button onPress={() => setEditing(personaStore.blank())}>{t("persona.create")}</Button>
      <CharaImportRow onImported={refresh} />

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
  tags,
  onSave,
  onCancel,
}: {
  persona: Persona;
  tags: PersonaTag[];
  onSave: (p: Persona) => void;
  onCancel: () => void;
}) {
  const colors = useColors();
  const [p, setP] = useState<Persona>(persona);
  const set = (patch: Partial<Persona>) => setP({ ...p, ...patch });

  const toggleTag = (tagId: string) => {
    const has = p.tagIds.includes(tagId);
    set({ tagIds: has ? p.tagIds.filter((id) => id !== tagId) : [...p.tagIds, tagId] });
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

      {tags.length > 0 && (
        <View style={{ marginBottom: 12 }}>
          <TText style={{ marginBottom: 6 }}>{t("persona.tags.pick")}</TText>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {tags.map((tag) => (
              <TagChip
                key={tag.id}
                tag={tag}
                selected={p.tagIds.includes(tag.id)}
                onPress={() => toggleTag(tag.id)}
              />
            ))}
          </View>
        </View>
      )}

      <CharaExtrasSection persona={p} />

      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
        <Button onPress={() => onSave(p)}>{t("common.save")}</Button>
        <Button onPress={onCancel}>{t("common.cancel")}</Button>
      </View>
    </ScrollView>
  );
}
