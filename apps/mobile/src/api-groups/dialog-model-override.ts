/**
 * Per-dialog model switching (对话框内切换模型入口, vision doc §1).
 *
 * Personas don't exist in the codebase yet, so the override is keyed by
 * threadId: she taps the model chip in the chat header and picks a group
 * for THIS conversation only — no trip to settings. The override wins over
 * the global active group wherever a group is resolved (chat agent's
 * getGroup, voice-input routing in chat.tsx). Clearing it restores the
 * default. Overrides persist across restarts.
 *
 * Store shape mirrors capability-store.ts: memory-first, AsyncStorage
 * persistence, useSyncExternalStore hook for React.
 */

import { useSyncExternalStore } from "react";
import type { ApiGroup } from "./types.js";

const OVERRIDE_KEY = "dudu.dialog-model-override.v1";

export interface DialogOverrideBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

async function loadAsyncStorage(): Promise<DialogOverrideBackend> {
  const mod = await import("@react-native-async-storage/async-storage");
  const AsyncStorage = mod.default;
  return {
    getItem: (k) => AsyncStorage.getItem(k),
    setItem: (k, v) => AsyncStorage.setItem(k, v),
  };
}

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
    // corrupt -> start clean
  }
  return {};
}

export function createDialogModelOverrideStore(backend?: DialogOverrideBackend) {
  let resolved: DialogOverrideBackend | null = backend ?? null;
  let map: Record<string, string> | null = null;
  let loadDone = false;
  const listeners = new Set<() => void>();

  function emit() {
    for (const l of listeners) l();
  }

  async function impl(): Promise<DialogOverrideBackend> {
    if (!resolved) resolved = await loadAsyncStorage();
    return resolved;
  }

  let loadPromise: Promise<void> | null = null;
  function ensureLoaded(): Promise<void> {
    if (!loadPromise) {
      loadPromise = (async () => {
        const b = await impl();
        try {
          map = parseMap(await b.getItem(OVERRIDE_KEY));
        } catch {
          map = {};
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
      await (await impl()).setItem(OVERRIDE_KEY, JSON.stringify(map ?? {}));
    } catch {
      // convenience only — never break chat over it
    }
    emit();
  }

  function getOverrideGroupId(threadId: string): string | null {
    return map?.[threadId] ?? null;
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot(): { overrides: Record<string, string>; loaded: boolean } {
      return { overrides: map ?? {}, loaded: loadDone };
    },

    /** Sync read — safe before load (returns null until loaded). */
    getOverrideGroupId,

    /**
     * Resolve the effective group for a thread: the override group when
     * set (and still exists), else null — callers fall back to the
     * global active group.
     */
    resolveGroup(threadId: string, groups: ApiGroup[]): ApiGroup | null {
      const id = getOverrideGroupId(threadId);
      if (!id) return null;
      return groups.find((g) => g.id === id) ?? null;
    },

    async setOverride(threadId: string, groupId: string): Promise<void> {
      await ensureLoaded();
      map = { ...(map ?? {}), [threadId]: groupId };
      await persist();
    },

    async clearOverride(threadId: string): Promise<void> {
      await ensureLoaded();
      if (!map?.[threadId]) return;
      const next = { ...(map ?? {}) };
      delete next[threadId];
      map = next;
      await persist();
    },

    /** Test hook. */
    async __resetForTests(): Promise<void> {
      map = {};
      loadDone = true;
      emit();
    },
  };
}

export type DialogModelOverrideStore = ReturnType<typeof createDialogModelOverrideStore>;

/** App-wide singleton. */
export const dialogModelOverrideStore = createDialogModelOverrideStore();

export function useDialogModelOverride(threadId: string): {
  overrideGroupId: string | null;
  loaded: boolean;
  setOverride: (groupId: string) => Promise<void>;
  clearOverride: () => Promise<void>;
} {
  const snap = useSyncExternalStore(
    dialogModelOverrideStore.subscribe,
    dialogModelOverrideStore.getSnapshot,
    dialogModelOverrideStore.getSnapshot,
  );
  return {
    overrideGroupId: snap.overrides[threadId] ?? null,
    loaded: snap.loaded,
    setOverride: (groupId: string) => dialogModelOverrideStore.setOverride(threadId, groupId),
    clearOverride: () => dialogModelOverrideStore.clearOverride(threadId),
  };
}
