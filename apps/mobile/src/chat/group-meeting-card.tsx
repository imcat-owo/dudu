/**
 * GroupMeetingCard — makes AI group meetings (开会) visible to her (P2-13).
 *
 * Rendered in chat when a meeting for this thread is still "discussing":
 * topic, members, round progress, and a stop button. Without this card the
 * meeting was invisible while running — she only saw "开完会了，结论是…".
 * Stopping calls groupMeetingStore.end(); run_meeting_round re-checks the
 * plan before every round, so the AI halts at the next round boundary.
 */

import { useEffect, useState } from "react";
import { View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { Button, Card, useColors, useStyles } from "../ui";
import { groupMeetingStore } from "./group-meeting-instance";
import type { GroupMeeting } from "./group-meeting";

function useActiveMeetings(threadId: string): GroupMeeting[] {
  const [meetings, setMeetings] = useState<GroupMeeting[]>([]);
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      groupMeetingStore
        .list()
        .then((all) => {
          if (alive)
            setMeetings(
              all.filter((m) => m.createdByThreadId === threadId && m.status === "discussing"),
            );
        })
        .catch(() => {});
    refresh();
    const unsub = groupMeetingStore.subscribe(refresh);
    return () => {
      alive = false;
      unsub();
    };
  }, [threadId]);
  return meetings;
}

export function GroupMeetingCard({ threadId }: { threadId: string }) {
  const meetings = useActiveMeetings(threadId);
  const colors = useColors();
  const s = useStyles();
  if (meetings.length === 0) return null;

  return (
    <View style={{ gap: 8 }}>
      {meetings.map((m) => (
        <Card key={m.id} style={{ marginHorizontal: 16, borderColor: colors.blueDark, borderWidth: 1.5 }}>
          <TText style={{ fontSize: 16, fontWeight: "700", marginBottom: 4 }}>
            {t("meeting.liveTitle")}
          </TText>
          <TText style={{ fontWeight: "700", marginBottom: 6 }}>{m.topic}</TText>
          <TText style={[s.small, { color: colors.muted, marginBottom: 2 }]}>
            {t("meeting.members", { n: m.members.length })}
          </TText>
          <TText style={{ marginBottom: 6 }}>
            {m.members.map((x) => x.displayName).join("、")}
          </TText>
          <TText style={[s.small, { color: colors.muted, marginBottom: 10 }]}>
            {t("meeting.round", { done: m.roundsCompleted, total: m.maxRounds })}
          </TText>
          <Button
            small
            danger
            onPress={() =>
              void groupMeetingStore.end(m.id, t("meeting.stoppedByHer") as string)
            }
          >
            {t("meeting.stop")}
          </Button>
        </Card>
      ))}
    </View>
  );
}
