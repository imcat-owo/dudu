/**
 * Capability-group settings UI (能力分组) — the ONE interface she sees.
 *
 * Two implementations underneath (vision doc §1):
 * - input-type groups (image_input, voice_input, custom input tags) = routing:
 *   messages carrying that capability are routed to the group's ordered
 *   members (primary first, then fallbacks).
 * - output-type groups (image_output, video, custom output tags) = tool
 *   backends: generate_image / generate_video call the group's endpoint.
 *
 * She just sees "分组": a routing toggle, her groups with ordered members,
 * a model-ranking mode picker, and custom group creation. Presets ship
 * enabled-but-empty — she fills them; presets can't be deleted, only
 * disabled (safer).
 */

import { ChevronDown, ChevronUp, Plus, Trash2, X } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Switch, View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { radii } from "../theme/radii";
import { Button, Card, Field, useColors, useStyles } from "../ui";
import {
  CAPABILITY_TAGS,
  type CapabilityGroup,
  type CapabilityGroupMember,
  type CapabilityKind,
  capabilityGroupDisplayName,
  moveMember,
  newCapabilityGroupId,
} from "./capability-groups";
import { capabilityStore, useCapabilityGroups } from "./capability-store";
import { RANKING_MODES, type RankingMode } from "./model-ranking";
import { useApiGroups } from "./store";

function presetName(presetId: string): string {
  return t(`capgroup.preset.${presetId}` as Parameters<typeof t>[0]);
}

function displayName(g: CapabilityGroup): string {
  return capabilityGroupDisplayName(g, presetName);
}

function kindLabel(kind: CapabilityKind): string {
  return t(kind === "input" ? "capgroup.kind.input" : "capgroup.kind.output");
}

export function CapabilitySettingsSection() {
  const { groups, routingEnabled, rankingMode, loaded } = useCapabilityGroups();
  const colors = useColors();
  const s = useStyles();
  const [showNew, setShowNew] = useState(false);

  return (
    <View style={{ gap: 12 }}>
      <TText style={{ fontSize: 18, fontWeight: "700" }}>{t("capgroup.title")}</TText>
      <TText style={[s.small, { color: colors.muted }]}>{t("capgroup.subtitle")}</TText>

      {!loaded ? null : (
        <>
          {/* Passive capability routing on/off. */}
          <Card>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <View style={{ flex: 1, paddingRight: 12 }}>
                <TText style={{ fontWeight: "700" }}>{t("capgroup.routing")}</TText>
                <TText style={[s.small, { color: colors.muted }]}>
                  {t("capgroup.routingDesc")}
                </TText>
              </View>
              <Switch
                value={routingEnabled}
                onValueChange={(v) => void capabilityStore.setRoutingEnabled(v)}
              />
            </View>
          </Card>

          {/* Model ranking mode: 均衡 / 聪明优先 / 速度优先. */}
          <Card>
            <TText style={{ fontWeight: "700", marginBottom: 4 }}>{t("capgroup.ranking")}</TText>
            <TText style={[s.small, { color: colors.muted, marginBottom: 10 }]}>
              {t("capgroup.rankingDesc")}
            </TText>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {RANKING_MODES.map((m) => {
                const selected = rankingMode === m.id;
                return (
                  <Pressable
                    key={m.id}
                    accessibilityRole="button"
                    onPress={() => void capabilityStore.setRankingMode(m.id as RankingMode)}
                    style={{
                      flex: 1,
                      paddingVertical: 10,
                      borderRadius: radii.sm,
                      borderWidth: 1,
                      borderColor: selected ? colors.blueDark : colors.line,
                      backgroundColor: selected ? colors.blueDark : colors.card,
                      alignItems: "center",
                    }}
                  >
                    <TText
                      style={{
                        fontWeight: "700",
                        color: selected ? "#fff" : colors.text,
                        fontSize: 13,
                      }}
                    >
                      {t(`capgroup.ranking.${m.id}` as Parameters<typeof t>[0])}
                    </TText>
                  </Pressable>
                );
              })}
            </View>
          </Card>
        </>
      )}

      {/* Groups. */}
      {!loaded ? null : (
        <View style={{ gap: 8 }}>
          {groups.map((g) => (
            <CapabilityGroupCard key={g.id} group={g} />
          ))}
        </View>
      )}

      {showNew ? (
        <NewGroupForm onClose={() => setShowNew(false)} />
      ) : (
        <Button small icon={Plus} onPress={() => setShowNew(true)}>
          {t("capgroup.newGroup")}
        </Button>
      )}
    </View>
  );
}

