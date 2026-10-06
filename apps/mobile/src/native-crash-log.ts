/**
 * Native crash-log reader (2026-10-06).
 *
 * The native crash trap (plugins/with-native-crash-trap.js) writes
 * uncaught NSExceptions and all RCTLog lines to
 * Library/Caches/dudu-native-crash.log from the AppDelegate. This module
 * reads that file on the JS side so CrashFallback can surface the evidence
 * on the next launch — it identifies which native module threw at startup.
 *
 * Never throws — the reader must never break the fallback screen.
 */

import * as FileSystem from "expo-file-system/legacy";

const FILE_NAME = "dudu-native-crash.log";
/** Lines kept for the fallback screen. Enough to name the module. */
const MAX_LINES = 40;

/** Read the last MAX_LINES of the native trap log. Empty when absent. */
export async function readNativeCrashLog(): Promise<string[]> {
  try {
    const dir = FileSystem.cacheDirectory;
    if (!dir) return [];
    const info = await FileSystem.getInfoAsync(dir + FILE_NAME);
    if (!info.exists) return [];
    const text = await FileSystem.readAsStringAsync(dir + FILE_NAME);
    return text
      .split("\n")
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0)
      .slice(-MAX_LINES);
  } catch {
    return [];
  }
}
