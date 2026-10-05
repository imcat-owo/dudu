/**
 * B1: OAuth login for model providers — no API key needed.
 *
 * Architecture learned from Kelivo's provider_oauth_service.dart
 * (Chevey339/kelivo):
 * - OAuth accounts are first-class, alongside API keys: login once,
 *   the access token is used as the Bearer token, auto-refreshed.
 * - Refresh is deduped in-flight; expiry is tracked; "needs re-login"
 *   is an explicit state surfaced in UI.
 *
 * Flow: OAuth2 Authorization Code + PKCE via the system browser
 * (expo-web-browser), redirecting back to `dudu://oauth/callback`.
 *
 * HONESTY NOTE: the provider presets below use the OAuth endpoints
 * Kelivo reverse-engineered (device/browser flows for ChatGPT-Codex,
 * Grok, Kimi, Claude). These are NOT public documented APIs and can
 * break whenever the provider changes them. Each preset carries a
 * `reverseEngineered: true` flag; the UI shows an honest note.
 * Tokens always live in SecureStore, never in logs or the repo.
 */

import type { SecureBackend } from "./store";

const OAUTH_KEY = "dudu.oauth.v1";

/** A provider that can be logged into without an API key. */
export interface OAuthProviderPreset {
  id: "chatgpt" | "grok" | "kimi" | "claude";
  displayName: string;
  /** API base URL used after login. */
  baseUrl: string;
  /** OAuth authorization endpoint (browser). */
  authUrl: string;
  /** Token endpoint (code exchange + refresh). */
  tokenUrl: string;
  /** Scopes to request. */
  scopes: string[];
  /** Public client id (reverse-engineered — see honesty note above). */
  clientId: string;
  reverseEngineered: true;
}

export const OAUTH_PRESETS: OAuthProviderPreset[] = [
  {
    id: "chatgpt",
    displayName: "ChatGPT",
    baseUrl: "https://chatgpt.com/backend-api/codex",
    authUrl: "https://auth.openai.com/oauth/authorize",
    tokenUrl: "https://auth.openai.com/oauth/token",
    scopes: [
      "openid",
      "profile",
      "email",
      "offline_access",
      "api.connectors.read",
      "api.connectors.invoke",
    ],
    clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
    reverseEngineered: true,
  },
  {
    id: "grok",
    displayName: "Grok",
    baseUrl: "https://api.x.ai/v1",
    authUrl: "https://auth.x.ai/oauth2/authorize",
    tokenUrl: "https://auth.x.ai/oauth2/token",
    scopes: ["openid", "profile", "email", "offline_access", "grok-cli:access", "api:access"],
    clientId: "b1a00492-073a-47ea-816f-4c329264a828",
    reverseEngineered: true,
  },
  {
    id: "kimi",
    displayName: "Kimi",
    baseUrl: "https://api.kimi.com/coding/v1",
    authUrl: "https://www.kimi.com/oauth/authorize",
    tokenUrl: "https://auth.kimi.com/api/oauth/token",
    scopes: [],
    clientId: "17e5f671-d194-4dfb-9706-5516cb48c098",
    reverseEngineered: true,
  },
  {
    id: "claude",
    displayName: "Claude",
    baseUrl: "https://api.anthropic.com/v1",
    authUrl: "https://claude.ai/oauth/authorize",
    tokenUrl: "https://api.anthropic.com/v1/oauth/token",
    scopes: [
      "org:create_api_key",
      "user:profile",
      "user:inference",
      "user:sessions:claude_code",
      "user:mcp_servers",
      "user:file_upload",
    ],
    clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    reverseEngineered: true,
  },
];

/** One logged-in OAuth account. Tokens are secrets. */
export interface OAuthAccount {
  id: string;
  providerId: OAuthProviderPreset["id"];
  displayName: string;
  email: string | null;
  accessToken: string;
  refreshToken: string | null;
  /** Unix ms when the access token expires. */
  expiresAt: number;
  createdAt: number;
}

export function newOAuthAccountId(): string {
  return `oa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const OAUTH_REDIRECT = "dudu://oauth/callback";

/** Seconds of clock skew tolerated before treating a token as expired. */
const EXPIRY_SKEW_MS = 60_000;

export function isTokenExpired(account: OAuthAccount, now: number = Date.now()): boolean {
  return now + EXPIRY_SKEW_MS >= account.expiresAt;
}

/** PKCE helpers — pure, testable. */
export function randomVerifier(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  let out = "";
  const bytes = new Uint8Array(64);
  // Node/RN-safe random source.
  const cryptoObj =
    typeof globalThis.crypto !== "undefined" ? globalThis.crypto : null;
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}

/** base64url without padding. Pure. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = typeof btoa !== "undefined" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function buildAuthorizeUrl(
  preset: OAuthProviderPreset,
  challenge: string,
  state: string,
): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: preset.clientId,
    redirect_uri: OAUTH_REDIRECT,
    scope: preset.scopes.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  return `${preset.authUrl}?${q.toString()}`;
}

/** Parse the redirect URL the browser hands back. Pure, testable. */
export function parseOAuthRedirect(
  url: string,
  expectedState: string,
): { code: string } | { error: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: "bad_redirect" };
  }
  const params = parsed.searchParams;
  const err = params.get("error");
  if (err) return { error: params.get("error_description") ?? err };
  if (params.get("state") !== expectedState) return { error: "state_mismatch" };
  const code = params.get("code");
  if (!code) return { error: "no_code" };
  return { code };
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  email?: string;
}

/** Exchange an authorization code for tokens. The code_verifier is a secret. */
export async function exchangeCode(
  preset: OAuthProviderPreset,
  code: string,
  verifier: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: preset.clientId,
    code,
    redirect_uri: OAUTH_REDIRECT,
    code_verifier: verifier,
  });
  const res = await fetch(preset.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`token exchange failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  return (await res.json()) as TokenResponse;
}

