import { ArrowRight, Bell, X } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useAgentWorkspace } from "./agent-workspace";
import { t } from "./i18n";
import { Button, Card, ErrorNotice, resultSummary, useColors, useStyles } from "./ui";
import { useWorkspace } from "./workspace";
import { TText } from "./font";

export function BackgroundUpdates() {
  const colors = useColors();
  const s = useStyles();
  const { data, mutate } = useAgentWorkspace();
  const { open } = useWorkspace();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const updates = data?.notifications.filter((item) => !item.read && item.taskId) || [];
  const update = updates[0];
  if (!update || data?.identity.showChatUpdates === false) return null;
  async function dismiss() {
    if (!update) return;
    setBusy(true);
    try {
      await mutate(`/notifications/${update.id}/read`, {});
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={{ backgroundColor: colors.sky, padding: 16, gap: 10 }}>
      <View style={[s.between, { gap: 12 }]}>
        <View style={[s.row, { gap: 7 }]}>
          <Bell size={14} color={colors.blueDark} />
          <TText style={s.small}>给你的更新</TText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("a11y.dismissUpdate")}
          disabled={busy}
          onPress={() => void dismiss()}
          hitSlop={10}
          style={{ padding: 6 }}
        >
          <X size={16} color={colors.muted} />
        </Pressable>
      </View>
      <TText style={s.heading}>{update.title}</TText>
      <TText style={s.text}>{resultSummary(update.body)}</TText>
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button
          small
          icon={ArrowRight}
          onPress={() => update.taskId && open({ type: "task", taskId: update.taskId })}
        >
          View task
        </Button>
        {updates.length > 1 && (
          <Button small onPress={() => open({ type: "notifications" })}>
            {updates.length - 1} more updates
          </Button>
        )}
      </View>
      <ErrorNotice error={error} />
    </Card>
  );
}
