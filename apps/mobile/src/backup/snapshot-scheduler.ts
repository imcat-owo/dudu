/**
 * Auto-snapshot scheduler — wires the scheduled-snapshot settings to real
 * behavior (D26). Called on app start and on every foreground: checks
 * isDue() once per event and takes a scheduled snapshot when due.
 *
 * Quiet by design: one check per foreground event, no polling loops,
 * no background timers. Never throws — a failed scheduled backup must
 * never break the app.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { collectBackup, serializeBackup } from "../backup";
import { getKnowledgeStore } from "../knowledge/instance";
import type { SnapshotStore } from "./snapshot";
import { getSnapshotStore } from "./snapshot-stores";

async function secureKV() {
  const { getItemAsync, setItemAsync } = await import("expo-secure-store");
  return {
    getItem: (key: string) => getItemAsync(key),
    setItem: (key: string, value: string) => setItemAsync(key, value),
  };
}

export interface SnapshotSchedulerDeps {
  /** Injected store (tests). Defaults to the real singleton. */
  store?: SnapshotStore;
  /** Injected backup JSON producer (tests). Defaults to the real collectBackup. */
  collectJson?: () => Promise<string>;
}

let inFlight = false;

/**
 * Check once whether a scheduled snapshot is due; take one if so.
 * Safe to call on every foreground — guarded against concurrent runs.
 */
export async function runScheduledSnapshot(deps: SnapshotSchedulerDeps = {}): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const store = deps.store ?? (await getSnapshotStore());
    if (!(await store.isDue())) return;
    const json = deps.collectJson
      ? await deps.collectJson()
      : serializeBackup(
          await collectBackup(AsyncStorage, await secureKV(), await getKnowledgeStore()),
        );
    await store.take(json, "schedule");
  } catch {
    // Scheduled backups are best-effort: never break the app.
  } finally {
    inFlight = false;
  }
}
