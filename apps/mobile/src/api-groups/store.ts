/**
 * API group persistence.
 *
 * Groups (including secret keys) live in expo-secure-store — NEVER in
 * AsyncStorage, NEVER in the repo. The active group id is not a secret and
 * lives in AsyncStorage so the UI can read it synchronously-ish.
 *
 * Follows the apps/mobile/src/session-store.ts pattern: lazy SecureStore
 * import (stays importable in plain node tests), guarded fallbacks, and an
 * injectable backend for tests.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import type { ApiGroup } from "./types";

const GROUPS_KEY = "dudu.api-groups.v1";
const ACTIVE_ID_KEY = "dudu.api-groups.active.v1";

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

function parseGroups(raw: string | null): ApiGroup[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (g): g is ApiGroup =>
        typeof g === "object" &&
        g !== null &&
        typeof (g as ApiGroup).id === "string" &&
        typeof (g as ApiGroup).name === "string",
    );
  } catch {
    return [];
  }
}

export function createGroupStore(secure?: SecureBackend) {
  let resolvedSecure: SecureBackend | null = secure ?? null;
  // Memory mirror so reads stay synchronous after the first load and the
  // app keeps working when SecureStore is unavailable (web).
  let groups: ApiGroup[] | null = null;
  let activeId: string | null = null;
  const listeners = new Set<() => void>();

  // getSnapshot() MUST return a stable reference: useSyncExternalStore
  // force-rerenders whenever Object.is(getSnapshot(), prev) is false, so a
  // fresh object literal here spins an infinite render loop.
  let snapshot: { groups: ApiGroup[]; activeId: string | null; loaded: boolean } = {
    groups: [],
    activeId: null,
    loaded: false,
  };

  function emit() {
    snapshot = { groups: groups ?? [], activeId, loaded: loadDone };
    for (const l of listeners) l();
  }

  async function secureBackend(): Promise<SecureBackend> {
    if (!resolvedSecure) resolvedSecure = await loadSecureBackend();
    return resolvedSecure;
  }

  // Single shared load promise: every caller (including the kick-off in
  // the constructor and the first upsert) awaits the SAME load, so a
  // concurrent upsert can never be clobbered by the initial read.
  let loadPromise: Promise<void> | null = null;
  let loadDone = false;
  function ensureLoaded(): Promise<void> {
    if (!loadPromise) {
      loadPromise = (async () => {
        try {
          groups = parseGroups(await (await secureBackend()).getItem(GROUPS_KEY));
        } catch {
          groups = [];
        }
        try {
          activeId = await AsyncStorage.getItem(ACTIVE_ID_KEY);
        } catch {
          activeId = null;
        }
        // Active id must point at a real group.
        if (activeId && !(groups ?? []).some((g) => g.id === activeId)) activeId = null;
        if (!activeId && (groups ?? []).length > 0) activeId = (groups ?? [])[0].id;
        loadDone = true;
        emit();
      })();
    }
    return loadPromise;
  }
  void ensureLoaded();

  async function persist(next: ApiGroup[]): Promise<void> {
    groups = next;
    try {
      await (await secureBackend()).setItem(GROUPS_KEY, JSON.stringify(next));
    } catch {
      // SecureStore unavailable — the memory mirror keeps this session working.
    }
    emit();
  }

  async function setActiveId(id: string | null): Promise<void> {
    await ensureLoaded();
    activeId = id;
    try {
      if (id) await AsyncStorage.setItem(ACTIVE_ID_KEY, id);
      else await AsyncStorage.removeItem(ACTIVE_ID_KEY);
    } catch {
      // Non-fatal: the memory value still drives this session.
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
    getSnapshot(): { groups: ApiGroup[]; activeId: string | null; loaded: boolean } {
      return snapshot;
    },

    async upsert(group: ApiGroup): Promise<void> {
      await ensureLoaded();
      const next = (groups ?? []).some((g) => g.id === group.id)
        ? (groups ?? []).map((g) => (g.id === group.id ? group : g))
        : [...(groups ?? []), group];
      // First group becomes active automatically.
      const first = (groups ?? []).length === 0;
      await persist(next);
      if (first) await setActiveId(group.id);
    },

    async remove(id: string): Promise<void> {
      await ensureLoaded();
      const next = (groups ?? []).filter((g) => g.id !== id);
      await persist(next);
      if (activeId === id) await setActiveId(next.length > 0 ? next[0].id : null);
    },

    async setActive(id: string): Promise<void> {
      await ensureLoaded();
      if ((groups ?? []).some((g) => g.id === id)) await setActiveId(id);
    },

    /**
     * Re-read everything from storage and notify listeners.
     * Used after backup restore so the UI picks up the restored data
     * instead of showing the stale in-memory mirrors.
     */
    async refresh(): Promise<void> {
      await loadPromise; // let any in-flight load settle first
      loadPromise = null;
      await ensureLoaded();
    },

    /** Test hook: wipe everything (used by tests; not exposed in UI). */
    async __resetForTests(): Promise<void> {
      groups = [];
      activeId = null;
      loadDone = true;
      try {
        await (await secureBackend()).deleteItem(GROUPS_KEY);
      } catch {
        // ignore
      }
      try {
        await AsyncStorage.removeItem(ACTIVE_ID_KEY);
      } catch {
        // ignore
      }
      emit();
    },
  };
}

export type GroupStore = ReturnType<typeof createGroupStore>;

/** App-wide singleton. */
export const groupStore = createGroupStore();

export function useApiGroups(): {
  groups: ApiGroup[];
  activeId: string | null;
  active: ApiGroup | null;
  loaded: boolean;
} {
  const snap = useSyncExternalStore(
    groupStore.subscribe,
    groupStore.getSnapshot,
    groupStore.getSnapshot,
  );
  return {
    groups: snap.groups,
    activeId: snap.activeId,
    active: snap.groups.find((g) => g.id === snap.activeId) ?? null,
    loaded: snap.loaded,
  };
}
