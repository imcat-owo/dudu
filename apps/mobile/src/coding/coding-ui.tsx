/**
 * CodingPlanCard / CodingReportCard — the E3 loop's face in chat.
 *
 * Plan card: shown while a task waits for her decision. She approves or
 * stops it here — the engine refuses any write/run/verify before approval.
 * Report card: shown after complete(), with the honest outcome.
 */

import { useSyncExternalStore } from "react";
import { View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { radii } from "../theme/radii";
import { Button, Card, useColors, useStyles } from "../ui";
import { codingStore } from "./instances";
import type { CodingTask } from "./types";

function useActiveTask(threadId: string): CodingTask | null {
  const snap = useSyncExternalStore(
    codingStore.subscribe,
    codingStore.getSnapshot,
    codingStore.getSnapshot,
  );
  return (
    snap.tasks.find(
      (task) =>
        task.threadId === threadId &&
        (task.status === "proposed" || task.status === "approved" || task.status === "in_progress"),
    ) ?? null
  );
}

function useLatestReport(threadId: string): CodingTask | null {
  const snap = useSyncExternalStore(
    codingStore.subscribe,
    codingStore.getSnapshot,
    codingStore.getSnapshot,
  );
  const done = snap.tasks
    .filter(
      (task) => task.threadId === threadId && (task.status === "done" || task.status === "failed"),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return done[0] ?? null;
}

function StatusLine({ task }: { task: CodingTask }) {
  const colors = useColors();
  const label =
    task.status === "proposed"
      ? t("coding.status.proposed")
      : task.status === "approved"
        ? t("coding.status.approved")
        : t("coding.status.inProgress");
  return <TText style={{ fontSize: 12, color: colors.muted, marginBottom: 8 }}>{label}</TText>;
}

export function CodingPlanCard({ threadId }: { threadId: string }) {
  const task = useActiveTask(threadId);
  const colors = useColors();
  const s = useStyles();
  if (!task) return null;

  const decided = task.status !== "proposed";
  return (
    <Card
      style={{
        marginHorizontal: 16,
        marginBottom: 8,
        borderColor: colors.blueDark,
        borderWidth: 1.5,
      }}
    >
      <TText style={{ fontSize: 16, fontWeight: "700", marginBottom: 4 }}>
        {t("coding.plan.title")}
      </TText>
      <TText style={{ fontWeight: "700", marginBottom: 6 }}>{task.title}</TText>
      <StatusLine task={task} />
      <TText style={[s.small, { color: colors.muted, marginBottom: 2 }]}>
        {t("coding.plan.request")}
      </TText>
      <TText style={{ marginBottom: 8 }}>{task.request}</TText>
      <TText style={[s.small, { color: colors.muted, marginBottom: 4 }]}>
        {t("coding.plan.steps", { n: task.steps.length })}
      </TText>
      <View style={{ gap: 6, marginBottom: 8 }}>
        {task.steps.map((step, i) => (
          <View
            key={step.id}
            style={{
              flexDirection: "row",
              gap: 8,
              padding: 8,
              borderRadius: radii.sm,
              backgroundColor: colors.canvas,
            }}
          >
            <TText style={{ fontWeight: "700", color: colors.blueDark }}>{i + 1}</TText>
            <View style={{ flex: 1 }}>
              <TText style={{ fontWeight: "600" }}>{step.title}</TText>
              {step.detail ? (
                <TText style={[s.small, { color: colors.muted }]}>{step.detail}</TText>
              ) : null}
              {step.files.length > 0 ? (
                <TText style={[s.small, { color: colors.muted }]}>
                  {t("coding.plan.files")}: {step.files.join(", ")}
                </TText>
              ) : null}
            </View>
          </View>
        ))}
      </View>
      <TText style={[s.small, { color: colors.muted, marginBottom: 2 }]}>
        {t("coding.plan.outcome")}
      </TText>
      <TText style={{ marginBottom: 8 }}>{task.expectedOutcome}</TText>
      <TText style={[s.small, { color: colors.muted, marginBottom: 2 }]}>
        {t("coding.plan.doneCriteria")}
      </TText>
      <TText style={{ marginBottom: 12 }}>{task.doneCriteria}</TText>
      {!decided ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button small primary onPress={() => codingStore.decide(task.id, true)}>
              {t("coding.plan.approve")}
            </Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button small onPress={() => codingStore.decide(task.id, false)}>
              {t("coding.plan.reject")}
            </Button>
          </View>
        </View>
      ) : null}
    </Card>
  );
}

export function CodingReportCard({ threadId }: { threadId: string }) {
  const task = useLatestReport(threadId);
  const colors = useColors();
  const s = useStyles();
  if (!task?.report) return null;

  const ok = task.status === "done";
  return (
    <Card
      style={{
        marginHorizontal: 16,
        marginBottom: 8,
        borderColor: ok ? colors.green : colors.danger,
        borderWidth: 1.5,
      }}
    >
      <TText style={{ fontSize: 16, fontWeight: "700", marginBottom: 4 }}>
        {t("coding.report.title")}
      </TText>
      <TText
        style={{
          fontWeight: "700",
          marginBottom: 8,
          color: ok ? colors.green : colors.danger,
        }}
      >
        {ok ? t("coding.report.done") : t("coding.report.failed")}
      </TText>
      <TText style={{ marginBottom: 8 }}>{task.report}</TText>
      {task.verify ? (
        <TText style={[s.small, { color: colors.muted }]}>
          {t("coding.report.verify")}: {task.verify.summary}
        </TText>
      ) : null}
    </Card>
  );
}
