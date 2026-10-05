/**
 * Chat gap-fill UI (Batch 1): message action sheet, version switcher,
 * follow-up chips, dialog list / settings / quick phrases sheets,
 * slash-command popup, round screenshot, export, and cross-dialog search.
 *
 * All user-visible strings go through i18n (zh-Hans + en parity).
 * Zero emoji. No dead buttons: every action is wired to a real handler.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Scissors,
  Search,
  Share as ShareIcon,
  Sparkles,
  Trash2,
  X,
} from "lucide-react-native";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Share,
  Switch,
  TextInput,
  View,
} from "react-native";
import ViewShot, { type ViewShotRef } from "react-native-view-shot";
import { TText } from "../font";
import { t } from "../i18n";
import { personaStore } from "../persona/stores";
import type { Persona } from "../persona/types";
import { radii } from "../theme/radii";
import { Button, Card, useColors, useStyles } from "../ui";
import {
  type CrossDialogStorage,
  type DialogInfo,
  deleteDialog,
  listDialogs,
  setDialogName,
  setDialogPinned,
} from "./cross-dialog";
import type { ThreadMeta } from "./thread-versions";

const storage: CrossDialogStorage = AsyncStorage;

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function SheetShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const colors = useColors();
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.canvas, paddingTop: 48 }}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            paddingHorizontal: 16,
            marginBottom: 8,
          }}
        >
          <TText style={{ fontSize: 18, fontWeight: "700" }}>{title}</TText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
            onPress={onClose}
            style={{ padding: 8 }}
          >
            <X size={20} color={colors.text} />
          </Pressable>
        </View>
        {children}
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// P3-3: compact context-usage indicator for the dialog header.
// ---------------------------------------------------------------------------

/** 12345 -> "12.3k", 900 -> "900". Keeps the header readout tiny. */
function compactTokens(n: number): string {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.max(0, Math.round(n)));
}

export function UsageIndicator({
  tokens,
  budget,
  onPress,
}: {
  tokens: number;
  budget?: number;
  onPress: () => void;
}) {
  const colors = useColors();
  const pct = budget && budget > 0 ? Math.min(100, (tokens / budget) * 100) : 0;
  const hot = budget != null && budget > 0 && tokens > budget * 0.9;
  const usedLabel = compactTokens(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        budget
          ? t("chat.usageIndicator", { used: usedLabel, budget: compactTokens(budget) })
          : t("chat.usageIndicatorNoBudget", { used: usedLabel })
      }
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 4,
      }}
    >
      {budget ? (
        <View
          style={{
            flex: 1,
            height: 3,
            borderRadius: 2,
            backgroundColor: colors.line,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              height: 3,
              borderRadius: 2,
              width: `${pct}%`,
              backgroundColor: hot ? colors.danger : colors.blueDark,
            }}
          />
        </View>
      ) : (
        <View style={{ flex: 1 }} />
      )}
      <TText style={{ fontSize: 10, color: colors.muted }}>
        {budget ? `${usedLabel} / ${compactTokens(budget)}` : usedLabel}
      </TText>
    </Pressable>
  );
}

function RowButton({
  icon: Icon,
  label,
  hint,
  danger,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  danger?: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const fg = danger ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 13,
        paddingHorizontal: 16,
        backgroundColor: pressed ? colors.line : "transparent",
      })}
    >
      <Icon size={18} color={fg} />
      <View style={{ flex: 1 }}>
        <TText style={{ fontSize: 15, color: fg }}>{label}</TText>
        {hint ? (
          <TText style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{hint}</TText>
        ) : null}
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// A1/A4/A5 message action sheet (long-press on a bubble)
// ---------------------------------------------------------------------------

export interface MessageAction {
  key: string;
  label: string;
  icon: LucideIcon;
  hint?: string;
  danger?: boolean;
  onPress: () => void;
}