function CapabilityGroupCard({ group }: { group: CapabilityGroup }) {
  const colors = useColors();
  const s = useStyles();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(group.name);

  const saveName = () => {
    const trimmed = name.trim();
    if (trimmed !== group.name) void capabilityStore.upsert({ ...group, name: trimmed });
  };

  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen((o) => !o)}
        style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
      >
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <TText style={{ fontWeight: "700" }}>{displayName(group)}</TText>
            <TText
              style={[
                s.small,
                {
                  color: colors.muted,
                  borderWidth: 1,
                  borderColor: colors.line,
                  borderRadius: 8,
                  paddingHorizontal: 6,
                  paddingVertical: 1,
                },
              ]}
            >
              {kindLabel(group.kind)}
            </TText>
            {!group.enabled ? (
              <TText style={[s.small, { color: colors.muted }]}>{t("capgroup.disabled")}</TText>
            ) : null}
          </View>
          <TText style={[s.small, { color: colors.muted }]}>
            {t("capgroup.members", { n: group.members.length })}
            {group.members.length > 0 ? ` · ${t("capgroup.primary")}` : ""}
          </TText>
        </View>
        <Switch
          value={group.enabled}
          onValueChange={(v) => void capabilityStore.upsert({ ...group, enabled: v })}
        />
        {open ? (
          <ChevronUp size={18} color={colors.muted} />
        ) : (
          <ChevronDown size={18} color={colors.muted} />
        )}
      </Pressable>

      {open ? (
        <View style={{ gap: 10, marginTop: 12 }}>
          <Field
            label={t("capgroup.groupName")}
            value={name}
            onChangeText={setName}
            onBlur={saveName}
            placeholder={group.presetId ? presetName(group.presetId) : group.tag}
          />
          <MemberList group={group} />
          {!group.presetId ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => void capabilityStore.remove(group.id)}
              style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 }}
            >
              <Trash2 size={14} color={colors.muted} />
              <TText style={[s.small, { color: colors.muted }]}>{t("capgroup.delete")}</TText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

function MemberList({ group }: { group: CapabilityGroup }) {
  const { groups: apiGroups } = useApiGroups();
  const colors = useColors();
  const s = useStyles();
  const [picking, setPicking] = useState(false);

  const update = (members: CapabilityGroupMember[]) =>
    void capabilityStore.upsert({ ...group, members });

  const addMember = (groupId: string) => {
    if (group.members.some((m) => m.groupId === groupId)) {
      setPicking(false);
      return;
    }
    update([...group.members, { groupId }]);
    setPicking(false);
  };

  const candidates = apiGroups.filter((g) => !group.members.some((m) => m.groupId === g.id));

  return (
    <View style={{ gap: 8 }}>
      {group.members.length === 0 ? (
        <TText style={[s.small, { color: colors.muted }]}>{t("capgroup.empty")}</TText>
      ) : (
        group.members.map((m, i) => (
          <MemberRow
            key={m.groupId}
            group={group}
            member={m}
            index={i}
            total={group.members.length}
            onChange={(next) => update(group.members.map((x, j) => (j === i ? next : x)))}
            onMove={(delta) => update(moveMember(group.members, i, delta))}
            onRemove={() => update(group.members.filter((_, j) => j !== i))}
          />
        ))
      )}
      {picking ? (
        <View style={{ gap: 6 }}>
          {candidates.length === 0 ? (
            <TText style={[s.small, { color: colors.muted }]}>{t("capgroup.noCandidates")}</TText>
          ) : (
            candidates.map((g) => (
              <Pressable
                key={g.id}
                onPress={() => addMember(g.id)}
                style={{
                  padding: 10,
                  borderRadius: radii.sm,
                  borderWidth: 1,
                  borderColor: colors.line,
                  backgroundColor: colors.canvas,
                }}
              >
                <TText style={{ fontWeight: "600" }}>{g.name}</TText>
                <TText style={[s.small, { color: colors.muted }]}>{g.model}</TText>
              </Pressable>
            ))
          )}
          <Button small onPress={() => setPicking(false)}>
            {t("capgroup.cancel")}
          </Button>
        </View>
      ) : (
        <Button small icon={Plus} onPress={() => setPicking(true)}>
          {t("capgroup.addMember")}
        </Button>
      )}
    </View>
  );
}

