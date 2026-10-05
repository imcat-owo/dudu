/**
 * D21: pure helpers for the per-tool approval management UI (mcp-settings.tsx).
 *
 * PURE module (no React Native imports) so it stays unit-testable under
 * plain tsx.
 *
 * The provider honors `server.toolApprovals` (provider.ts getApproval) and
 * the D13 approval card writes into it via "remember my choice" — the
 * settings UI reads and writes this same record so nothing she sets is a
 * write-only black box.
 */

import type { McpServerConfig } from "./types";

/**
 * Returns a NEW server config with the tool's approval updated in the
 * `toolApprovals` record. "ask" is the provider default — choosing it
 * removes the override so the record holds real overrides only.
 */
export function withToolApproval(
  server: McpServerConfig,
  toolName: string,
  decision: "ask" | "allow" | "deny",
): McpServerConfig {
  const next: Record<string, "ask" | "allow" | "deny"> = { ...(server.toolApprovals ?? {}) };
  if (decision === "ask") delete next[toolName];
  else next[toolName] = decision;
  return { ...server, toolApprovals: next };
}
