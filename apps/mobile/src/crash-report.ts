/**
 * Crash report persistence (2026-10-06).
 *
 * componentDidCatch used to be intentionally silent, which meant a JS crash
 * left zero trace on the device. Now the boundary records every caught
 * error (message + stack + timestamp + screen label) into a small
 * AsyncStorage ring buffer. CrashFallback shows the latest report so a
 * screenshot tells us what died, and the reports survive relaunch so they
 * can be surfaced again (e.g. in settings) later.
 *
 * Never throws — reporting must never break the fallback screen.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export interface CrashReport {
  /** Date.now() when the error was caught. */
  t: number;
  /** Screen label from the boundary, if any. */
  label?: string;
  /** error.message (truncated). */
  message: string;
  /** error.stack (truncated). May be empty on some engines. */
  stack: string;
}

const KEY = "dudu.crashreport.v1";
const MAX_REPORTS = 10;
const MAX_LEN = 2000;

function truncate(s: string): string {
  return s.length > MAX_LEN ? `${s.slice(0, MAX_LEN)}…` : s;
}

/** Record a caught render error. Never throws. */
export async function recordCrashReport(error: unknown, label?: string): Promise<void> {
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    const raw = await AsyncStorage.getItem(KEY);
    const arr: CrashReport[] = raw ? (JSON.parse(raw) as CrashReport[]) : [];
    arr.push({
      t: Date.now(),
      label,
      message: truncate(err.message || String(error)),
      stack: truncate(err.stack ?? ""),
    });
    await AsyncStorage.setItem(KEY, JSON.stringify(arr.slice(-MAX_REPORTS)));
  } catch {
    // Reporting must never break the fallback screen.
  }
}

/** Read recorded crash reports, oldest first. Never throws. */
export async function readCrashReports(): Promise<CrashReport[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CrashReport[]) : [];
  } catch {
    return [];
  }
}

/** Clear recorded crash reports. Never throws. */
export async function clearCrashReports(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
