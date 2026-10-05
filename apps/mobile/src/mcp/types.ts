/**
 * MCP (Model Context Protocol) types — PURE module (no React Native imports).
 *
 * Supports Streamable HTTP and SSE transports (STDIO is deferred — iOS
 * cannot spawn subprocesses). OAuth 2.1 with PKCE + Dynamic Client
 * Registration for servers that require authorization.
 */

export type McpTransportType = "http" | "sse";

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransportType;
  /** Streamable HTTP endpoint or SSE endpoint URL. */
  url: string;
  /** Optional static headers (e.g. X-API-Key). Values may reference env vars as ${VAR}. */
  headers?: Record<string, string>;
  /** OAuth config; absent = no auth. */
  oauth?: McpOAuthConfig;
  /** Per-tool approval: "ask" (default), "allow", "deny". Keyed by tool name. */
  toolApprovals?: Record<string, "ask" | "allow" | "deny">;
  /** Enabled toggle. */
  enabled: boolean;
  /** Request timeout ms. */
  timeoutMs?: number;
}

export interface McpOAuthConfig {
  /** Pre-registered client id; absent = use Dynamic Client Registration. */
  clientId?: string;
  clientSecret?: string;
  /** OAuth scopes to request. */
  scopes?: string[];
  /** Override the authorization server (default: discovered via WWW-Authenticate / .well-known). */
  authorizationServer?: string;
}

export interface McpOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // epoch ms
  tokenType: string;
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  content: Array<{ type: string; text?: string; [k: string]: unknown }>;
  isError?: boolean;
}

export type McpConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "needs-auth"
  | "authorizing"
  | "error";

export interface McpServerState extends McpServerConfig {
  status: McpConnectionStatus;
  error?: string;
  tools: McpToolDefinition[];
  oauthTokens?: McpOAuthTokens;
}