function MemberRow({
  group,
  member,
  index,
  total,
  onChange,
  onMove,
  onRemove,
}: {
  group: CapabilityGroup;
  member: CapabilityGroupMember;
  index: number;
  total: number;
  onChange: (m: CapabilityGroupMember) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { groups: apiGroups } = useApiGroups();
  const colors = useColors();
  const s = useStyles();
  const apiGroup = apiGroups.find((g) => g.id === member.groupId);
  const isVideo = group.kind === "output" && group.tag === CAPABILITY_TAGS.VIDEO;

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radii.sm,
        padding: 10,
        gap: 8,
        backgroundColor: colors.canvas,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <TText style={{ fontWeight: "700" }}>{apiGroup?.name ?? member.groupId}</TText>
          <TText style={[s.small, { color: colors.muted }]}>
            {index === 0 ? t("capgroup.primary") : t("capgroup.fallback")} ·{" "}
            {member.model?.trim() || apiGroup?.model || "—"}
          </TText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("capgroup.moveUp")}
          disabled={index === 0}
          onPress={() => onMove(-1)}
          style={{ padding: 6, opacity: index === 0 ? 0.3 : 1 }}
        >
          <ChevronUp size={16} color={colors.text} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("capgroup.moveDown")}
          disabled={index === total - 1}
          onPress={() => onMove(1)}
          style={{ padding: 6, opacity: index === total - 1 ? 0.3 : 1 }}
        >
          <ChevronDown size={16} color={colors.text} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("capgroup.remove")}
          onPress={onRemove}
          style={{ padding: 6 }}
        >
          <X size={16} color={colors.muted} />
        </Pressable>
      </View>
      <Field
        label={t("capgroup.modelOverride")}
        value={member.model ?? ""}
        onChangeText={(v) => onChange({ ...member, model: v })}
        placeholder={apiGroup?.model ?? ""}
      />
      {group.kind === "output" ? (
        <Field
          label={t("capgroup.endpoint")}
          value={member.endpoint ?? ""}
          onChangeText={(v) => onChange({ ...member, endpoint: v })}
          placeholder="https://…"
          autoCapitalize="none"
        />
      ) : null}
      {isVideo ? (
        <Field
          label={t("capgroup.pollEndpoint")}
          value={member.pollEndpoint ?? ""}
          onChangeText={(v) => onChange({ ...member, pollEndpoint: v })}
          placeholder="https://…/{id}"
          autoCapitalize="none"
        />
      ) : null}
    </View>
  );
}

function NewGroupForm({ onClose }: { onClose: () => void }) {
  const colors = useColors();
  const s = useStyles();
  const { groups } = useCapabilityGroups();
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [kind, setKind] = useState<CapabilityKind>("input");

  const trimmedTag = tag.trim().toLowerCase();
  const duplicateTag = trimmedTag !== "" && groups.some((g) => g.tag.toLowerCase() === trimmedTag);

  const create = () => {
    if (!trimmedTag || duplicateTag) return;
    void capabilityStore.upsert({
      id: newCapabilityGroupId(),
      name: name.trim(),
      tag: trimmedTag,
      kind,
      members: [],
      enabled: true,
      createdAt: Date.now(),
    });
    onClose();
  };

  return (
    <Card>
      <TText style={{ fontWeight: "700", marginBottom: 10 }}>{t("capgroup.newGroup")}</TText>
      <View style={{ gap: 10 }}>
        <Field label={t("capgroup.groupName")} value={name} onChangeText={setName} />
        <Field
          label={t("capgroup.tag")}
          value={tag}
          onChangeText={setTag}
          placeholder="e.g. image_input"
          autoCapitalize="none"
        />
        <View style={{ flexDirection: "row", gap: 8 }}>
          {(["input", "output"] as CapabilityKind[]).map((k) => {
            const selected = kind === k;
            return (
              <Pressable
                key={k}
                accessibilityRole="button"
                onPress={() => setKind(k)}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: radii.sm,
                  borderWidth: 1,
                  borderColor: selected ? colors.blueDark : colors.line,
                  backgroundColor: colors.card,
                  alignItems: "center",
                }}
              >
                <TText
                  style={{
                    fontWeight: "700",
                    fontSize: 13,
                    color: selected ? colors.blueDark : colors.text,
                  }}
                >
                  {kindLabel(k)}
                </TText>
              </Pressable>
            );
          })}
        </View>
        <TText style={[s.small, { color: colors.muted }]}>{t("capgroup.kindDesc")}</TText>
        {duplicateTag ? (
          <TText style={[s.small, { color: colors.muted }]}>
            {t("capgroup.duplicateTag", { tag: trimmedTag })}
          </TText>
        ) : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button small primary onPress={create} disabled={!trimmedTag || duplicateTag}>
            {t("capgroup.create")}
          </Button>
          <Button small onPress={onClose}>
            {t("capgroup.cancel")}
          </Button>
        </View>
      </View>
    </Card>
  );
}
