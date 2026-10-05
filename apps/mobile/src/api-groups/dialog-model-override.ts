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
import type { ApiGroup } from "./types";

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
  // P3-4: hard bound on stored overrides — entries are keyed by threadId
  // and threads are never deleted, so an unbounded map grows forever.
  const MAX_OVERRIDES = 100;

  // getSnapshot() MUST return a stable reference: useSyncExternalStore
  // force-rerenders whenever Object.is(getSnapshot(), prev) is false, so a
  // fresh object literal here spins an infinite render loop.
  let snapshot: { overrides: Record<string, string>; loaded: boolean } = {
    overrides: {},
    loaded: false,
  };

  function emit() {
    snapshot = { overrides: map ?? {}, loaded: loadDone };
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
      return snapshot;
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
      const next = { ...(map ?? {}) };
      // Refresh insertion order: re-setting moves the entry to the end so
      // the cap below evicts the stalest entries first.
      delete next[threadId];
      next[threadId] = groupId;
      // P3-4: bound the map — threadIds are never deleted elsewhere, so
      // without a cap this grows forever. Evict oldest-first.
      const keys = Object.keys(next);
      for (let i = 0; i < keys.length - MAX_OVERRIDES; i++) delete next[keys[i]];
      map = next;
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

    /**
     * P3-4: drop overrides for threads that no longer exist. The caller
     * passes the live thread ids (e.g. from listDialogs). No-op when
     * nothing is stale.
     */
    async pruneOverrides(validThreadIds: Iterable<string>): Promise<number> {
      await ensureLoaded();
      const keep = new Set(validThreadIds);
      const next = { ...(map ?? {}) };
      let dropped = 0;
      for (const id of Object.keys(next)) {
        if (!keep.has(id)) {
          delete next[id];
          dropped++;
        }
      }
      if (dropped > 0) {
        map = next;
        await persist();
      }
      return dropped;
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
