/**
 * Cross-dialog trace UI (vision feature 2: 留痕).
 *
 * The sheet she opens to see everything the AI did in her other dialogs:
 * every list/read/send, when, from where, to where, and why. Plus the
 * send-tag visibility settings (global + per dialog).
 *
 * The trace itself has no off switch — the toggles below only control the
 * in-dialog "from dialog X" tag, and the UI says so plainly.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MessagesSquare } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import {
  Button,
  Card,
  CheckRow,
  Empty,
  ErrorNotice,
  SectionHeading,
  Sheet,
  useStyles,
} from "../ui";
import { useWorkspace } from "../workspace";
import { type DialogInfo, listDialogs } from "./cross-dialog";
import { crossDialogTraceStore, crossDialogVisibilityStore } from "./cross-dialog-instance";
import type { CrossDialogTraceEntry, CrossDialogVisibilitySnapshot } from "./cross-dialog-trace";

function formatTime(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function actionLabel(action: CrossDialogTraceEntry["action"]): string {
  switch (action) {
    case "list":
      return t("crossDialog.actionList");
    case "read":
      return t("crossDialog.actionRead");
    case "send":
      return t("crossDialog.actionSend");
    case "meeting_create":
      return t("crossDialog.actionMeetingCreate");
    case "meeting_round":
      return t("crossDialog.actionMeetingRound");
    case "meeting_end":
      return t("crossDialog.actionMeetingEnd");
    case "proactive_send":
      return t("crossDialog.actionProactiveSend");
    case "feed_nudge":
      return t("crossDialog.actionFeedNudge");
    case "openapp_return":
      return t("crossDialog.actionOpenAppReturn");
    case "persona_group_create":
      return t("crossDialog.actionPersonaGroupCreate");
    case "persona_group_round":
      return t("crossDialog.actionPersonaGroupRound");
    case "persona_group_add_member":
      return t("crossDialog.actionPersonaGroupAddMember");
    case "persona_group_remove_member":
      return t("crossDialog.actionPersonaGroupRemoveMember");
    case "persona_group_set_model":
      return t("crossDialog.actionPersonaGroupSetModel");
    case "persona_group_archive":
      return t("crossDialog.actionPersonaGroupArchive");
  }
}

function TraceRow({ entry }: { entry: CrossDialogTraceEntry }) {
  const s = useStyles();
  const target = entry.toName || entry.toThreadId ? ` → ${entry.toName ?? entry.toThreadId}` : "";
  return (
    <View style={{ gap: 4, paddingVertical: 10 }}>
      <View style={[s.row, { gap: 8, alignItems: "center" }]}>
        <TText style={s.heading}>{actionLabel(entry.action)}</TText>
        <TText style={s.small}>
          {entry.fromName}
          {target}
        </TText>
      </View>
      <TText style={s.muted} numberOfLines={3}>
        {entry.summary}
      </TText>
      <View style={[s.row, { gap: 8 }]}>
        <TText style={s.small}>{formatTime(entry.at)}</TText>
        <TText style={s.small} numberOfLines={1}>
          {entry.reason}
        </TText>
      </View>
    </View>
  );
}

export function CrossDialogTraceSheet() {
  const s = useStyles();
  const { close } = useWorkspace();
  const [entries, setEntries] = useState<CrossDialogTraceEntry[] | null>(null);
  const [visibility, setVisibility] = useState<CrossDialogVisibilitySnapshot | null>(null);
  const [dialogs, setDialogs] = useState<DialogInfo[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  async function refresh() {
    try {
      const [e, v, d] = await Promise.all([
        crossDialogTraceStore.list(100),
        crossDialogVisibilityStore.getSnapshot(),
        listDialogs(AsyncStorage),
      ]);
      setEntries(e);
      setVisibility(v);
      setDialogs(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void refresh();
    const un1 = crossDialogTraceStore.subscribe(() => void refresh());
    const un2 = crossDialogVisibilityStore.subscribe(() => void refresh());
    return () => {
      un1();
      un2();
    };
  }, []);

  async function mutate(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={t("crossDialog.traceTitle")}
      subtitle={t("crossDialog.traceSubtitle")}
      onClose={close}
    >
      <View style={{ gap: 16 }}>
        <ErrorNotice error={error} />
        <Card style={{ gap: 4 }}>
          <SectionHeading title={t("crossDialog.sendTagVisible")} />
          <TText style={s.muted}>{t("crossDialog.sendTagVisibleDetail")}</TText>
          {visibility ? (
            <CheckRow
              label={t("crossDialog.sendTagVisible")}
              checked={visibility.sendTagVisible}
              onPress={() =>
                void mutate(() =>
                  crossDialogVisibilityStore.setGlobalVisible(!visibility.sendTagVisible),
                )
              }
            />
          ) : (
            <ActivityIndicator />
          )}
          {dialogs && dialogs.length > 0 && visibility && (
            <>
              <SectionHeading title={t("crossDialog.perDialog")} />
              {dialogs.map((d) => {
                const override = visibility.dialogOverrides[d.id];
                const effective =
                  typeof override === "boolean" ? override : visibility.sendTagVisible;
                return (
                  <View key={d.id} style={{ gap: 2 }}>
                    <CheckRow
                      label={d.name}
                      checked={effective}
                      onPress={() =>
                        void mutate(() =>
                          crossDialogVisibilityStore.setDialogVisible(d.id, !effective),
                        )
                      }
                    />
                    {override !== undefined && (
                      <View style={[s.row, { justifyContent: "flex-end" }]}>
                        <Button
                          small
                          onPress={() =>
                            void mutate(() =>
                              crossDialogVisibilityStore.setDialogVisible(d.id, null),
                            )
                          }
                        >
                          {t("crossDialog.followGlobal")}
                        </Button>
                      </View>
                    )}
                  </View>
                );
              })}
            </>
          )}
        </Card>
        <View style={[s.row, { justifyContent: "space-between", alignItems: "center" }]}>
          <SectionHeading title={t("crossDialog.traceTitle")} />
          {entries && entries.length > 0 && (
            <Button
              small
              busy={busy}
              onPress={() => {
                if (confirmClear) {
                  setConfirmClear(false);
                  void mutate(() => crossDialogTraceStore.clear());
                } else {
                  setConfirmClear(true);
                }
              }}
            >
              {confirmClear ? t("crossDialog.clearConfirm") : t("crossDialog.clearTrace")}
            </Button>
          )}
        </View>
        {entries === null ? (
          <ActivityIndicator />
        ) : entries.length === 0 ? (
          <Empty icon={MessagesSquare} title={t("crossDialog.traceEmpty")} detail="" />
        ) : (
          <Card style={{ paddingVertical: 2 }}>
            {entries.map((e) => (
              <TraceRow key={e.id} entry={e} />
            ))}
          </Card>
        )}
      </View>
    </Sheet>
  );
}
