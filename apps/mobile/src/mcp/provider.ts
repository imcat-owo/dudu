/**
 * MCP tool provider — plugs external MCP servers into the local tool registry.
 *
 * Each enabled MCP server becomes an McpToolProvider: its tools are listed
 * via the MCP client and exposed as LocalTools (prefixed `mcp__<server>__`
 * to avoid collisions). Per-tool approval (ask/allow/deny) is enforced by
 * the MCP client before any call reaches the server.
 *
 * Wiring into the registry happens in local-agent.ts (integration point).
 * This module only builds the providers.
 */

import { logDiag } from "../api-groups/diagnostics";
import type { LocalTool } from "../api-groups/local-tools";
import { createMcpClient } from "./client";
import { mcpStore } from "./store";
import type { McpApprovalOutcome } from "./tool-approval";
import type { McpServerConfig, McpToolDefinition } from "./types";

export interface McpProviderDeps {
  env: Record<string, string>;
  /**
   * Ask her to approve a tool call (approval mode "ask"). Renders the real
   * in-session approval card (D13). `remember: true` means she checked
   * "remember my choice" — the provider persists it into
   * `server.toolApprovals` so it sticks for subsequent calls.
   */
  requestApproval: (
    serverId: string,
    serverName: string,
    toolName: string,
    args: unknown,
  ) => Promise<McpApprovalOutcome>;
  /** Run the OAuth browser flow; resolves with nothing (tokens are saved by the client). */
  runOAuthFlow: (server: McpServerConfig) => Promise<void>;
  /** Localized strings for tool descriptions. */
  strings: { toolDesc: (serverName: string, toolDesc: string) => string };
}

function toLocalTool(
  server: McpServerConfig,
  def: McpToolDefinition,
  call: (name: string, args: Record<string, unknown>) => Promise<string>,
): LocalTool {
  return {
    name: `mcp__${server.id}__${def.name}`,
    description: `[MCP:${server.name}] ${def.description ?? def.name}`,
    parameters: def.inputSchema as unknown as LocalTool["parameters"],
    run: async (args: Record<string, unknown>, _ctx) => {
      return call(def.name, args);
    },
  };
}

export async function createMcpProviders(deps: McpProviderDeps): Promise<
  Array<{
    providerId: string;
    listTools: () => Promise<LocalTool[]>;
    callTool: (name: string, args: Record<string, unknown>) => Promise<string>;
  }>
> {
  const { servers } = mcpStore.getSnapshot();
  const providers = [];

  for (const server of servers) {
    if (!server.enabled) continue;
    // Per-provider working copy of approvals: "remember" updates it
    // immediately so the very next call is honored, and the persisted
    // store (mcpStore) keeps it across sessions.
    const approvals: Record<string, "ask" | "allow" | "deny"> = {
      ...(server.toolApprovals ?? {}),
    };
    const client = createMcpClient(server, {
      env: deps.env,
      getTokens: () => mcpStore.getTokens(server.id),
      saveTokens: (t) => mcpStore.saveTokens(server.id, t),
      getClientCreds: () => mcpStore.getClientCreds(server.id),
      onNeedsAuth: async () => {
        await deps.runOAuthFlow(server);
        const tokens = await mcpStore.getTokens(server.id);
        if (!tokens) throw new Error("OAuth flow did not produce tokens");
        return tokens;
      },
      getApproval: (toolName) => approvals[toolName] ?? "ask",
      requestApproval: async (toolName, args) => {
        const outcome = await deps.requestApproval(server.id, server.name, toolName, args);
        if (outcome.remember) {
          approvals[toolName] = outcome.allowed ? "allow" : "deny";
          // Persist so it sticks; the in-memory copy above already honors it.
          // P3: never silently drop her "remember" choice — surface a persist
          // failure in the diagnostics log instead of swallowing it.
          await mcpStore.upsert({ ...server, toolApprovals: { ...approvals } }).catch((e) => {
            void logDiag({
              at: Date.now(),
              kind: "mcp",
              groupId: `mcp:${server.id}`,
              groupName: server.name,
              request: {
                url: "",
                model: "",
                messageCount: 0,
                bodyBytes: 0,
                bodyPreview: "",
              },
              response: {
                ok: false,
                ms: 0,
                error: `toolApprovals persist failed (${toolName}): ${
                  e instanceof Error ? e.message : String(e)
                }`.slice(0, 300),
              },
            });
          });
        }
        return outcome.allowed;
      },
    });

    // Connect lazily on first listTools; keep the client for calls.
    let connected = false;
    let cachedTools: McpToolDefinition[] | null = null;

    async function ensureConnected(): Promise<void> {
      if (connected) return;
      await client.connect();
      connected = true;
    }

    providers.push({
      providerId: `mcp:${server.id}`,
      listTools: async () => {
        await ensureConnected();
        if (!cachedTools) cachedTools = await client.listTools();
        return cachedTools.map((def) =>
          toLocalTool(server, def, async (name, args) => {
            await ensureConnected();
            const result = await client.callTool(name, args);
            if (result.isError) {
              throw new Error(
                result.content.map((c) => c.text ?? "").join("\n") || "MCP tool error",
              );
            }
            return result.content
              .map((c) => {
                if (c.type === "text") return c.text ?? "";
                return JSON.stringify(c);
              })
              .join("\n");
          }),
        );
      },
      callTool: async (name: string, args: Record<string, unknown>) => {
        await ensureConnected();
        const result = await client.callTool(name, args);
        if (result.isError) {
          throw new Error(result.content.map((c) => c.text ?? "").join("\n") || "MCP tool error");
        }
        return result.content
          .map((c) => (c.type === "text" ? (c.text ?? "") : JSON.stringify(c)))
          .join("\n");
      },
    });
  }

  return providers;
}
