/**
 * Mounted folders — PURE module (no React Native imports).
 *
 * D9: Mount phone folders into the AI's sandbox so it can work directly
 * on her files. She picks a folder (document picker); the sandbox backend
 * bind-mounts it.
 *
 * iOS reality: apps are sandboxed. "Mounting" means:
 * - Backend A (cloud Docker): the folder is synced to the server (or the
 *   server accesses it via the app's file provider).
 * - Backend B (local iSH): bind-mount into the Alpine guest (if the
 *   native module supports it).
 * If the active backend can't mount, the tool fails honestly — never fake.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

const KEY = "dudu.mounted-folders.v1";

export interface MountedFolder {
  id: string;
  /** Display name she gave it. */
  name: string;
  /** Local URI (from the document picker). */
  uri: string;
  /** Mount point inside the sandbox, e.g. "/mnt/photos". */
  mountPoint: string;
  /** Which backend this mount is for ("cloud" | "local" | "both"). */
  backend: "cloud" | "local" | "both";
  addedAt: number;
}

export function createMountStore() {
  let mounts: MountedFolder[] | null = null;
  const listeners = new Set<() => void>();
  let snapshot: { mounts: MountedFolder[]; loaded: boolean } = {
    mounts: [],
    loaded: false,
  };

  function emit() {
    snapshot = { mounts: mounts ?? [], loaded: mounts !== null };
    for (const l of listeners) l();
  }

  let loadPromise: Promise<void> | null = null;
  function ensureLoaded(): Promise<void> {
    if (!loadPromise) {
      loadPromise = (async () => {
        try {
          const raw = await AsyncStorage.getItem(KEY);
          mounts = raw ? (JSON.parse(raw) as MountedFolder[]) : [];
        } catch {
          mounts = [];
        }
        emit();
      })();
    }
    return loadPromise;
  }
  void ensureLoaded();

  async function persist(): Promise<void> {
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(mounts ?? []));
    } catch {
      // ignore
    }
    emit();
  }

  return {
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    getSnapshot() {
      return snapshot;
    },

    async add(m: Omit<MountedFolder, "id" | "addedAt">): Promise<MountedFolder> {
      await ensureLoaded();
      const folder: MountedFolder = {
        ...m,
        id: `mnt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        addedAt: Date.now(),
      };
      mounts = [...(mounts ?? []), folder];
      await persist();
      return folder;
    },

    async remove(id: string): Promise<void> {
      await ensureLoaded();
      mounts = (mounts ?? []).filter((m) => m.id !== id);
      await persist();
    },

    async list(): Promise<MountedFolder[]> {
      await ensureLoaded();
      return [...(mounts ?? [])];
    },
  };
}

export const mountStore = createMountStore();

export function useMountedFolders(): { mounts: MountedFolder[]; loaded: boolean } {
  const snap = useSyncExternalStore(
    mountStore.subscribe,
    mountStore.getSnapshot,
    mountStore.getSnapshot,
  );
  return snap;
}
