/**
 * Boot milestone log — crash-diagnostic (2026-10-06).
 *
 * Her 2026-10-05 IPA died right after the splash with no crash log on the
 * device. This module records timestamped startup milestones so the next
 * failure can be bisected without guessing:
 *
 *   app-launch → splash-done → localapp-mounted → chatscreen-mounted
 *   → webview-skipped (normal) / webview-mounted (on demand)
 *
 * Marks go to console AND a small AsyncStorage ring buffer (60 entries).
 * The ring survives a native crash (each mark is persisted when written),
 * and CrashFallback renders the recent marks so they're visible even when
 * the JS tree is down. Never throws — logging must never break boot.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export interface BootMark {
  /** Date.now() at mark time. */
  t: number;
  name: string;
}

const KEY = "dudu.bootlog.v1";
const MAX_MARKS = 60;

/** Record a startup milestone. Never throws. */
export async function bootMark(name: string): Promise<void> {
  console.log(`[boot] ${name}`);
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const arr: BootMark[] = raw ? (JSON.parse(raw) as BootMark[]) : [];
    arr.push({ t: Date.now(), name });
    await AsyncStorage.setItem(KEY, JSON.stringify(arr.slice(-MAX_MARKS)));
  } catch {
    // Logging must never break boot.
  }
}

/** Read recorded milestones, oldest first. Never throws. */
export async function readBootLog(): Promise<BootMark[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as BootMark[]) : [];
  } catch {
    return [];
  }
}

/** Clear recorded milestones. Never throws. */
export async function clearBootLog(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