export function MessageActionSheet({
  visible,
  onClose,
  actions,
  preview,
}: {
  visible: boolean;
  onClose: () => void;
  actions: MessageAction[];
  preview?: string;
}) {
  const colors = useColors();
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" }}
        onPress={onClose}
      >
        <Pressable
          style={{
            backgroundColor: colors.card,
            borderTopLeftRadius: radii.xl,
            borderTopRightRadius: radii.xl,
            paddingBottom: 34,
            maxHeight: "70%",
          }}
        >
          <View style={{ alignItems: "center", paddingVertical: 10 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.line }} />
          </View>
          {preview ? (
            <TText
              numberOfLines={2}
              style={{ paddingHorizontal: 16, marginBottom: 6, color: colors.muted, fontSize: 13 }}
            >
              {preview}
            </TText>
          ) : null}
          <ScrollView>
            {actions.map((a) => (
              <RowButton
                key={a.key}
                icon={a.icon}
                label={a.label}
                hint={a.hint}
                danger={a.danger}
                onPress={() => {
                  onClose();
                  // Let the sheet dismiss first so the action's own UI
                  // (alerts, sheets) presents cleanly.
                  setTimeout(a.onPress, 60);
                }}
              />
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// A2 version switcher: ‹ 1 / 3 ›
// ---------------------------------------------------------------------------

export function VersionSwitcher({
  current,
  total,
  onPrev,
  onNext,
}: {
  current: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const colors = useColors();
  if (total < 2) return null;
  const btn = (dir: "prev" | "next", fn: () => void, disabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(dir === "prev" ? "chat.versionPrev" : "chat.versionNext")}
      disabled={disabled}
      onPress={fn}
      style={{ padding: 6, opacity: disabled ? 0.3 : 1 }}
    >
      {dir === "prev" ? (
        <ChevronLeft size={16} color={colors.muted} />
      ) : (
        <ChevronRight size={16} color={colors.muted} />
      )}
    </Pressable>
  );
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: 2,
        marginTop: 2,
      }}
    >
      {btn("prev", onPrev, current <= 1)}
      <TText style={{ fontSize: 11, color: colors.muted }}>
        {t("chat.versionOf", { current, total })}
      </TText>
      {btn("next", onNext, current >= total)}
    </View>
  );
}

// ---------------------------------------------------------------------------
// A6 follow-up suggestion chips
// ---------------------------------------------------------------------------

export function FollowUpChips({
  suggestions,
  onPick,
}: {
  suggestions: string[];
  onPick: (s: string) => void;
}) {
  const colors = useColors();
  if (!suggestions.length) return null;
  return (
    <View style={{ gap: 6, marginTop: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Sparkles size={12} color={colors.muted} />
        <TText style={{ fontSize: 11, color: colors.muted }}>{t("chat.followUpTitle")}</TText>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {suggestions.map((s) => (
          <Pressable
            key={s}
            accessibilityRole="button"
            onPress={() => onPick(s)}
            style={({ pressed }) => ({
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor: pressed ? colors.line : colors.card,
              borderRadius: radii.lg,
              paddingHorizontal: 12,
              paddingVertical: 8,
              maxWidth: "100%",
            })}
          >
            <TText style={{ fontSize: 13, color: colors.text }} numberOfLines={2}>
              {s}
            </TText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// A18 export: markdown + Share
// ---------------------------------------------------------------------------

export interface ExportableMessage {
  role: string;
  content: string;
}

export function buildDialogMarkdown(messages: ExportableMessage[], title: string): string {
  const lines: string[] = [`# ${title}`, ""];
  for (const m of messages) {
    const who = m.role === "user" ? "她" : m.role === "assistant" ? "小梦" : m.role;
    lines.push(`**${who}**`, "", m.content.trim(), "");
  }
  return lines.join("\n").trim() + "\n";
}

export async function shareDialogMarkdown(markdown: string, title: string): Promise<void> {
  await Share.share({ message: markdown, title });
}

// ---------------------------------------------------------------------------
// A9 cross-dialog message search
// ---------------------------------------------------------------------------

export interface MessageHit {
  threadId: string;
  threadName: string;
  messageId: string;
  snippet: string;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        typeof b === "object" && b !== null && "text" in b
          ? String((b as { text: unknown }).text)
          : "",
      )
      .join("");
  }
  return "";
}

/** Search message text across all dialogs (A9). Versions are searchable too. */
export async function searchAllDialogs(query: string, limit = 30): Promise<MessageHit[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const dialogs = await listDialogs(storage);
  const hits: MessageHit[] = [];
  for (const d of dialogs) {
    let raw: string | null = null;
    try {
      raw = await storage.getItem(`dudu.local-chat.${d.id}.v1`);
    } catch {
      continue;
    }
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const arr = Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" &&
          parsed !== null &&
          Array.isArray((parsed as { messages?: unknown }).messages)
        ? (parsed as { messages: unknown[] }).messages
        : [];
    for (const m of arr) {
      if (typeof m !== "object" || m === null) continue;
      const { id, role, content } = m as { id?: unknown; role?: unknown; content?: unknown };
      if (typeof id !== "string") continue;
      const text = contentText(content);
      const idx = text.toLowerCase().indexOf(q);
      if (idx < 0) continue;
      const start = Math.max(0, idx - 24);
      hits.push({
        threadId: d.id,
        threadName: d.name,
        messageId: id,
        snippet: `${role === "user" ? "她" : "小梦"}: …${text.slice(start, idx + q.length + 40)}…`,
      });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Dialog list sheet: browse / search / pin / rename / delete / batch (A8-A10)
// ---------------------------------------------------------------------------

export function DialogListSheet({
  visible,
  onClose,
  currentId,
  onSelect,
  onNew,
}: {
  visible: boolean;
  onClose: () => void;
  currentId: string;
  /** P2-2: search-hit taps pass (threadId, messageId) so chat can scroll to the message. */
  onSelect: (id: string, messageId?: string) => void;
  onNew: () => void;
}) {
  const colors = useColors();
  const s = useStyles();
  const [dialogs, setDialogs] = useState<DialogInfo[]>([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<MessageHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [batch, setBatch] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    setDialogs(await listDialogs(storage));
  };

  useEffect(() => {
    if (visible) {
      setQuery("");
      setHits([]);
      setBatch(false);
      setSelected(new Set());
      void reload();
    }
  }, [visible]);

  // Message search across dialogs, debounced.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      void searchAllDialogs(q).then((h) => {
        setHits(h);
        setSearching(false);
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return dialogs;
    return dialogs.filter((d) => d.name.toLowerCase().includes(q));
  }, [dialogs, query]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const doPin = async (id: string, pinned: boolean) => {
    await setDialogPinned(storage, id, pinned);
    await reload();
  };

  const doRename = (d: DialogInfo) => {
    Alert.prompt(t("chat.renameDialog"), d.name, async (name) => {
      if (name === undefined) return;
      await setDialogName(storage, d.id, name.trim());
      await reload();
    });
  };

  const doDelete = (d: DialogInfo) => {
    Alert.alert(t("chat.deleteDialog"), t("chat.deleteDialogConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: async () => {
          await deleteDialog(storage, d.id);
          await reload();
          // Deleting the dialog she's looking at: move her to a fresh one
          // instead of leaving her in a ghost.
          if (d.id === currentId) {
            onClose();
            onNew();
          }
        },
      },
    ]);
  };

  const doBatchDelete = () => {
    if (!selected.size) return;
    Alert.alert(t("chat.deleteDialog"), t("chat.deleteDialogConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            const ids = [...selected];
            for (const id of ids) await deleteDialog(storage, id);
            setSelected(new Set());
            setBatch(false);
            await reload();
            if (ids.includes(currentId)) {
              onClose();
              onNew();
            }
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const doBatchPin = async (pinned: boolean) => {
    if (!selected.size) return;
    setBusy(true);
    try {
      for (const id of selected) await setDialogPinned(storage, id, pinned);
      setSelected(new Set());
      setBatch(false);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const searching_ = query.trim().length > 0;

  return (
    <SheetShell title={t("chat.dialogList")} onClose={onClose}>
      <View style={{ paddingHorizontal: 16, gap: 8, marginBottom: 8 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radii.lg,
            paddingHorizontal: 12,
            paddingVertical: 8,
            backgroundColor: colors.card,
          }}
        >
          <Search size={15} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t("chat.searchDialogs")}
            placeholderTextColor={colors.muted}
            style={{ flex: 1, fontSize: 14, color: colors.text }}
            returnKeyType="search"
          />
          {query ? (
            <Pressable onPress={() => setQuery("")} style={{ padding: 4 }}>
              <X size={14} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button
              small
              primary
              onPress={() => {
                onClose();
                onNew();
              }}
              icon={Plus}
            >
              {t("chat.newDialog")}
            </Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button small onPress={() => setBatch((b) => !b)}>
              {batch ? t("common.done") : t("chat.batchOps")}
            </Button>
          </View>
        </View>
        {batch && selected.size > 0 && (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button small onPress={() => void doBatchPin(true)} disabled={busy}>
                {t("chat.pinDialog")} ({selected.size})
              </Button>
            </View>
            <View style={{ flex: 1 }}>
              <Button small danger onPress={doBatchDelete} disabled={busy}>
                {t("common.delete")} ({selected.size})
              </Button>
            </View>
          </View>
        )}
      </View>
      <ScrollView style={{ paddingHorizontal: 16 }} keyboardShouldPersistTaps="handled">
        {searching_ ? (
          <>
            {searching ? (
              <ActivityIndicator style={{ marginTop: 20 }} color={colors.muted} />
            ) : hits.length === 0 ? (
              <TText style={[s.muted, { textAlign: "center", marginTop: 20 }]}>
                {t("chat.searchNoResults")}
              </TText>
            ) : (
              hits.map((h) => (
                <Pressable
                  key={`${h.threadId}:${h.messageId}`}
                  onPress={() => {
                    onClose();
                    onSelect(h.threadId, h.messageId);
                  }}
                  style={({ pressed }) => ({
                    paddingVertical: 10,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.line,
                    backgroundColor: pressed ? colors.line : "transparent",
                  })}
                >
                  <TText style={{ fontSize: 13, fontWeight: "600" }}>{h.threadName}</TText>
                  <TText style={{ fontSize: 13, color: colors.muted }} numberOfLines={2}>
                    {h.snippet}
                  </TText>
                </Pressable>
              ))
            )}
          </>
        ) : filtered.length === 0 ? (
          <TText style={[s.muted, { textAlign: "center", marginTop: 20 }]}>
            {t("chat.searchNoResults")}
          </TText>
        ) : (
          filtered.map((d) => {
            const isCurrent = d.id === currentId;
            const isSel = selected.has(d.id);
            return (
              <View
                key={d.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingVertical: 10,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.line,
                }}
              >
                {batch ? (
                  <Pressable
                    onPress={() => toggleSelect(d.id)}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      borderWidth: 1.5,
                      borderColor: isSel ? colors.blueDark : colors.muted,
                      backgroundColor: isSel ? colors.blueDark : "transparent",
                      alignItems: "center",
                      justifyContent: "center",
                      marginRight: 10,
                    }}
                  >
                    {isSel ? <Check size={13} color={colors.canvas} /> : null}
                  </Pressable>
                ) : null}
                <Pressable
                  style={{ flex: 1 }}
                  onPress={() => {
                    if (batch) toggleSelect(d.id);
                    else {
                      onClose();
                      onSelect(d.id);
                    }
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    {d.pinned ? <Pin size={12} color={colors.muted} /> : null}
                    <TText
                      style={{ fontSize: 15, fontWeight: isCurrent ? "700" : "400", flex: 1 }}
                      numberOfLines={1}
                    >
                      {d.name}
                    </TText>
                  </View>
                  <TText style={{ fontSize: 12, color: colors.muted }}>
                    {t("chat.messageCount", { n: d.messageCount })}
                  </TText>
                </Pressable>
                {!batch && (
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={d.pinned ? t("chat.unpinDialog") : t("chat.pinDialog")}
                      onPress={() => void doPin(d.id, !d.pinned)}
                      style={{ padding: 8 }}
                    >
                      {d.pinned ? (
                        <PinOff size={16} color={colors.muted} />
                      ) : (
                        <Pin size={16} color={colors.muted} />
                      )}
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("chat.renameDialog")}
                      onPress={() => doRename(d)}
                      style={{ padding: 8 }}
                    >
                      <Pencil size={16} color={colors.muted} />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("chat.deleteDialog")}
                      onPress={() => doDelete(d)}
                      style={{ padding: 8 }}
                    >
                      <Trash2 size={16} color={colors.danger} />
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SheetShell>
  );
}

// ---------------------------------------------------------------------------
// Dialog settings: per-dialog instruction, token budget, usage, compress (A13/A14/A16/A27)
// ---------------------------------------------------------------------------

export function DialogSettingsSheet({
  visible,
  onClose,
  dialogName,
  meta,
  usage,
  onSaveMeta,
  onCompress,
  onExport,
}: {
  visible: boolean;
  onClose: () => void;
  dialogName: string;
  meta: ThreadMeta;
  usage: { tokens: number; messages: number };
  onSaveMeta: (meta: ThreadMeta) => void;
  /** Kelivo's model: returns the new thread id; the caller switches to it. */
  onCompress: (keepTail: number, customPrompt?: string) => Promise<string | null>;
  onExport: () => void;
}) {
  const colors = useColors();
  const s = useStyles();
  const [systemPrompt, setSystemPrompt] = useState(meta.systemPrompt ?? "");
  const [budget, setBudget] = useState(meta.tokenBudget ? String(meta.tokenBudget) : "");
  const [maxTokens, setMaxTokens] = useState(meta.maxTokens ? String(meta.maxTokens) : "");
  const [keepTail, setKeepTail] = useState("6");
  const [customPrompt, setCustomPrompt] = useState("");
  const [compressing, setCompressing] = useState(false);
  const [notice, setNotice] = useState("");
  // P2-1: follow-up chips toggle (A6). Default on; false hides + skips them.
  const [chipsOn, setChipsOn] = useState(meta.followUpChips !== false);
  // Batch 5: persona picker — sets the global active persona.
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [activePersonaId, setActivePersonaId] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setSystemPrompt(meta.systemPrompt ?? "");
      setBudget(meta.tokenBudget ? String(meta.tokenBudget) : "");
      setMaxTokens(meta.maxTokens ? String(meta.maxTokens) : "");
      setKeepTail("6");
      setCustomPrompt("");
      setNotice("");
      setChipsOn(meta.followUpChips !== false);
      void personaStore
        .list()
        .then((ps) => setPersonas(ps.filter((p) => p.enabled)))
        .catch(() => setPersonas([]));
      void personaStore
        .getActiveId()
        .then(setActivePersonaId)
        .catch(() => setActivePersonaId(null));
    }
  }, [visible]);

  const save = () => {
    const n = parseInt(budget.replace(/[^0-9]/g, ""), 10);
    const mt = parseInt(maxTokens.replace(/[^0-9]/g, ""), 10);
    onSaveMeta({
      ...meta,
      systemPrompt: systemPrompt.trim() ? systemPrompt.trim() : undefined,
      tokenBudget: Number.isFinite(n) && n > 0 ? n : undefined,
      maxTokens: Number.isFinite(mt) && mt > 0 ? mt : undefined,
      followUpChips: chipsOn ? undefined : false,
    });
    onClose();
  };

  const doCompress = async () => {
    setCompressing(true);
    try {
      const n = parseInt(keepTail.replace(/[^0-9]/g, ""), 10);
      const newId = await onCompress(
        Number.isFinite(n) && n > 0 ? n : 6,
        customPrompt.trim() ? customPrompt.trim() : undefined,
      );
      setNotice(newId ? t("chat.compressedNewDialog") : t("chat.compressNothing"));
    } finally {
      setCompressing(false);
    }
  };

  const budgetNum = meta.tokenBudget && meta.tokenBudget > 0 ? meta.tokenBudget : 100000;

  return (
    <SheetShell title={t("chat.dialogSettings")} onClose={onClose}>
      <ScrollView style={{ paddingHorizontal: 16 }} keyboardShouldPersistTaps="handled">
        <TText style={{ fontSize: 13, color: colors.muted, marginBottom: 12 }}>{dialogName}</TText>

        {personas.length > 0 ? (
          <>
            <TText style={{ fontWeight: "700", marginBottom: 6 }}>{t("persona.pickerTitle")}</TText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
              <View style={{ flexDirection: "row", gap: 8, paddingVertical: 4 }}>
                <Button
                  key="__none__"
                  onPress={() => {
                    void personaStore.setActiveId(null).then(() => setActivePersonaId(null));
                  }}
                  {...(activePersonaId === null ? { primary: true } : {})}
                >
                  {t("persona.pickerNone")}
                </Button>
                {personas.map((p) => (
                  <Button
                    key={p.id}
                    onPress={() => {
                      void personaStore.setActiveId(p.id).then(() => setActivePersonaId(p.id));
                    }}
                    {...(activePersonaId === p.id ? { primary: true } : {})}
                  >
                    {p.name}
                  </Button>
                ))}
              </View>
            </ScrollView>
            <TText style={[s.small, { color: colors.muted, marginTop: 4, marginBottom: 16 }]}>
              {t("persona.pickerHint")}
            </TText>
          </>
        ) : null}

        <TText style={{ fontWeight: "700", marginBottom: 6 }}>{t("chat.dialogSystemPrompt")}</TText>
        <TextInput
          value={systemPrompt}
          onChangeText={setSystemPrompt}
          placeholder={t("chat.dialogSystemPromptHint")}
          placeholderTextColor={colors.muted}
          multiline
          style={{
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radii.lg,
            padding: 12,
            fontSize: 14,
            color: colors.text,
            minHeight: 80,
            backgroundColor: colors.card,
            textAlignVertical: "top",
          }}
        />
        <TText style={[s.small, { color: colors.muted, marginTop: 4, marginBottom: 16 }]}>
          {t("chat.dialogSystemPromptHint")}
        </TText>

        <TText style={{ fontWeight: "700", marginBottom: 6 }}>{t("chat.dialogTokenBudget")}</TText>
        <TextInput
          value={budget}
          onChangeText={setBudget}
          placeholder="100000"
          placeholderTextColor={colors.muted}
          keyboardType="numeric"
          style={{
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radii.lg,
            padding: 12,
            fontSize: 14,
            color: colors.text,
            backgroundColor: colors.card,
          }}
        />
        <TText style={[s.small, { color: colors.muted, marginTop: 4, marginBottom: 16 }]}>
          {t("chat.dialogTokenBudgetHint")}
        </TText>

        <TText style={{ fontWeight: "700", marginBottom: 6 }}>{t("chat.dialogMaxTokens")}</TText>
        <TextInput
          value={maxTokens}
          onChangeText={setMaxTokens}
          placeholder="4000"
          placeholderTextColor={colors.muted}
          keyboardType="numeric"
          style={{
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radii.lg,
            padding: 12,
            fontSize: 14,
            color: colors.text,
            backgroundColor: colors.card,
          }}
        />
        <TText style={[s.small, { color: colors.muted, marginTop: 4, marginBottom: 16 }]}>
          {t("chat.dialogMaxTokensHint")}
        </TText>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 4,
          }}
        >
          <View style={{ flex: 1, marginRight: 12 }}>
            <TText style={{ fontWeight: "700" }}>{t("chat.followUpChips")}</TText>
            <TText style={[s.small, { color: colors.muted, marginTop: 2 }]}>
              {t("chat.followUpChipsHint")}
            </TText>
          </View>
          <Switch
            accessibilityLabel={t("chat.followUpChips")}
            value={chipsOn}
            onValueChange={setChipsOn}
          />
        </View>
        <View style={{ height: 12 }} />

        <Card style={{ marginBottom: 16 }}>
          <TText style={{ fontWeight: "700", marginBottom: 4 }}>
            {t("chat.contextUsage", {
              used: usage.tokens.toLocaleString(),
              budget: budgetNum.toLocaleString(),
            })}
          </TText>
          <View
            style={{
              height: 6,
              borderRadius: 3,
              backgroundColor: colors.line,
              overflow: "hidden",
              marginBottom: 12,
            }}
          >
            <View
              style={{
                height: 6,
                borderRadius: 3,
                width: `${Math.min(100, (usage.tokens / budgetNum) * 100)}%`,
                backgroundColor: usage.tokens > budgetNum * 0.9 ? colors.danger : colors.blueDark,
              }}
            />
          </View>
          <TText style={[s.small, { color: colors.muted, marginBottom: 6 }]}>
            {t("chat.compressNewDialogHint")}
          </TText>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
            <View style={{ flex: 1 }}>
              <TText style={[s.small, { color: colors.muted, marginBottom: 4 }]}>
                {t("chat.compressKeepTail")}
              </TText>
              <TextInput
                value={keepTail}
                onChangeText={setKeepTail}
                keyboardType="numeric"
                style={{
                  borderWidth: 1,
                  borderColor: colors.line,
                  borderRadius: radii.lg,
                  padding: 10,
                  fontSize: 14,
                  color: colors.text,
                  backgroundColor: colors.canvas,
                }}
              />
            </View>
          </View>
          <TText style={[s.small, { color: colors.muted, marginBottom: 4 }]}>
            {t("chat.compressCustomPrompt")}
          </TText>
          <TextInput
            value={customPrompt}
            onChangeText={setCustomPrompt}
            placeholder={t("chat.compressCustomPromptHint")}
            placeholderTextColor={colors.muted}
            multiline
            style={{
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: radii.lg,
              padding: 10,
              fontSize: 14,
              color: colors.text,
              backgroundColor: colors.canvas,
              minHeight: 56,
              textAlignVertical: "top",
              marginBottom: 12,
            }}
          />
          <Button small onPress={() => void doCompress()} busy={compressing} icon={Scissors}>
            {t("chat.compressContext")}
          </Button>
          {notice ? (
            <TText style={[s.small, { color: colors.muted, marginTop: 8 }]}>{notice}</TText>
          ) : null}
        </Card>

        <Button small onPress={onExport} icon={ShareIcon} style={{ marginBottom: 12 }}>
          {t("chat.exportDialog")}
        </Button>
        <Button small primary onPress={save}>
          {t("common.save")}
        </Button>
        <View style={{ height: 40 }} />
      </ScrollView>
    </SheetShell>
  );
}

// ---------------------------------------------------------------------------
// A17 quick phrases
// ---------------------------------------------------------------------------

const QUICK_PHRASES_KEY = "dudu.quick-phrases.v1";

export async function loadQuickPhrases(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(QUICK_PHRASES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

export async function saveQuickPhrases(phrases: string[]): Promise<void> {
  await AsyncStorage.setItem(QUICK_PHRASES_KEY, JSON.stringify(phrases));
}

export function QuickPhrasesSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (phrase: string) => void;
}) {
  const colors = useColors();
  const [phrases, setPhrases] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (visible) {
      setDraft("");
      void loadQuickPhrases().then(setPhrases);
    }
  }, [visible]);

  const add = async () => {
    const p = draft.trim();
    if (!p) return;
    const next = [...phrases, p];
    setPhrases(next);
    setDraft("");
    await saveQuickPhrases(next);
  };

  const remove = async (idx: number) => {
    const next = phrases.filter((_, i) => i !== idx);
    setPhrases(next);
    await saveQuickPhrases(next);
  };

  return (
    <SheetShell title={t("chat.quickPhrasesTitle")} onClose={onClose}>
      <View style={{ paddingHorizontal: 16, gap: 8, marginBottom: 12 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radii.lg,
            paddingHorizontal: 12,
            backgroundColor: colors.card,
          }}
        >
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t("chat.quickPhrasePlaceholder")}
            placeholderTextColor={colors.muted}
            style={{ flex: 1, fontSize: 14, color: colors.text, paddingVertical: 10 }}
            onSubmitEditing={() => void add()}
          />
          <Pressable onPress={() => void add()} style={{ padding: 6 }}>
            <Plus size={18} color={colors.text} />
          </Pressable>
        </View>
      </View>
      <ScrollView style={{ paddingHorizontal: 16 }}>
        {phrases.map((p, i) => (
          <View
            key={`${i}:${p}`}
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingVertical: 10,
              borderBottomWidth: 1,
              borderBottomColor: colors.line,
            }}
          >
            <Pressable
              style={{ flex: 1 }}
              onPress={() => {
                onClose();
                onPick(p);
              }}
            >
              <TText style={{ fontSize: 14 }}>{p}</TText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("chat.quickPhraseDelete")}
              onPress={() => void remove(i)}
              style={{ padding: 8 }}
            >
              <Trash2 size={15} color={colors.danger} />
            </Pressable>
          </View>
        ))}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SheetShell>
  );
}

// ---------------------------------------------------------------------------
// A22 slash commands popup (inline, above the composer)
// ---------------------------------------------------------------------------

export interface SlashCommand {
  name: string;
  label: string;
  hint: string;
  icon: LucideIcon;
}

export function slashCommands(): SlashCommand[] {
  return [
    { name: "img", label: t("chat.slash.img"), hint: t("chat.slash.imgHint"), icon: Camera },
    {
      name: "search",
      label: t("chat.slash.search"),
      hint: t("chat.slash.searchHint"),
      icon: Search,
    },
    {
      name: "remember",
      label: t("chat.slash.recall"),
      hint: t("chat.slash.recallHint"),
      icon: Sparkles,
    },
    { name: "new", label: t("chat.slash.new"), hint: t("chat.slash.newHint"), icon: Plus },
    {
      name: "compress",
      label: t("chat.slash.compress"),
      hint: t("chat.slash.compressHint"),
      icon: Scissors,
    },
    {
      name: "export",
      label: t("chat.slash.export"),
      hint: t("chat.slash.exportHint"),
      icon: ShareIcon,
    },
    { name: "clear", label: t("chat.slash.clear"), hint: t("chat.slash.clearHint"), icon: Trash2 },
  ];
}

export function SlashCommandList({
  query,
  onPick,
}: {
  query: string;
  onPick: (name: string) => void;
}) {
  const colors = useColors();
  const q = query.toLowerCase();
  const matches = slashCommands().filter((c) => c.name.startsWith(q));
  if (!matches.length) return null;
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radii.lg,
        backgroundColor: colors.card,
        overflow: "hidden",
        marginBottom: 8,
      }}
    >
      {matches.map((c) => (
        <Pressable
          key={c.name}
          onPress={() => onPick(c.name)}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
            backgroundColor: pressed ? colors.line : "transparent",
          })}
        >
          <c.icon size={15} color={colors.muted} />
          <View style={{ flex: 1 }}>
            <TText style={{ fontSize: 14, fontWeight: "600" }}>/ {c.name}</TText>
            <TText style={{ fontSize: 12, color: colors.muted }}>{c.hint}</TText>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// A26 round screenshot: render one Q&A round, capture, share
// ---------------------------------------------------------------------------

export interface ShotRound {
  question: string;
  answer: string;
}

export function RoundShotModal({
  visible,
  onClose,
  round,
}: {
  visible: boolean;
  onClose: () => void;
  round: ShotRound | null;
}) {
  const colors = useColors();
  const shotRef = useRef<ViewShotRef>(null);
  const [capturing, setCapturing] = useState(false);

  const capture = async () => {
    const shot = shotRef.current;
    if (!shot?.capture) return;
    setCapturing(true);
    try {
      // capture() resolves with a file URI (png) — same pattern as AIBrowserView.
      const uri = await shot.capture();
      await Share.share({ url: uri, title: t("chat.roundShotTitle") });
    } catch (e) {
      Alert.alert(t("chat.roundShotFailed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setCapturing(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.canvas, paddingTop: 48 }}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            paddingHorizontal: 16,
            marginBottom: 12,
          }}
        >
          <TText style={{ fontSize: 18, fontWeight: "700" }}>{t("chat.roundShotTitle")}</TText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
            onPress={onClose}
            style={{ padding: 8 }}
          >
            <X size={20} color={colors.text} />
          </Pressable>
        </View>
        <ScrollView style={{ flex: 1, paddingHorizontal: 16 }}>
          <ViewShot
            ref={shotRef}
            options={{ format: "png", quality: 0.95 }}
            style={{ backgroundColor: colors.canvas, borderRadius: radii.lg, padding: 16, gap: 10 }}
          >
            {round ? (
              <>
                <View
                  style={{
                    alignSelf: "flex-end",
                    maxWidth: "85%",
                    backgroundColor: colors.blueDark,
                    borderRadius: 16,
                    borderBottomRightRadius: 6,
                    paddingHorizontal: 12,
                    paddingVertical: 9,
                  }}
                >
                  <TText style={{ color: colors.onBlue, fontSize: 14 }}>{round.question}</TText>
                </View>
                <View
                  style={{
                    alignSelf: "flex-start",
                    maxWidth: "85%",
                    backgroundColor: colors.card,
                    borderWidth: 1,
                    borderColor: colors.line,
                    borderRadius: 16,
                    borderBottomLeftRadius: 6,
                    paddingHorizontal: 12,
                    paddingVertical: 9,
                  }}
                >
                  <TText style={{ color: colors.text, fontSize: 14 }}>{round.answer}</TText>
                </View>
              </>
            ) : null}
          </ViewShot>
          <View style={{ height: 16 }} />
          <Button primary onPress={() => void capture()} busy={capturing} icon={ShareIcon}>
            {t("chat.roundShot")}
          </Button>
          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

// DialogInfo is used by callers that list dialogs; ThreadMeta by the settings sheet.
export type { DialogInfo };
