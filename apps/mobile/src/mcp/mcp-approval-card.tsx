/**
 * McpApprovalCard — the real in-session MCP tool approval card (D13).
 *
 * Rendered in chat when the AI wants to call an MCP server tool whose
 * per-tool approval is "ask". She taps Allow / Deny, optionally checking
 * "Remember my choice". Her choice takes real effect:
 *   - Allow  → the tool call proceeds,
 *   - Deny   → the tool is blocked and the model is told she declined,
 *   - Remember → persisted into the server's `toolApprovals` (via the
 *     provider in mcp/provider.ts) so it sticks for subsequent calls.
 *
 * Card follows the same conventions as PlanGateCard (blueDark accent
 * border, theme tokens only, no hardcoded colors, zero emoji).
 */

import { useState } from "react";
import { View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { radii } from "../theme/radii";
import { Button, Card, CheckRow, useColors, useStyles } from "../ui";
import { answerMcpApprovalRequest, type McpApprovalRequest } from "./tool-approval";

export function McpApprovalCard({ request }: { request: McpApprovalRequest }) {
  const colors = useColors();
  const s = useStyles();
  const [remember, setRemember] = useState(false);

  const decide = (allowed: boolean) => {
    answerMcpApprovalRequest(request.id, { allowed, remember });
  };

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
        {t("mcp.approval.title")}
      </TText>
      <TText style={{ marginBottom: 8 }}>
        {t("mcp.approval.toolFrom", { tool: request.toolName, server: request.serverName })}
      </TText>
      {request.argsSummary ? (
        <View
          style={{
            padding: 8,
            borderRadius: radii.sm,
            backgroundColor: colors.canvas,
            marginBottom: 4,
          }}
        >
          <TText style={[s.small, { color: colors.muted, marginBottom: 2 }]}>
            {t("mcp.approval.args")}
          </TText>
          <TText style={[s.small, { color: colors.text }]} numberOfLines={5}>
            {request.argsSummary}
          </TText>
        </View>
      ) : null}
      <CheckRow
        label={t("mcp.approval.remember")}
        checked={remember}
        onPress={() => setRemember((v) => !v)}
      />
      <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
        <View style={{ flex: 1 }}>
          <Button small primary onPress={() => decide(true)}>
            {t("mcp.approval.allow")}
          </Button>
        </View>
        <View style={{ flex: 1 }}>
          <Button small onPress={() => decide(false)}>
            {t("mcp.approval.deny")}
          </Button>
        </View>
      </View>
    </Card>
  );
}
