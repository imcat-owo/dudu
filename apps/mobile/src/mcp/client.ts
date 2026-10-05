/**
 * MCP client — PURE module (no React Native imports).
 *
 * JSON-RPC over the transport: initialize handshake, tools/list,
 * tools/call, and ping. Handles 401 → OAuth (the caller drives the
 * browser flow via onNeedsAuth).
 *
 * Tool approval ("ask"/"allow"/"deny" per tool) is enforced here before
 * any call reaches the server.
 */

import { discoverAuthServer, refreshTokens } from "./oauth";
import { createTransport, type McpTransport } from "./transports";
import type { McpOAuthTokens, McpServerConfig, McpToolDefinition, McpToolResult } from "./types";

const PROTOCOL_VERSION = "2025-06-18";
const CLIENT_INFO = { name: "dudu", version: "1.0.0" };

export type ApprovalDecision = "allow" | "deny" | "ask";

export interface McpClientDeps {
  /** Env vars for ${VAR} expansion in headers. */
  env: Record<string, string>;
  /** Current OAuth tokens for this server (if any). */
  getTokens: () => McpOAuthTokens | undefined | Promise<McpOAuthTokens | undefined>;
  /** Persist refreshed tokens. */
  saveTokens: (t: McpOAuthTokens) => Promise<void>;
  /** Client id/secret remembered from DCR. */
  getClientCreds: () =>
    | { clientId: string; clientSecret?: string }
    | undefined
    | Promise<{ clientId: string; clientSecret?: string } | undefined>;
  /** Called when the server demands OAuth; the UI runs the browser flow and calls back with tokens. */
  onNeedsAuth: () => Promise<McpOAuthTokens>;
  /** Per-tool approval decision. */
  getApproval: (toolName: string) => ApprovalDecision;
  /** Ask her (used when approval is "ask"). Must resolve true/false. */
  requestApproval: (toolName: string, args: unknown) => Promise<boolean>;
}

export interface McpClient {
  connect(): Promise<void>;
  listTools(): Promise<McpToolDefinition[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
  ping(): Promise<void>;
  close(): Promise<void>;
  readonly serverInfo: { name: string; version: string } | null;
}

export function createMcpClient(config: McpServerConfig, deps: McpClientDeps): McpClient {
  const transport: McpTransport = createTransport(config, deps.env);
  const timeoutMs = config.timeoutMs ?? 30000;
  let serverInfo: { name: string; version: string } | null = null;
  let oauthRefreshInFlight: Promise<McpOAuthTokens> | null = null;

  function _applyAuth() {
    // Sync path only; async refresh is handled in ensureFreshTokens.
    void 0;
  }

  async function getTokensSync(): Promise<McpOAuthTokens | undefined> {
    return deps.getTokens();
  }

  async function applyAuthAsync(): Promise<void> {
    const tokens = await getTokensSync();
    transport.setAuthHeader(tokens ? `${tokens.tokenType} ${tokens.accessToken}` : null);
  }

  async function ensureFreshTokens(): Promise<void> {
    const tokens = await getTokensSync();
    if (!tokens) return;
    // Refresh if expiring within 60s.
    if (tokens.expiresAt - Date.now() > 60000) return;
    const refreshToken = tokens.refreshToken;
    if (!refreshToken) return;
    if (!oauthRefreshInFlight) {
      oauthRefreshInFlight = (async () => {
        const creds = await deps.getClientCreds();
        if (!creds) throw new Error("OAuth: no client credentials for refresh");
        const metadata = await discoverAuthServer(config.url, config.oauth?.authorizationServer);
        const fresh = await refreshTokens(
          metadata,
          creds.clientId,
          creds.clientSecret,
          refreshToken,
        );
        await deps.saveTokens(fresh);
        return fresh;
      })().finally(() => {
        oauthRefreshInFlight = null;
      });
    }
    await oauthRefreshInFlight;
    await applyAuthAsync();
  }

  /** Run a request; on 401, drive the OAuth flow once and retry. */
  async function request(method: string, params?: unknown): Promise<unknown> {
    await applyAuthAsync();
    await ensureFreshTokens();
    try {
      return await transport.request({ id: 0, method, params }, timeoutMs);
    } catch (e) {
      if (e instanceof Error && e.message.includes("MCP_UNAUTHORIZED") && config.oauth) {
        const tokens = await deps.onNeedsAuth();
        await deps.saveTokens(tokens);
        await applyAuthAsync();
        return transport.request({ id: 0, method, params }, timeoutMs);
      }
      throw e;
    }
  }

  return {
    get serverInfo() {
      return serverInfo;
    },

    async connect(): Promise<void> {
      await transport.connect();
      const result = (await request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      })) as {
        protocolVersion?: string;
        serverInfo?: { name: string; version: string };
      };
      serverInfo = result.serverInfo ?? { name: config.name, version: "?" };
      await transport.notify("notifications/initialized").catch(() => {});
    },

    async listTools(): Promise<McpToolDefinition[]> {
      const result = (await request("tools/list")) as {
        tools?: Array<{
          name: string;
          description?: string;
          inputSchema?: Record<string, unknown>;
        }>;
      };
      return (result.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema ?? { type: "object", properties: {} },
      }));
    },

    async callTool(name, args): Promise<McpToolResult> {
      const approval = deps.getApproval(name);
      if (approval === "deny") {
        throw new Error(`Tool "${name}" is disabled for this server.`);
      }
      if (approval === "ask") {
        // D13: the approval card asks her in-session. Deny (or dismiss /
        // timeout) fails closed — the error says what actually happened so
        // the model never gets a false story about her choice.
        const ok = await deps.requestApproval(name, args);
        if (!ok)
          throw new Error(`MCP tool "${name}" was not called: she declined the approval request.`);
      }
      const result = (await request("tools/call", {
        name,
        arguments: args,
      })) as {
        content?: Array<{ type: string; text?: string; [k: string]: unknown }>;
        isError?: boolean;
      };
      return {
        content: result.content ?? [],
        isError: result.isError,
      };
    },

    async ping(): Promise<void> {
      await request("ping");
    },

    async close(): Promise<void> {
      await transport.close();
    },
  };
}
