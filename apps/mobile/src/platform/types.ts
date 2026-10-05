/**
 * Platform integration shared types (Batch 6 — H).
 *
 * iOS system integrations: Share Extension, Siri Shortcuts, Widget,
 * Live Activity, FileProvider, Face ID lock, HomeKit, Apple NLP.
 * Native-heavy items follow the AlarmKit pattern: TS side is complete,
 * native module is a reference + wiring instructions in plugins/.
 */

export type PlatformModuleStatus = "available" | "unavailable" | "not-configured";

/** Result of a lazy native module probe. */
export interface NativeModuleProbe {
  available: boolean;
  reason?: string;
}

/**
 * App Group identifier for sharing data between the app and its extensions
 * (Share Extension, Widget, FileProvider). Must match the Xcode configuration.
 */
export const APP_GROUP_ID = "group.app.dudu.mobile";

/** Keys in the shared UserDefaults (app group). */
export const SHARED_KEYS = {
  pendingShare: "dudu.pendingShare.v1",
  widgetData: "dudu.widgetData.v1",
  liveActivityState: "dudu.liveActivity.v1",
} as const;

/**
 * Get a native module by name via expo-modules-core.
 * Uses require() (not import) so the module stays importable in node tests
 * and tsc doesn't need the native package installed.
 */
export function getNativeModule<T>(name: string): T | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const req = (typeof require !== "undefined" ? require : null) as
      | ((id: string) => unknown)
      | null;
    if (!req) return null;
    const mod = req("expo-modules-core") as {
      NativeModulesProxy?: Record<string, unknown>;
    };
    return (mod?.NativeModulesProxy?.[name] as T) ?? null;
  } catch {
    return null;
  }
}
