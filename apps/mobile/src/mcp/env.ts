/**
 * Environment variables + output redaction — PURE module (no React Native imports).
 *
 * D10: She stores keys/secrets here (e.g. MCP server API keys, search API
 * keys). Values live in SecureStore — NEVER in AsyncStorage, NEVER in logs,
 * NEVER in the repo.
 *
 * Redaction: any stored secret value is replaced with `<redacted>` in
 * tool outputs, diagnostics, and anything shown to the model, before it
 * leaves the device.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

const NAMES_KEY = "dudu.env-vars.v1"; // names only, not values
const VALUE_PREFIX = "dudu.env-value.";

export interface EnvMeta {
  account: string;
  note: string;
  url?: string;
  updatedAt: number;
}

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

/** Redact every known secret value from a string. */
export function redactSecrets(text: string, secrets: string[]): string {
  let out = text;
  // Longest first so overlapping values don't leave fragments.
  const sorted = [...secrets].filter((s) => s.length >= 4).sort((a, b) => b.length - a.length);
  for (const s of sorted) {
    out = out.split(s).join("<redacted>");
  }
  // Generic patterns as a backstop.
  out = out
    .replace(/("api_?key"\s*:\s*")[^"]+(")/gi, "$1<redacted>$2")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+/g, "$1<redacted>");
  return out;
}

export function createEnvStore(secure?: SecureBackend) {
  let resolvedSecure: SecureBackend | null = secure ?? null;
  let names: string[] | null = null;
  let valuesCache: Record<string, string> | null = null;
  const listeners = new Set<() => void>();

  let snapshot: { names: string[]; loaded: boolean } = { names: [], loaded: false };

  function emit() {
    snapshot = { names: names ?? [], loaded: names !== null };
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
          const raw = await AsyncStorage.getItem(NAMES_KEY);
          names = raw ? (JSON.parse(raw) as string[]) : [];
        } catch {
          names = [];
        }
        emit();
      })();
    }
    return loadPromise;
  }
  void ensureLoaded();

  async function loadValues(): Promise<Record<string, string>> {
    if (valuesCache) return valuesCache;
    await ensureLoaded();
    const sb = await secureBackend();
    const out: Record<string, string> = {};
    for (const n of names ?? []) {
      try {
        const v = await sb.getItem(VALUE_PREFIX + n);
        if (v) out[n] = v;
      } catch {
        // ignore
      }
    }
    valuesCache = out;
    return out;
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

    /** Names only — values never leave SecureStore except via getValues(). */
    async listNames(): Promise<string[]> {
      await ensureLoaded();
      return [...(names ?? [])];
    },

    async set(name: string, value: string): Promise<void> {
      const clean = name
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, "_");
      if (!clean) throw new Error("Invalid variable name");
      await ensureLoaded();
      await (await secureBackend()).setItem(VALUE_PREFIX + clean, value);
      if (!(names ?? []).includes(clean)) {
        names = [...(names ?? []), clean];
        try {
          await AsyncStorage.setItem(NAMES_KEY, JSON.stringify(names));
        } catch {
          // ignore
        }
      }
      valuesCache = null; // invalidate
      emit();
    },

    async remove(name: string): Promise<void> {
      await ensureLoaded();
      try {
        const sb = await secureBackend();
        await sb.deleteItem(VALUE_PREFIX + name);
        // Companion metadata must not outlive the variable itself.
        await sb.deleteItem(`${VALUE_PREFIX}${name}__META`);
      } catch {
        // ignore
      }
      names = (names ?? []).filter((n) => n !== name && n !== `${name}__META`);
      try {
        await AsyncStorage.setItem(NAMES_KEY, JSON.stringify(names));
      } catch {
        // ignore
      }
      valuesCache = null;
      emit();
    },

    /** All values — for ${VAR} expansion. Callers must redact before display. */
    async getValues(): Promise<Record<string, string>> {
      return loadValues();
    },

    /**
     * Companion metadata for a variable (account / note / url) — never the
     * secret itself. Stored by ask_env_form as <NAME>__META. Null when absent
     * or unparseable.
     */
    async getMeta(name: string): Promise<EnvMeta | null> {
      await ensureLoaded();
      try {
        const raw = await (await secureBackend()).getItem(`${VALUE_PREFIX}${name}__META`);
        if (!raw) return null;
        const o = JSON.parse(raw) as Partial<EnvMeta>;
        if (typeof o.account !== "string" || typeof o.note !== "string") return null;
        return {
          account: o.account,
          note: o.note,
          ...(typeof o.url === "string" ? { url: o.url } : {}),
          updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : 0,
        };
      } catch {
        return null;
      }
    },

    /** Redact all known secrets from text. */
    async redact(text: string): Promise<string> {
      const values = await loadValues();
      return redactSecrets(text, Object.values(values));
    },

    async __resetForTests(): Promise<void> {
      names = [];
      valuesCache = null;
      try {
        await AsyncStorage.removeItem(NAMES_KEY);
      } catch {
        // ignore
      }
      emit();
    },
  };
}

export type EnvStore = ReturnType<typeof createEnvStore>;

/** App-wide singleton. */
export const envStore = createEnvStore();

export function useEnvVarNames(): { names: string[]; loaded: boolean } {
  const snap = useSyncExternalStore(envStore.subscribe, envStore.getSnapshot, envStore.getSnapshot);
  return snap;
}
