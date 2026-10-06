/**
 * Interactive story mode （互动故事） — management UI for Our Space.
 *
 * The visible story shelf: every story with its progress (chapter / scenes
 * / status), expandable to show the story bible (characters, places, key
 * events — the same bible the narration is held to), each bible entry
 * deletable. Pause / resume / end / delete per story. Nothing about the
 * story is hidden from her.
 */

import { BookOpen, Pause, Play, Square, Trash2, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { personaStore } from "../persona/stores";
import { radii } from "../theme/radii";
import { Card, useColors, useStyles } from "../ui";
import { storyStore } from "./instances";
import type { Story } from "./types";

function statusLabel(s: Story): string {
  if (s.status === "active") return t("story.status.active") as string;
  if (s.status === "paused") return t("story.status.paused") as string;
  return t("story.status.ended") as string;
}

export function StorySection() {
  const colors = useColors();
  const s = useStyles();
  const [stories, setStories] = useState<Story[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refresh = () => {
    void (async () => {
      try {
        const activeId = await personaStore.getActiveId().catch(() => null);
        if (!activeId) {
          setStories([]);
          return;
        }
        const list = await storyStore.list(activeId, true);
        setStories(list);
      } catch {
        // ignore — empty list is honest
      }
    })();
  };

  useEffect(() => {
    refresh();
  }, []);

  const mutate = (fn: () => Promise<unknown>) => {
    void (async () => {
      try {
        await fn();
      } catch {
        // ignore — refresh shows the truth
      } finally {
        refresh();
      }
    })();
  };

  const confirm = (title: string, message: string, onOk: () => void) =>
    Alert.alert(title, message, [
      { text: t("common.cancel") as string, style: "cancel" },
      { text: t("common.done") as string, onPress: onOk },
    ]);

  const doDelete = (story: Story) =>
    Alert.alert(t("story.actions.delete") as string, `《${story.title}》`, [
      { text: t("common.cancel") as string, style: "cancel" },
      {
        text: t("common.delete") as string,
        style: "destructive",
        onPress: () => mutate(() => storyStore.remove(story.id)),
      },
    ]);

  const removeBibleEntry = (story: Story, kind: "character" | "place" | "event", name: string) =>
    mutate(() =>
      storyStore.update(story.id, Date.now(), (prev) => {
        const bible = {
          characters: [...prev.bible.characters],
          places: [...prev.bible.places],
          events: [...prev.bible.events],
        };
        if (kind === "character")
          bible.characters = bible.characters.filter((c) => c.name !== name);
        else if (kind === "place") bible.places = bible.places.filter((p) => p.name !== name);
        else bible.events = bible.events.filter((e) => e.text !== name);
        return { ...prev, bible };
      }),
    );

  const renderBible = (story: Story) => {
    const rows: { kind: "character" | "place" | "event"; label: string; name: string }[] = [
      ...story.bible.characters.map((c) => ({
        kind: "character" as const,
        label: `${c.name}${c.desc ? ` — ${c.desc}` : ""}`,
        name: c.name,
      })),
      ...story.bible.places.map((p) => ({
        kind: "place" as const,
        label: `${p.name}${p.desc ? ` — ${p.desc}` : ""}`,
        name: p.name,
      })),
      ...story.bible.events.map((e) => ({
        kind: "event" as const,
        label: e.text,
        name: e.text,
      })),
    ];
    if (rows.length === 0) {
      return (
        <TText style={[s.small, { color: colors.muted, marginTop: 8 }]}>
          {t("story.bible.empty")}
        </TText>
      );
    }
    return (
      <View style={{ marginTop: 8, gap: 6 }}>
        <TText style={{ fontSize: 12, color: colors.muted, letterSpacing: 1 }}>
          {t("story.bible.title")}
        </TText>
        {rows.map((r) => (
          <View
            key={`${r.kind}:${r.name}`}
            style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
          >
            <TText style={{ flex: 1, fontSize: 13, color: colors.text }}>{r.label}</TText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("common.delete") as string}
              onPress={() => removeBibleEntry(story, r.kind, r.name)}
              hitSlop={8}
            >
              <X size={14} color={colors.muted} />
            </Pressable>
          </View>
        ))}
      </View>
    );
  };

  const actionBtn = (label: string, icon: React.ReactNode, onPress: () => void, danger = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: radii.lg,
        backgroundColor: pressed ? colors.line : colors.card,
        borderWidth: 1,
        borderColor: colors.line,
      })}
    >
      {icon}
      <TText style={{ fontSize: 12, color: danger ? (colors.danger ?? colors.text) : colors.text }}>
        {label}
      </TText>
    </Pressable>
  );

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <BookOpen size={18} color={colors.text} />
        <View style={{ flex: 1 }}>
          <TText style={{ fontWeight: "700", fontSize: 16 }}>{t("story.section.title")}</TText>
          <TText style={[s.small, { color: colors.muted, marginTop: 4 }]}>
            {t("story.section.desc")}
          </TText>
        </View>
      </View>

      {stories.length === 0 ? (
        <TText style={[s.small, { color: colors.muted, marginTop: 12 }]}>
          {t("story.list.empty")}
        </TText>
      ) : (
        <View style={{ marginTop: 12, gap: 10 }}>
          {stories.map((story) => {
            const expanded = expandedId === story.id;
            return (
              <View
                key={story.id}
                style={{
                  borderWidth: 1,
                  borderColor: colors.line,
                  borderRadius: radii.lg,
                  padding: 10,
                  gap: 8,
                }}
              >
                <Pressable onPress={() => setExpandedId(expanded ? null : story.id)}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <TText style={{ flex: 1, fontSize: 14, fontWeight: "600", color: colors.text }}>
                      《{story.title}》
                    </TText>
                    <TText style={{ fontSize: 11, color: colors.muted }}>
                      {statusLabel(story)}
                    </TText>
                  </View>
                  <TText style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>
                    {
                      t("story.item.progress", {
                        chapter: story.currentChapter,
                        scenes: story.scenes.length,
                      }) as string
                    }
                  </TText>
                </Pressable>

                {expanded && renderBible(story)}

                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                  {story.status === "active" &&
                    actionBtn(
                      t("story.actions.pause") as string,
                      <Pause size={12} color={colors.muted} />,
                      () =>
                        confirm(t("story.actions.pause") as string, `《${story.title}》`, () =>
                          mutate(() =>
                            storyStore.update(story.id, Date.now(), (p) => ({
                              ...p,
                              status: "paused",
                            })),
                          ),
                        ),
                    )}
                  {story.status === "paused" &&
                    actionBtn(
                      t("story.actions.resume") as string,
                      <Play size={12} color={colors.muted} />,
                      () =>
                        mutate(() =>
                          storyStore.update(story.id, Date.now(), (p) => ({
                            ...p,
                            status: "active",
                          })),
                        ),
                    )}
                  {story.status !== "ended" &&
                    actionBtn(
                      t("story.actions.end") as string,
                      <Square size={12} color={colors.muted} />,
                      () =>
                        confirm(t("story.actions.end") as string, `《${story.title}》`, () =>
                          mutate(() =>
                            storyStore.update(story.id, Date.now(), (p) => ({
                              ...p,
                              status: "ended",
                            })),
                          ),
                        ),
                    )}
                  {actionBtn(
                    t("common.delete") as string,
                    <Trash2 size={12} color={colors.muted} />,
                    () => doDelete(story),
                    true,
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </Card>
  );
}
