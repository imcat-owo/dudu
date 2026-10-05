/**
 * MCP server persistence.
 *
 * Server configs live in AsyncStorage (not secret). OAuth tokens and
 * client secrets live in expo-secure-store — NEVER in AsyncStorage,
 * NEVER in the repo, NEVER in logs.
 *
 * Follows the api-groups/store.ts pattern: lazy SecureStore import,
 * guarded fallbacks, injectable backend for tests.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import type { McpOAuthTokens, McpServerConfig } from "./types";

const SERVERS_KEY = "dudu.mcp-servers.v1";
const TOKENS_PREFIX = "dudu.mcp-tokens.";
const CREDS_PREFIX = "dudu.mcp-creds.";

export interface SecureBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

async function loadSecureBackend(): Promise<SecureBackend> {
  const SecureStore = await import("expo-secure-store");
  return {
    getItem: (key) => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value),
    deleteItem: (key) => SecureStore.deleteItemAsync(key),
  };
}

function parseServers(raw: string | null): McpServerConfig[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is McpServerConfig =>
        typeof s === "object" &&
        s !== null &&
        typeof (s as McpServerConfig).id === "string" &&
        typeof (s as McpServerConfig).url === "string",
    );
  } catch {
    return [];
  }
}

export function createMcpStore(secure?: SecureBackend) {
  let resolvedSecure: SecureBackend | null = secure ?? null;
  let servers: McpServerConfig[] | null = null;
  let loadDone = false;
  const listeners = new Set<() => void>();

  let snapshot: { servers: McpServerConfig[]; loaded: boolean } = {
    servers: [],
    loaded: false,
  };

  function emit() {
    snapshot = { servers: servers ?? [], loaded: loadDone };
    for (const l of listeners) l();
  }

  async function secureBackend(): Promise<SecureBackend> {
    if (!resolvedSecure) resolvedSecure = await loadSecureBackend();
    return resolvedSecure;
  }

  let loadPromise: Promise<void> | null = null;
  function ensureLoaded(): Promise<void> {
    if (!loadPromise) {
      loadPromise = (async () => {
        try {
          const raw = await AsyncStorage.getItem(SERVERS_KEY);
          servers = parseServers(raw);
        } catch {
          servers = [];
        }
        loadDone = true;
        emit();
      })();
    }
    return loadPromise;
  }
  void ensureLoaded();

  async function persist(): Promise<void> {
    try {
      await AsyncStorage.setItem(SERVERS_KEY, JSON.stringify(servers ?? []));
    } catch {
      // non-fatal
    }
    emit();
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return snapshot;
    },

    async upsert(cfg: McpServerConfig): Promise<void> {
      await ensureLoaded();
      const next = (servers ?? []).some((s) => s.id === cfg.id)
        ? (servers ?? []).map((s) => (s.id === cfg.id ? cfg : s))
        : [...(servers ?? []), cfg];
      servers = next;
      await persist();
    },

    async remove(id: string): Promise<void> {
      await ensureLoaded();
      servers = (servers ?? []).filter((s) => s.id !== id);
      await persist();
      // Wipe secrets too.
      try {
        const sb = await secureBackend();
        await sb.deleteItem(TOKENS_PREFIX + id);
        await sb.deleteItem(CREDS_PREFIX + id);
      } catch {
        // ignore
      }
    },

    async refresh(): Promise<void> {
      await loadPromise;
      loadPromise = null;
      await ensureLoaded();
    },

    /** OAuth tokens — SecureStore only. */
    async getTokens(serverId: string): Promise<McpOAuthTokens | undefined> {
      try {
        const raw = await (await secureBackend()).getItem(TOKENS_PREFIX + serverId);
        if (!raw) return undefined;
        const t = JSON.parse(raw) as McpOAuthTokens;
        return typeof t.accessToken === "string" ? t : undefined;
      } catch {
        return undefined;
      }
    },

    async saveTokens(serverId: string, tokens: McpOAuthTokens): Promise<void> {
      try {
        await (await secureBackend()).setItem(TOKENS_PREFIX + serverId, JSON.stringify(tokens));
      } catch {
        // non-fatal
      }
    },

    async getClientCreds(
      serverId: string,
    ): Promise<{ clientId: string; clientSecret?: string } | undefined> {
      try {
        const raw = await (await secureBackend()).getItem(CREDS_PREFIX + serverId);
        if (!raw) return undefined;
        const c = JSON.parse(raw) as { clientId?: string; clientSecret?: string };
        return typeof c.clientId === "string"
          ? { clientId: c.clientId, clientSecret: c.clientSecret }
          : undefined;
      } catch {
        return undefined;
      }
    },

    async saveClientCreds(
      serverId: string,
      creds: { clientId: string; clientSecret?: string },
    ): Promise<void> {
      try {
        await (await secureBackend()).setItem(CREDS_PREFIX + serverId, JSON.stringify(creds));
      } catch {
        // non-fatal
      }
    },

    /** Test hook. */
    async __resetForTests(): Promise<void> {
      servers = [];
      loadDone = true;
      try {
        await AsyncStorage.removeItem(SERVERS_KEY);
      } catch {
        // ignore
      }
      emit();
    },
  };
}

export type McpStore = ReturnType<typeof createMcpStore>;

/** App-wide singleton. */
export const mcpStore = createMcpStore();

export function useMcpServers(): {
  servers: McpServerConfig[];
  loaded: boolean;
} {
  const snap = useSyncExternalStore(mcpStore.subscribe, mcpStore.getSnapshot, mcpStore.getSnapshot);
  return { servers: snap.servers, loaded: snap.loaded };
}

/** Backup payload — configs only, NEVER tokens/secrets. */
export function mcpBackupPayload(servers: McpServerConfig[]): McpServerConfig[] {
  return servers.map((s) => ({
    ...s,
    headers: s.headers,
    oauth: s.oauth
      ? {
          // clientSecret is never backed up.
          clientId: s.oauth.clientId,
          scopes: s.oauth.scopes,
          authorizationServer: s.oauth.authorizationServer,
        }
      : undefined,
  }));
}
