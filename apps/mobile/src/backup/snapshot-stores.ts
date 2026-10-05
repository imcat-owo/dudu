/**
 * Snapshot store singleton.
 *
 * The snapshot module is PURE (injectable backends); this file wires it to
 * AsyncStorage + expo-file-system (lazy, so node tests keep working).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { createSnapshotStore, type SnapshotFileBackend } from "./snapshot";

async function fileBackend(): Promise<SnapshotFileBackend> {
  const FileSystem = await import("expo-file-system/legacy");
  const base = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? "";
  return {
    async writeFile(path, content) {
      await FileSystem.writeAsStringAsync(base + path, content, {
        encoding: "utf8",
      });
    },
    async readFile(path) {
      return FileSystem.readAsStringAsync(base + path, { encoding: "utf8" });
    },
    async deleteFile(path) {
      await FileSystem.deleteAsync(base + path, { idempotent: true });
    },
    async listFiles(dir) {
      try {
        return await FileSystem.readDirectoryAsync(base + dir);
      } catch {
        return [];
      }
    },
  };
}

/** Lazily-created singleton (file backend needs an async import). */
let singleton: ReturnType<typeof createSnapshotStore> | null = null;

export async function getSnapshotStore(): Promise<ReturnType<typeof createSnapshotStore>> {
  if (!singleton) singleton = createSnapshotStore(AsyncStorage, await fileBackend());
  return singleton;
}
