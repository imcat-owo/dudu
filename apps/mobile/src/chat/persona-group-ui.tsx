/**
 * Persona group chat UI (人设群聊).
 *
 * - PersonaGroupListSheet: her groups, create (name + member picker),
 *   archive/restore. Opened from the chat header's group button.
 * - PersonaGroupChatScreen: the group room — member avatars, @-mention
 *   picker, folded tool-call blocks, and the turn engine driving persona
 *   replies when she speaks.
 *
 * Visual language follows the main chat (theme tokens for bubbles,
 * ChatAvatar conventions); group-specific pieces (member avatar stack,
 * folded tool blocks) are new but token-driven.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Image, Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { personaStore } from "../persona/stores";
import type { Persona } from "../persona/types";
import { useTheme } from "../theme/ThemeContext";
import { Button, Card, useColors, useStyles } from "../ui";
import { foldToolSummary, type PersonaGroup, type PersonaGroupMessage } from "./persona-group";
import { handleGroupUserMessage } from "./persona-group-engine";
import { personaGroupStore } from "./persona-group-instance";
import { createGroupEngineDeps } from "./persona-group-wiring";

/* ------------------------------------------------------------------ */
/* Member avatar: the persona's own avatar, else an initial fallback.  */
/* ------------------------------------------------------------------ */

export function PersonaAvatar({ persona, size = 36 }: { persona: Persona; size?: number }) {
  const colors = useColors();
  const [failed, setFailed] = useState(false);
  const uri = persona.avatar && !failed ? persona.avatar : undefined;
  if (uri) {
    return (
      <Image
        source={{ uri }}
        onError={() => setFailed(true)}
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
    );
  }
  const initial = (persona.name || "?").trim().slice(0, 1);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.blueDark,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <TText style={{ color: "#fff", fontWeight: "700", fontSize: size * 0.42 }}>{initial}</TText>
    </View>
  );
}

function usePersonas(): Persona[] {
  const [list, setList] = useState<Persona[]>([]);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      personaStore
        .list()
        .then((ps) => {
          if (alive) setList(ps.filter((p) => p.enabled));
        })
        .catch(() => {});
    };
    refresh();
    const unsub = personaStore.subscribe(refresh);
    return () => {
      alive = false;
      unsub();
    };
  }, []);
  return list;
}

function useGroups(): PersonaGroup[] {
  const [groups, setGroups] = useState<PersonaGroup[]>([]);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      personaGroupStore
        .list()
        .then((g) => {
          if (alive) setGroups(g);
        })
        .catch(() => {});
    };
    refresh();
    const unsub = personaGroupStore.subscribe(refresh);
    return () => {
      alive = false;
      unsub();
    };
  }, []);
  return groups;
}

/* ------------------------------------------------------------------ */
/* Group list + create sheet.                                          */
/* ------------------------------------------------------------------ */

