/**
 * MCP OAuth 2.1 — PURE module (no React Native imports).
 *
 * Authorization code flow with PKCE (S256), Dynamic Client Registration
 * (RFC 7591), and token refresh. Follows the MCP authorization spec:
 * - Discover the authorization server from the WWW-Authenticate header
 *   (401) or fall back to the MCP server origin's .well-known.
 * - Try DCR when no pre-registered client id is configured.
 *
 * The UI layer opens the authorization URL (system browser) and delivers
 * the redirect back via `finishAuthorization(redirectUrl)`.
 */

import type { McpOAuthConfig, McpOAuthTokens } from "./types";

export interface PkcePair {
  verifier: string;
  /** Async because SubtleCrypto is async; await it before use. */
  challenge: Promise<string>;
}

export function createPkcePair(): { verifier: string; challenge: Promise<string> } {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const verifier = base64Url(bytes);
  return { verifier, challenge: pkceChallenge(verifier) };
}

function base64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(text: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(digest);
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return base64Url(await sha256(verifier));
}

function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export interface AuthorizationServerMetadata {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  scopesSupported?: string[];
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`OAuth HTTP ${res.status} at ${url}`);
  return res.json();
}

/** Discover authorization server metadata (RFC 8414). */
export async function discoverAuthServer(
  mcpServerUrl: string,
  override?: string,
): Promise<AuthorizationServerMetadata> {
  if (override) {
    const meta = (await fetchJson(
      `${override.replace(/\/$/, "")}/.well-known/oauth-authorization-server`,
    )) as Record<string, unknown>;
    return normalizeMetadata(meta);
  }
  const origin = new URL(mcpServerUrl).origin;
  // Try path-inserted first (some servers), then root.
  const candidates = [
    `${origin}/.well-known/oauth-authorization-server${new URL(mcpServerUrl).pathname}`,
    `${origin}/.well-known/oauth-authorization-server`,
  ];
  let lastErr: unknown;
  for (const url of candidates) {
    try {
      const meta = (await fetchJson(url)) as Record<string, unknown>;
      return normalizeMetadata(meta);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    `OAuth: no authorization server metadata found (${String(lastErr)})`,
  );
}

function normalizeMetadata(meta: Record<string, unknown>): AuthorizationServerMetadata {
  const issuer = meta["issuer"] as string;
  const authorizationEndpoint = meta["authorization_endpoint"] as string;
  const tokenEndpoint = meta["token_endpoint"] as string;
  if (!issuer || !authorizationEndpoint || !tokenEndpoint) {
    throw new Error("OAuth: incomplete authorization server metadata");
  }
  return {
    issuer,
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint: meta["registration_endpoint"] as string | undefined,
    scopesSupported: meta["scopes_supported"] as string[] | undefined,
  };
}

export interface RegisteredClient {
  clientId: string;
  clientSecret?: string;
}

/** Dynamic Client Registration (RFC 7591). */
export async function registerClient(
  metadata: AuthorizationServerMetadata,
  redirectUri: string,
  clientName: string,
): Promise<RegisteredClient> {
  if (!metadata.registrationEndpoint) {
    throw new Error("OAuth: server does not support dynamic client registration");
  }
  const res = await fetch(metadata.registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "openid profile",
    }),
  });
  if (!res.ok) throw new Error(`OAuth DCR failed: HTTP ${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;
  const clientId = data["client_id"] as string;
  if (!clientId) throw new Error("OAuth DCR: no client_id returned");
  return { clientId, clientSecret: data["client_secret"] as string | undefined };
}

export interface AuthFlow {
  authorizationUrl: string;
  state: string;
  pkce: PkcePair;
  clientId: string;
  clientSecret?: string;
  metadata: AuthorizationServerMetadata;
  redirectUri: string;
  /** Call with the redirect URL the app received. */
  finish(redirectUrl: string): Promise<McpOAuthTokens>;
}

/** Start the authorization flow. Returns the URL to open + a finisher. */
export async function startAuthorization(
  mcpServerUrl: string,
  oauth: McpOAuthConfig,
  redirectUri: string,
  clientName: string,
): Promise<AuthFlow> {
  const metadata = await discoverAuthServer(mcpServerUrl, oauth.authorizationServer);
  let clientId = oauth.clientId;
  let clientSecret = oauth.clientSecret;
  if (!clientId) {
    const reg = await registerClient(metadata, redirectUri, clientName);
    clientId = reg.clientId;
    clientSecret = reg.clientSecret;
  }
  const pkce = createPkcePair();
  // pkce.challenge is a Promise in this impl — resolve it now.
  const challenge = await pkce.challenge;
  const state = randomState();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  if (oauth.scopes?.length) params.set("scope", oauth.scopes.join(" "));
  const authorizationUrl = `${metadata.authorizationEndpoint}?${params.toString()}`;

  return {
    authorizationUrl,
    state,
    pkce,
    clientId,
    clientSecret,
    metadata,
    redirectUri,
    async finish(redirectUrl: string): Promise<McpOAuthTokens> {
      const url = new URL(redirectUrl);
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const err = url.searchParams.get("error");
      if (err) throw new Error(`OAuth: ${err} — ${url.searchParams.get("error_description") ?? ""}`);
      if (!code) throw new Error("OAuth: no authorization code in redirect");
      if (returnedState !== state) throw new Error("OAuth: state mismatch");
      return exchangeCode(metadata, clientId!, clientSecret, code, pkce.verifier, redirectUri);
    },
  };
}

async function exchangeCode(
  metadata: AuthorizationServerMetadata,
  clientId: string,
  clientSecret: string | undefined,
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<McpOAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    client_id: clientId,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (clientSecret) {
    headers["Authorization"] = `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
  }
  const res = await fetch(metadata.tokenEndpoint, {
    method: "POST",
    headers,
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OAuth token exchange failed: HTTP ${res.status} ${text}`);
  }
  return normalizeTokens((await res.json()) as Record<string, unknown>);
}

/** Refresh an access token. */
export async function refreshTokens(
  metadata: AuthorizationServerMetadata,
  clientId: string,
  clientSecret: string | undefined,
  refreshToken: string,
): Promise<McpOAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (clientSecret) {
    headers["Authorization"] = `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
  }
  const res = await fetch(metadata.tokenEndpoint, {
    method: "POST",
    headers,
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`OAuth refresh failed: HTTP ${res.status}`);
  const tokens = normalizeTokens((await res.json()) as Record<string, unknown>);
  // Some servers omit a new refresh token — keep the old one.
  if (!tokens.refreshToken) tokens.refreshToken = refreshToken;
  return tokens;
}

function normalizeTokens(data: Record<string, unknown>): McpOAuthTokens {
  const accessToken = data["access_token"] as string;
  if (!accessToken) throw new Error("OAuth: no access_token in response");
  const expiresIn = Number(data["expires_in"] ?? 3600);
  return {
    accessToken,
    refreshToken: data["refresh_token"] as string | undefined,
    expiresAt: Date.now() + expiresIn * 1000,
    tokenType: (data["token_type"] as string) ?? "Bearer",
  };
}

/** Parse a WWW-Authenticate header for the resource metadata URL (RFC 9728). */
export function parseWwwAuthenticate(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/resource_metadata="([^"]+)"/);
  return m ? m[1] : null;
}
