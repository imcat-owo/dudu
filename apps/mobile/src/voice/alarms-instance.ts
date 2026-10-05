/**
 * The app-wide alarm store, shared by the settings UI and the AI tools.
 *
 * The lazy native-module loaders used to live inside createAlarmTools;
 * they moved here so the voice settings UI manages alarms against the
 * exact same store the AI uses (same AsyncStorage backend, same native
 * modules). Behavior is unchanged.
 *
 * Not PURE: imports AsyncStorage at module scope (app code only — the
 * testable logic stays in ./alarms).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  type AlarmKitNative,
  type AlarmStore,
  createAlarmStore,
  type NotificationsNative,
} from "./alarms";

/** Load the AlarmKit native module (with-alarmkit config plugin). Null when unavailable. */
export async function loadAlarmKitNative(): Promise<AlarmKitNative | null> {
  try {
    // expo-modules-core is an optional native dependency — resolve it
    // dynamically so the module stays importable without it (tests).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const req = (typeof require !== "undefined" ? require : null) as
      | ((id: string) => unknown)
      | null;
    const mod = req
      ? (req("expo-modules-core") as { NativeModulesProxy?: Record<string, unknown> })
      : null;
    const native = mod?.NativeModulesProxy?.DuduAlarmKit as
      | {
          isAvailable(): boolean;
          requestAuthorization(): Promise<boolean>;
          scheduleAlarm(fireAt: number, label: string): Promise<string>;
          cancelAlarm(id: string): Promise<void>;
        }
      | undefined;
    if (!native) return null;
    return {
      isAvailable: () => native.isAvailable(),
      requestAuthorization: () => native.requestAuthorization(),
      scheduleAlarm: (fireAt: number, label: string) => native.scheduleAlarm(fireAt, label),
      cancelAlarm: (id: string) => native.cancelAlarm(id),
      listAlarms: async () => [] as Array<{ id: string; fireAt: number; label: string }>,
    };
  } catch {
    return null;
  }
}

/** Load expo-notifications lazily. Null when unavailable. */
export async function loadNotificationsNative(): Promise<NotificationsNative | null> {
  try {
    const mod = await import("expo-notifications");
    return {
      requestPermissionsAsync: async () => {
        const r = await mod.requestPermissionsAsync();
        return { granted: r.granted };
      },
      scheduleNotificationAsync: (opts: {
        content: { title: string; body: string; sound: boolean };
        trigger: { type: "date"; date: Date };
      }) =>
        mod.scheduleNotificationAsync({
          content: opts.content,
          // expo-notifications v0.32+: date trigger needs explicit type.
          trigger: { type: mod.SchedulableTriggerInputTypes.DATE, date: opts.trigger.date },
        }),
      cancelScheduledNotificationAsync: (id: string) => mod.cancelScheduledNotificationAsync(id),
    };
  } catch {
    return null;
  }
}

let cached: AlarmStore | null = null;

/**
 * The app-wide alarm store — the same one behind the AI's
 * set_alarm / list_alarms / cancel_alarm tools.
 */
export function getAlarmStore(): AlarmStore {
  if (!cached) {
    cached = createAlarmStore({
      backend: AsyncStorage,
      alarmKit: loadAlarmKitNative,
      notifications: loadNotificationsNative,
    });
  }
  return cached;
}