export function PersonaGroupListSheet({
  visible,
  onClose,
  onOpen,
}: {
  visible: boolean;
  onClose: () => void;
  onOpen: (groupId: string) => void;
}) {
  const colors = useColors();
  const s = useStyles();
  const groups = useGroups();
  const personas = usePersonas();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const nameOf = (id: string) => personas.find((p) => p.id === id)?.name ?? "…";

  const doCreate = async () => {
    setError("");
    if (!name.trim()) {
      setError(t("pgroup.nameRequired") as string);
      return;
    }
    if (picked.size < 2) {
      setError(t("pgroup.membersRequired") as string);
      return;
    }
    setBusy(true);
    try {
      const group = await personaGroupStore.create(name.trim(), [...picked]);
      setCreating(false);
      setName("");
      setPicked(new Set());
      onOpen(group.id);
    } catch {
      setError(t("pgroup.createFailed") as string);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.canvas, paddingTop: 60 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 16,
            marginBottom: 12,
          }}
        >
          <TText style={{ fontSize: 20, fontWeight: "700", flex: 1 }}>{t("pgroup.title")}</TText>
          <Button small onPress={onClose}>
            {t("common.close")}
          </Button>
        </View>

        {!creating ? (
          <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
            <Button onPress={() => setCreating(true)}>{t("pgroup.new")}</Button>
          </View>
        ) : (
          <Card style={{ marginHorizontal: 16, marginBottom: 12 }}>
            <TText style={{ fontWeight: "700", marginBottom: 8 }}>{t("pgroup.new")}</TText>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={t("pgroup.namePlaceholder") as string}
              placeholderTextColor={colors.muted}
              style={{
                borderWidth: 1,
                borderColor: colors.line,
                borderRadius: 10,
                padding: 10,
                color: colors.text,
                marginBottom: 10,
              }}
            />
            <TText style={[s.small, { color: colors.muted, marginBottom: 8 }]}>
              {t("pgroup.pickPersonas")}
            </TText>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              {personas.map((p) => {
                const on = picked.has(p.id);
                return (
                  <Pressable
                    key={p.id}
                    onPress={() =>
                      setPicked((prev) => {
                        const next = new Set(prev);
                        if (next.has(p.id)) next.delete(p.id);
                        else next.add(p.id);
                        return next;
                      })
                    }
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      paddingVertical: 6,
                      paddingHorizontal: 10,
                      borderRadius: 16,
                      borderWidth: 1.5,
                      borderColor: on ? colors.blueDark : colors.line,
                      backgroundColor: on ? colors.secondaryBg : "transparent",
                    }}
                  >
                    <PersonaAvatar persona={p} size={24} />
                    <TText style={{ fontWeight: on ? "700" : "400" }}>{p.name}</TText>
                  </Pressable>
                );
              })}
            </View>
            {!!error && <TText style={{ color: colors.danger, marginBottom: 8 }}>{error}</TText>}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button small onPress={() => void doCreate()} disabled={busy}>
                {t("pgroup.create")}
              </Button>
              <Button
                small
                onPress={() => {
                  setCreating(false);
                  setError("");
                }}
              >
                {t("common.cancel")}
              </Button>
            </View>
          </Card>
        )}

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
          {groups.length === 0 && !creating && (
            <View style={{ alignItems: "center", marginTop: 40 }}>
              <TText style={{ color: colors.muted, marginBottom: 4 }}>{t("pgroup.empty")}</TText>
              <TText style={[s.small, { color: colors.muted }]}>{t("pgroup.emptyHint")}</TText>
            </View>
          )}
          {groups.map((g) => (
            <Pressable key={g.id} onPress={() => onOpen(g.id)}>
              <Card>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View style={{ flexDirection: "row", marginRight: 10 }}>
                    {g.members.slice(0, 3).map((m, i) => {
                      const p = personas.find((x) => x.id === m.personaId);
                      if (!p) return null;
                      return (
                        <View key={m.personaId} style={{ marginLeft: i === 0 ? 0 : -10 }}>
                          <PersonaAvatar persona={p} size={32} />
                        </View>
                      );
                    })}
                  </View>
                  <View style={{ flex: 1 }}>
                    <TText style={{ fontWeight: "700", fontSize: 16 }}>{g.name}</TText>
                    <TText style={[s.small, { color: colors.muted }]}>
                      {g.members.map((m) => nameOf(m.personaId)).join("、")}
                    </TText>
                    <TText style={[s.small, { color: colors.muted }]}>
                      {t("pgroup.messageCount", { n: g.messages.length })}
                    </TText>
                  </View>
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      void personaGroupStore.setArchived(g.id, true).catch(() => {});
                    }}
                    style={{
                      paddingVertical: 6,
                      paddingHorizontal: 10,
                      borderRadius: 10,
                      backgroundColor: colors.secondaryBg,
                    }}
                  >
                    <TText style={{ fontSize: 12, fontWeight: "600", color: colors.muted }}>
                      {t("pgroup.archive")}
                    </TText>
                  </Pressable>
                </View>
              </Card>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Message rows.                                                       */
/* ------------------------------------------------------------------ */

function ToolFoldBlock({ tools }: { tools: NonNullable<PersonaGroupMessage["tools"]> }) {
  const colors = useColors();
  const s = useStyles();
  const [open, setOpen] = useState(false);
  return (
    <Pressable
      onPress={() => setOpen((v) => !v)}
      style={{
        marginTop: 6,
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 10,
        backgroundColor: colors.secondaryBg,
      }}
    >
      <TText style={[s.small, { color: colors.muted }]}>
        {open ? t("pgroup.toolsHide") : foldToolSummary(tools)}
      </TText>
      {open &&
        tools.map((tool) => (
          <TText key={`${tool.name}:${tool.ok}`} style={[s.small, { color: colors.muted }]}>
            {tool.ok ? "✓" : "✗"} {tool.name}
          </TText>
        ))}
    </Pressable>
  );
}

function GroupMessageRow({
  msg,
  persona,
  isUser,
}: {
  msg: PersonaGroupMessage;
  persona: Persona | null;
  isUser: boolean;
}) {
  const colors = useColors();
  const s = useStyles();
  const { tokens } = useTheme();

  if (msg.from.kind === "system") {
    return (
      <View style={{ alignItems: "center", marginVertical: 6, paddingHorizontal: 24 }}>
        <TText style={[s.small, { color: colors.muted, textAlign: "center" }]}>{msg.text}</TText>
      </View>
    );
  }

  if (isUser) {
    const bubble = tokens.userBubble;
    return (
      <View style={{ alignItems: "flex-end", marginVertical: 4, paddingHorizontal: 12 }}>
        <View
          style={{
            maxWidth: "80%",
            backgroundColor: bubble.bg,
            borderRadius: bubble.radius ?? 16,
            paddingVertical: 8,
            paddingHorizontal: 12,
          }}
        >
          <TText>{msg.text}</TText>
        </View>
      </View>
    );
  }

  const bubble = tokens.aiBubble;
  return (
    <View style={{ flexDirection: "row", marginVertical: 4, paddingHorizontal: 12, gap: 8 }}>
      {persona ? <PersonaAvatar persona={persona} size={34} /> : <View style={{ width: 34 }} />}
      <View style={{ maxWidth: "80%" }}>
        <TText style={[s.small, { color: colors.muted, marginBottom: 2 }]}>
          {msg.from.kind === "persona" ? msg.from.personaName : ""}
        </TText>
        <View
          style={{
            backgroundColor: bubble.bg,
            borderRadius: bubble.radius ?? 16,
            paddingVertical: 8,
            paddingHorizontal: 12,
          }}
        >
          <TText>{msg.text}</TText>
          {msg.tools && msg.tools.length > 0 && <ToolFoldBlock tools={msg.tools} />}
        </View>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* The group room.                                                     */
/* ------------------------------------------------------------------ */

export function PersonaGroupChatScreen({
  groupId,
  onBack,
}: {
  groupId: string;
  onBack: () => void;
}) {
  const colors = useColors();
  const s = useStyles();
  const personas = usePersonas();
  const [group, setGroup] = useState<PersonaGroup | null>(null);
  const [draft, setDraft] = useState("");
  const [mentionOpen, setMentionOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState("");
  const deps = useMemo(() => createGroupEngineDeps(), []);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      personaGroupStore
        .get(groupId)
        .then((g) => {
          if (alive) setGroup(g);
        })
        .catch(() => {});
    };
    refresh();
    const unsub = personaGroupStore.subscribe(refresh);
    return () => {
      alive = false;
      unsub();
    };
  }, [groupId]);

  const personaOf = (id: string) => personas.find((p) => p.id === id) ?? null;
  const reversed = useMemo(() => [...(group?.messages ?? [])].reverse(), [group]);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setMentionOpen(false);
    setSendError("");
    setBusy(true);
    try {
      await handleGroupUserMessage(deps, groupId, text);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const insertMention = (name: string) => {
    setDraft((d) => `${d}@${name} `);
    setMentionOpen(false);
  };

  const memberPersonas = (group?.members ?? [])
    .map((m) => personaOf(m.personaId))
    .filter((p): p is Persona => p !== null);

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 12,
          paddingTop: 60,
          paddingBottom: 10,
          borderBottomWidth: 1,
          borderBottomColor: colors.line,
        }}
      >
        <Button small onPress={onBack}>
          {t("common.back")}
        </Button>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <TText style={{ fontSize: 17, fontWeight: "700" }}>{group?.name ?? "…"}</TText>
          <TText style={[s.small, { color: colors.muted }]}>
            {memberPersonas.map((p) => p.name).join("、")}
          </TText>
        </View>
        <View style={{ flexDirection: "row" }}>
          {memberPersonas.slice(0, 4).map((p, i) => (
            <View key={p.id} style={{ marginLeft: i === 0 ? 0 : -8 }}>
              <PersonaAvatar persona={p} size={30} />
            </View>
          ))}
        </View>
      </View>

      {/* Messages */}
      <FlatList
        ref={listRef}
        data={reversed}
        inverted
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => (
          <GroupMessageRow
            msg={item}
            isUser={item.from.kind === "user"}
            persona={item.from.kind === "persona" ? personaOf(item.from.personaId) : null}
          />
        )}
        contentContainerStyle={{ paddingVertical: 12 }}
        keyboardShouldPersistTaps="handled"
      />

      {!!sendError && (
        <TText style={{ color: colors.danger, paddingHorizontal: 16, marginBottom: 4 }}>
          {sendError}
        </TText>
      )}

      {/* @-mention picker */}
      {mentionOpen && (
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: colors.line,
            paddingVertical: 8,
            paddingHorizontal: 12,
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 8,
            backgroundColor: colors.canvas,
          }}
        >
          {memberPersonas.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => insertMention(p.name)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingVertical: 6,
                paddingHorizontal: 10,
                borderRadius: 16,
                backgroundColor: colors.secondaryBg,
              }}
            >
              <PersonaAvatar persona={p} size={22} />
              <TText>{p.name}</TText>
            </Pressable>
          ))}
        </View>
      )}

      {/* Input */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          paddingHorizontal: 12,
          paddingVertical: 10,
          paddingBottom: 28,
          borderTopWidth: 1,
          borderTopColor: colors.line,
          gap: 8,
        }}
      >
        <Button small onPress={() => setMentionOpen((v) => !v)}>
          @
        </Button>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={t("pgroup.inputPlaceholder") as string}
          placeholderTextColor={colors.muted}
          multiline
          style={{
            flex: 1,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: 16,
            paddingHorizontal: 12,
            paddingVertical: 8,
            color: colors.text,
            maxHeight: 120,
          }}
          editable={!busy}
          onSubmitEditing={() => void send()}
        />
        <Button small onPress={() => void send()} disabled={busy || !draft.trim()}>
          {busy ? t("pgroup.sending") : t("common.send")}
        </Button>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Host: list sheet -> room. Rendered above the chat section.           */
/* ------------------------------------------------------------------ */

export function PersonaGroupHost({ onClose }: { onClose: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [listVisible, setListVisible] = useState(true);
  if (openId) {
    return <PersonaGroupChatScreen groupId={openId} onBack={() => setOpenId(null)} />;
  }
  return (
    <PersonaGroupListSheet
      visible={listVisible}
      onClose={() => {
        setListVisible(false);
        onClose();
      }}
      onOpen={(id) => {
        setListVisible(false);
        setOpenId(id);
      }}
    />
  );
}