/** Refresh an access token. In-flight refreshes are deduped by the store. */
export async function refreshToken(
  preset: OAuthProviderPreset,
  refreshTokenValue: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: preset.clientId,
    refresh_token: refreshTokenValue,
  });
  const res = await fetch(preset.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`token refresh failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  return (await res.json()) as TokenResponse;
}

function parseAccounts(raw: string | null): OAuthAccount[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (a): a is OAuthAccount =>
        typeof a === "object" &&
        a !== null &&
        typeof (a as OAuthAccount).id === "string" &&
        typeof (a as OAuthAccount).accessToken === "string",
    );
  } catch {
    return [];
  }
}

/**
 * OAuth account store. Tokens live in SecureStore — never AsyncStorage,
 * never logs, never the repo. Follows the group store's lazy-backend
 * pattern so it stays importable in plain node tests.
 */
export function createOAuthStore(secure?: SecureBackend) {
  let resolvedSecure: SecureBackend | null = secure ?? null;
  let accounts: OAuthAccount[] | null = null;
  let loadPromise: Promise<void> | null = null;
  // Dedup in-flight refreshes per account (Kelivo pattern).
  const refreshInflight = new Map<string, Promise<OAuthAccount>>();

  async function secureBackend(): Promise<SecureBackend> {
    if (!resolvedSecure) {
      const SecureStore = await import("expo-secure-store");
      resolvedSecure = {
        getItem: (k) => SecureStore.getItemAsync(k),
        setItem: (k, v) => SecureStore.setItemAsync(k, v),
        deleteItem: (k) => SecureStore.deleteItemAsync(k),
      };
    }
    return resolvedSecure;
  }

  function ensureLoaded(): Promise<void> {
    if (!loadPromise) {
      loadPromise = (async () => {
        try {
          accounts = parseAccounts(await (await secureBackend()).getItem(OAUTH_KEY));
        } catch {
          accounts = [];
        }
      })();
    }
    return loadPromise;
  }
  void ensureLoaded();

  async function persist(next: OAuthAccount[]): Promise<void> {
    accounts = next;
    try {
      await (await secureBackend()).setItem(OAUTH_KEY, JSON.stringify(next));
    } catch {
      // SecureStore unavailable — memory mirror keeps the session working.
    }
  }

  function presetFor(account: OAuthAccount): OAuthProviderPreset | undefined {
    return OAUTH_PRESETS.find((p) => p.id === account.providerId);
  }

  return {
    async list(): Promise<OAuthAccount[]> {
      await ensureLoaded();
      return [...(accounts ?? [])];
    },

    async get(id: string): Promise<OAuthAccount | null> {
      await ensureLoaded();
      return (accounts ?? []).find((a) => a.id === id) ?? null;
    },

    async upsert(account: OAuthAccount): Promise<void> {
      await ensureLoaded();
      const next = (accounts ?? []).some((a) => a.id === account.id)
        ? (accounts ?? []).map((a) => (a.id === account.id ? account : a))
        : [...(accounts ?? []), account];
      await persist(next);
    },

    async remove(id: string): Promise<void> {
      await ensureLoaded();
      await persist((accounts ?? []).filter((a) => a.id !== id));
    },

    /**
     * A usable access token for the account — refreshes when expired.
     * Throws when there is no refresh token (user must log in again).
     */
    async accessToken(id: string): Promise<string> {
      await ensureLoaded();
      const account = (accounts ?? []).find((a) => a.id === id);
      if (!account) throw new Error("oauth account not found");
      if (!isTokenExpired(account)) return account.accessToken;
      if (!account.refreshToken) throw new Error("oauth_login_required");
      let inflight = refreshInflight.get(id);
      if (!inflight) {
        inflight = (async () => {
          const preset = presetFor(account);
          if (!preset) throw new Error("oauth provider unknown");
          const tokens = await refreshToken(preset, account.refreshToken as string);
          const updated: OAuthAccount = {
            ...account,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token ?? account.refreshToken,
            expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
          };
          await this.upsert(updated);
          return updated;
        })();
        refreshInflight.set(id, inflight);
        try {
          await inflight;
        } finally {
          refreshInflight.delete(id);
        }
      }
      return (await inflight).accessToken;
    },

    /** Test hook. */
    async __resetForTests(): Promise<void> {
      accounts = [];
      try {
        await (await secureBackend()).deleteItem(OAUTH_KEY);
      } catch {
        // ignore
      }
    },
  };
}

export type OAuthStore = ReturnType<typeof createOAuthStore>;

/** App-wide singleton. */
export const oauthStore = createOAuthStore();
