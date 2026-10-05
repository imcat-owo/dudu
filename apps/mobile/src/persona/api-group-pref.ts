/**
 * Per-persona model/API preference (模型/API 每人设独立配置).
 *
 * PURE module: no React Native imports. Maps personaId -> apiGroupId.
 * A persona with no entry falls back to the global active group.
 *
 * Her spec: one persona's API down -> only its own error shows, everyone
 * else keeps talking. The engine resolves this map at generation time.
 */

export interface ApiGroupPrefStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const PREF_KEY = "dudu.persona.v1.api-group";

function parseMap(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const p = JSON.parse(raw) as unknown;
    if (p && typeof p === "object" && !Array.isArray(p)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
        if (typeof v === "string" && v) out[k] = v;
      }
      return out;
    }
  } catch {
    // Corrupt -> start clean.
  }
  return {};
}

export function createPersonaApiGroupPrefStore(storage: ApiGroupPrefStorage) {
  let map: Record<string, string> | null = null;
  const listeners = new Set<() => void>();

  function emit() {
    for (const l of listeners) {
      try {
        l();
      } catch {
        // A broken listener must never break the store.
      }
    }
  }

  async function load(): Promise<Record<string, string>> {
    if (map) return map;
    map = parseMap(await storage.getItem(PREF_KEY).catch(() => null));
    return map;
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /** apiGroupId for this persona, or null when it uses the global active group. */
    async get(personaId: string): Promise<string | null> {
      const m = await load();
      return m[personaId] ?? null;
    },

    async set(personaId: string, apiGroupId: string | null): Promise<void> {
      const m = await load();
      if (apiGroupId) m[personaId] = apiGroupId;
      else delete m[personaId];
      map = { ...m };
      await storage.setItem(PREF_KEY, JSON.stringify(map)).catch(() => {});
      emit();
    },

    /** For backup: the whole map. */
    async snapshot(): Promise<Record<string, string>> {
      return { ...(await load()) };
    },

    async restore(next: Record<string, string>): Promise<void> {
      map = parseMap(JSON.stringify(next));
      await storage.setItem(PREF_KEY, JSON.stringify(map)).catch(() => {});
      emit();
    },
  };
}

export type PersonaApiGroupPrefStore = ReturnType<typeof createPersonaApiGroupPrefStore>;
