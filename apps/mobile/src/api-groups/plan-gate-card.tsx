/**
 * PlanGateCard — the plan-only gate she sees (开启原则).
 *
 * Rendered in chat when the AI has proposed a multi-model coordination
 * plan for this thread and she's still deciding. She approves or stops it
 * right here, anytime — the AI only proceeds after check_plan_status
 * reports "approved".
 */

import { useSyncExternalStore } from "react";
import { View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { radii } from "../theme/radii";
import { Button, Card, useColors, useStyles } from "../ui";
import { planGateStore } from "./plan-gate";

function useActivePlan(threadId: string) {
  const snap = useSyncExternalStore(
    planGateStore.subscribe,
    planGateStore.getSnapshot,
    planGateStore.getSnapshot,
  );
  return snap.plans.find((p) => p.threadId === threadId && p.status === "proposed") ?? null;
}

export function PlanGateCard({ threadId }: { threadId: string }) {
  const plan = useActivePlan(threadId);
  const colors = useColors();
  const s = useStyles();
  if (!plan) return null;

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
        {t("plangate.title")}
      </TText>
      <TText style={{ fontWeight: "700", marginBottom: 6 }}>{plan.title}</TText>
      <TText style={[s.small, { color: colors.muted, marginBottom: 2 }]}>
        {t("plangate.reason")}
      </TText>
      <TText style={{ marginBottom: 8 }}>{plan.reason}</TText>
      <TText style={[s.small, { color: colors.muted, marginBottom: 4 }]}>
        {t("plangate.steps", { n: plan.steps.length })}
      </TText>
      <View style={{ gap: 6, marginBottom: 12 }}>
        {plan.steps.map((step, i) => (
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
            </View>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button small primary onPress={() => planGateStore.decide(plan.id, true)}>
            {t("plangate.approve")}
          </Button>
        </View>
        <View style={{ flex: 1 }}>
          <Button small onPress={() => planGateStore.decide(plan.id, false)}>
            {t("plangate.reject")}
          </Button>
        </View>
      </View>
    </Card>
  );
}
