/**
 * Per-model memory — remember what actually works for each model.
 *
 * Keyed by `${baseUrl}::${model}` (the endpoint + model name is the
 * identity; the group name is just her label). Stores the LEARNED
 * capability state so the next chat auto-applies the working config
 * without failing first.
 *
 * Only capability flags live here — no secrets, no message content.
 * AsyncStorage (not SecureStore): flags aren't sensitive.
 *
 * Follows the session-store.ts pattern: lazy AsyncStorage import (stays
 * importable in plain node tests), guarded fallbacks, injectable backend.
 */

import type { FeatureSwitch } from "./types";

export interface ModelProfile {
  /** `${baseUrl}::${model}` */
  key: string;
  /** Learned tools state. "auto" = not yet learned (optimistic: ON). */
  tools: FeatureSwitch;
  /** Learned thinking state. "auto" = not yet learned (optimistic: ON). */
  thinking: FeatureSwitch;
  /** Human-readable note, e.g. "auto-disabled tools after 400". */
  note: string;
  updatedAt: number;
}

const PROFILES_KEY = "openmuse.model-profiles.v1";

export function profileKey(baseUrl: string, model: string): string {
  return `${baseUrl.trim().replace(/\/+$/, "").toLowerCase()}::${model.trim()}`;
}

export function blankProfile(baseUrl: string, model: string): ModelProfile {
  return {
    key: profileKey(baseUrl, model),
    tools: "auto",
    thinking: "auto",
    note: "",
    updatedAt: Date.now(),
  };
}

export interface ProfileBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

async function loadAsyncStorage(): Promise<ProfileBackend> {
  const mod = await import("@react-native-async-storage/async-storage");
  const AsyncStorage = mod.default;
  return {
    getItem: (k) => AsyncStorage.getItem(k),
    setItem: (k, v) => AsyncStorage.setItem(k, v),
  };
}

function parseProfiles(raw: string | null): Record<string, ModelProfile> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Record<string, ModelProfile> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "object" && v !== null && typeof (v as ModelProfile).key === "string") {
        out[k] = v as ModelProfile;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function createProfileStore(backend?: ProfileBackend) {
  let resolved: ProfileBackend | null = backend ?? null;
  let cache: Record<string, ModelProfile> | null = null;
  const listeners = new Set<() => void>();

  async function impl(): Promise<ProfileBackend> {
    if (!resolved) resolved = await loadAsyncStorage();
    return resolved;
  }
  async function ensureLoaded(): Promise<Record<string, ModelProfile>> {
    if (!cache) {
      try {
        cache = parseProfiles(await (await impl()).getItem(PROFILES_KEY));
      } catch {
        cache = {};
      }
    }
    return cache;
  }
  async function persist(): Promise<void> {
    if (!cache) return;
    try {
      await (await impl()).setItem(PROFILES_KEY, JSON.stringify(cache));
    } catch {
      // profiles are a convenience — never break chat over them
    }
  }
  function emit() {
    for (const l of listeners) l();
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async getProfile(baseUrl: string, model: string): Promise<ModelProfile> {
      const all = await ensureLoaded();
      const key = profileKey(baseUrl, model);
      return all[key] ?? blankProfile(baseUrl, model);
    },
    async saveProfile(p: ModelProfile): Promise<void> {
      const all = await ensureLoaded();
      all[p.key] = { ...p, updatedAt: Date.now() };
      await persist();
      emit();
    },
    /** Record a learned downgrade, e.g. tools proven unsupported. */
    async learned(
      baseUrl: string,
      model: string,
      patch: Partial<Pick<ModelProfile, "tools" | "thinking">>,
      note: string,
    ): Promise<ModelProfile> {
      const all = await ensureLoaded();
      const key = profileKey(baseUrl, model);
      const prev = all[key] ?? blankProfile(baseUrl, model);
      const next: ModelProfile = {
        ...prev,
        ...patch,
        note,
        updatedAt: Date.now(),
      };
      all[key] = next;
      await persist();
      emit();
      return next;
    },
    async resetProfile(baseUrl: string, model: string): Promise<void> {
      const all = await ensureLoaded();
      delete all[profileKey(baseUrl, model)];
      await persist();
      emit();
    },
    /** Synchronous read after first load (for UI). Null before load. */
    getCached(baseUrl: string, model: string): ModelProfile | null {
      if (!cache) return null;
      return cache[profileKey(baseUrl, model)] ?? null;
    },
  };
}

export const modelProfileStore = createProfileStore();
