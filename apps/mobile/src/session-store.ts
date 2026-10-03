/**
 * Session token persistence for the mobile app.
 *
 * The only session state the app holds is the bearer token returned by
 * POST /api/session (apps/mobile/src/api.ts `createSession`). It is stored in
 * expo-secure-store so the app does not lose login on restart. Server sessions
 * expire after 24h (apps/server/src/auth.ts); the cold-start restore flow in
 * App.tsx validates the stored token and silently re-connects when it is gone.
 *
 * SecureStore is unavailable on web (`pnpm dev:web`) and can throw on any
 * platform, so every call is guarded and falls back to a process-lifetime
 * in-memory store. Persistence must never take the app down.
 *
 * The expo-secure-store import is lazy (dynamic import) so this module stays
 * importable in plain node test environments; tests inject a fake backend.
 */
const TOKEN_KEY = "openmuse.session.token";

export interface TokenBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

async function loadSecureStoreBackend(): Promise<TokenBackend> {
  const SecureStore = await import("expo-secure-store");
  return {
    getItem: (key) => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value),
    deleteItem: (key) => SecureStore.deleteItemAsync(key),
  };
}

export function createTokenStore(backend?: TokenBackend) {
  let memory: string | null = null;
  let resolved: TokenBackend | null = backend ?? null;
  async function getBackend(): Promise<TokenBackend> {
    if (!resolved) resolved = await loadSecureStoreBackend();
    return resolved;
  }
  return {
    async load(): Promise<string | null> {
      try {
        const stored = await (await getBackend()).getItem(TOKEN_KEY);
        if (stored) return stored;
      } catch {
        // SecureStore unavailable (e.g. web) — fall through to the memory copy.
      }
      return memory;
    },
    async save(token: string): Promise<void> {
      memory = token;
      try {
        await (await getBackend()).setItem(TOKEN_KEY, token);
      } catch {
        // SecureStore unavailable (e.g. web) — the memory copy above keeps this session working.
      }
    },
    async clear(): Promise<void> {
      memory = null;
      try {
        await (await getBackend()).deleteItem(TOKEN_KEY);
      } catch {
        // SecureStore unavailable (e.g. web) — nothing durable to delete.
      }
    },
  };
}

/** App-wide singleton backed by expo-secure-store. */
export const tokenStore = createTokenStore();
