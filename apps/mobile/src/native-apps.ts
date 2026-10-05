/* eslint-disable @typescript-eslint/no-require-imports — lazy optional requires are intentional here */
/**
 * 原生应用授权 (Native App Authorizations) — pure logic.
 *
 * Every iOS-native capability that third-party apps can request authorization
 * for via PUBLIC API. No private API, no special restricted entitlements.
 *
 * Capabilities with real Expo/native packages get real auth flows:
 * - apple-music: surfaced from the music module (MusicKit, already wired)
 * - calendar / reminders: expo-calendar
 * - contacts: expo-contacts
 * - healthkit: react-native-health (needs dev build / prebuild)
 * - device-info: expo-battery + expo-device (permission-free, no auth needed)
 *
 * Capabilities with no Expo package are shown honestly as "needs native
 * module" — never faked:
 * - homekit: needs com.apple.developer.homekit entitlement + native module
 * - siri: App Intents need native code, no Expo package exists
 * - weather: WeatherKit needs paid developer account + server token
 * - shazam: ShazamKit needs native module, no Expo package exists
 *
 * PURE module: no React Native imports at the top level — native modules
 * are require()'d lazily inside functions so unit tests can run in node.
 */

import { type StringKey, t } from "./i18n";

export type NativeAppId =
  | "apple-music"
  | "calendar"
  | "reminders"
  | "contacts"
  | "healthkit"
  | "device-info"
  | "homekit"
  | "siri"
  | "weather"
  | "shazam";

export type NativeAppStatus = "granted" | "denied" | "undetermined" | "unavailable" | "needs-setup";

export interface NativeAppDef {
  id: NativeAppId;
  /** i18n key for the display name */
  nameKey: StringKey;
  /** i18n key for the one-line description */
  descKey: StringKey;
  /** i18n key explaining what she must do outside the app (if any) */
  setupKey?: StringKey;
  /** true when this build can actually request authorization */
  wired: boolean;
  /** lucide icon name (resolved in UI) */
  icon: string;
}

export const NATIVE_APPS: Record<NativeAppId, NativeAppDef> = {
  "apple-music": {
    id: "apple-music",
    nameKey: "napp.appleMusic.name",
    descKey: "napp.appleMusic.desc",
    wired: true,
    icon: "Music",
  },
  calendar: {
    id: "calendar",
    nameKey: "napp.calendar.name",
    descKey: "napp.calendar.desc",
    wired: true,
    icon: "Calendar",
  },
  reminders: {
    id: "reminders",
    nameKey: "napp.reminders.name",
    descKey: "napp.reminders.desc",
    wired: true,
    icon: "BellRing",
  },
  contacts: {
    id: "contacts",
    nameKey: "napp.contacts.name",
    descKey: "napp.contacts.desc",
    wired: true,
    icon: "Users",
  },
  healthkit: {
    id: "healthkit",
    nameKey: "napp.healthkit.name",
    descKey: "napp.healthkit.desc",
    wired: true,
    icon: "HeartPulse",
  },
  "device-info": {
    id: "device-info",
    nameKey: "napp.deviceInfo.name",
    descKey: "napp.deviceInfo.desc",
    wired: true,
    icon: "Smartphone",
  },
  homekit: {
    id: "homekit",
    nameKey: "napp.homekit.name",
    descKey: "napp.homekit.desc",
    setupKey: "napp.homekit.setup",
    wired: false,
    icon: "House",
  },
  siri: {
    id: "siri",
    nameKey: "napp.siri.name",
    descKey: "napp.siri.desc",
    setupKey: "napp.siri.setup",
    wired: false,
    icon: "Mic",
  },
  weather: {
    id: "weather",
    nameKey: "napp.weather.name",
    descKey: "napp.weather.desc",
    setupKey: "napp.weather.setup",
    wired: false,
    icon: "CloudSun",
  },
  shazam: {
    id: "shazam",
    nameKey: "napp.shazam.name",
    descKey: "napp.shazam.desc",
    setupKey: "napp.shazam.setup",
    wired: false,
    icon: "AudioWaveform",
  },
};

export const NATIVE_APP_ORDER: NativeAppId[] = [
  "apple-music",
  "calendar",
  "reminders",
  "contacts",
  "healthkit",
  "device-info",
  "homekit",
  "siri",
  "weather",
  "shazam",
];

function normalize(status: string | undefined): NativeAppStatus {
  if (status === "granted") return "granted";
  if (status === "denied") return "denied";
  return "undetermined";
}

/** Lazy require — keeps this module importable in node tests.
 * Takes a thunk so Metro sees a static require() call (it rejects
 * require(variable) at bundle time); the try/catch still makes the
 * module optional at runtime. */
function tryRequire<T>(load: () => T): T | null {
  try {
    return load();
  } catch {
    return null;
  }
}

/* ---------------- Apple Music (surfaced from music module) ---------------- */

export async function checkAppleMusicStatus(): Promise<NativeAppStatus> {
  try {
    const mod = tryRequire(() => require("./music/sources")) as {
      getMusicSource?: (id: string) => { getAuthState?: () => Promise<string> } | undefined;
    } | null;
    const src = mod?.getMusicSource?.("apple-music");
    const state = await src?.getAuthState?.();
    if (state === "authorized") return "granted";
    if (state === "denied") return "denied";
    if (state === "unavailable" || state === "unconfigured") return "unavailable";
    return "undetermined";
  } catch {
    return "unavailable";
  }
}

export async function requestAppleMusic(): Promise<NativeAppStatus> {
  try {
    const mod = tryRequire(() => require("./music/sources")) as {
      getMusicSource?: (id: string) => { authorize?: () => Promise<string> } | undefined;
    } | null;
    const src = mod?.getMusicSource?.("apple-music");
    const state = await src?.authorize?.();
    if (state === "authorized") return "granted";
    if (state === "denied") return "denied";
    return "undetermined";
  } catch {
    return "unavailable";
  }
}

/* ---------------- Calendar & Reminders (expo-calendar) ---------------- */

export async function checkCalendarStatus(): Promise<NativeAppStatus> {
  const Calendar = tryRequire(() => require("expo-calendar")) as {
    getCalendarPermissionsAsync?: () => Promise<{ status: string }>;
  } | null;
  if (!Calendar?.getCalendarPermissionsAsync) return "unavailable";
  try {
    const res = await Calendar.getCalendarPermissionsAsync();
    return normalize(res.status);
  } catch {
    return "unavailable";
  }
}

export async function requestCalendar(): Promise<NativeAppStatus> {
  const Calendar = tryRequire(() => require("expo-calendar")) as {
    requestCalendarPermissionsAsync?: () => Promise<{ status: string }>;
  } | null;
  if (!Calendar?.requestCalendarPermissionsAsync) return "unavailable";
  try {
    const res = await Calendar.requestCalendarPermissionsAsync();
    return normalize(res.status);
  } catch {
    return "unavailable";
  }
}

export async function checkRemindersStatus(): Promise<NativeAppStatus> {
  const Calendar = tryRequire(() => require("expo-calendar")) as {
    getRemindersPermissionsAsync?: () => Promise<{ status: string }>;
  } | null;
  if (!Calendar?.getRemindersPermissionsAsync) return "unavailable";
  try {
    const res = await Calendar.getRemindersPermissionsAsync();
    return normalize(res.status);
  } catch {
    return "unavailable";
  }
}

export async function requestReminders(): Promise<NativeAppStatus> {
  const Calendar = tryRequire(() => require("expo-calendar")) as {
    requestRemindersPermissionsAsync?: () => Promise<{ status: string }>;
  } | null;
  if (!Calendar?.requestRemindersPermissionsAsync) return "unavailable";
  try {
    const res = await Calendar.requestRemindersPermissionsAsync();
    return normalize(res.status);
  } catch {
    return "unavailable";
  }
}

/* ---------------- Contacts (expo-contacts) ---------------- */

export async function checkContactsStatus(): Promise<NativeAppStatus> {
  const Contacts = tryRequire(() => require("expo-contacts")) as {
    getPermissionsAsync?: () => Promise<{ status: string }>;
  } | null;
  if (!Contacts?.getPermissionsAsync) return "unavailable";
  try {
    const res = await Contacts.getPermissionsAsync();
    return normalize(res.status);
  } catch {
    return "unavailable";
  }
}

export async function requestContacts(): Promise<NativeAppStatus> {
  const Contacts = tryRequire(() => require("expo-contacts")) as {
    requestPermissionsAsync?: () => Promise<{ status: string }>;
  } | null;
  if (!Contacts?.requestPermissionsAsync) return "unavailable";
  try {
    const res = await Contacts.requestPermissionsAsync();
    return normalize(res.status);
  } catch {
    return "unavailable";
  }
}

/* ---------------- HealthKit (react-native-health) ---------------- */

const HEALTH_READ_TYPES = [
  "StepCount",
  "SleepAnalysis",
  "HeartRate",
  "ActiveEnergyBurned",
] as const;

export async function checkHealthKitStatus(): Promise<NativeAppStatus> {
  const Health = tryRequire(() => require("react-native-health")) as {
    isAvailable?: (cb: (err: unknown, ok: boolean) => void) => void;
    getAuthStatus?: (
      perms: { read: string[]; write: string[] },
      cb: (err: unknown, res: unknown) => void,
    ) => void;
  } | null;
  if (!Health?.isAvailable) return "unavailable";
  const isAvailable = Health.isAvailable;
  const available = await new Promise<boolean>((resolve) => isAvailable((_, ok) => resolve(!!ok)));
  if (!available) return "unavailable";
  // react-native-health has no silent "get status" — initHealthKit prompts.
  // We report undetermined until she authorizes once; the result is cached.
  return "undetermined";
}

export async function requestHealthKit(): Promise<NativeAppStatus> {
  const Health = tryRequire(() => require("react-native-health")) as {
    initHealthKit?: (
      opts: { permissions: { read: string[]; write: string[] } },
      cb: (err: unknown, res: unknown) => void,
    ) => void;
  } | null;
  if (!Health?.initHealthKit) return "unavailable";
  const initHealthKit = Health.initHealthKit;
  try {
    const result = await new Promise<unknown>((resolve, reject) =>
      initHealthKit({ permissions: { read: [...HEALTH_READ_TYPES], write: [] } }, (err, res) =>
        err ? reject(err) : resolve(res),
      ),
    );
    return result ? "granted" : "denied";
  } catch {
    return "denied";
  }
}

/** Read today's step count. Throws if not authorized. */
export async function readTodaySteps(): Promise<number> {
  const Health = tryRequire(() => require("react-native-health")) as {
    getStepCount?: (
      opts: { date: string },
      cb: (err: unknown, res: { value: number }) => void,
    ) => void;
  } | null;
  if (!Health?.getStepCount) throw new Error(t("napp.healthkit.unavailable"));
  const getStepCount = Health.getStepCount;
  const today = new Date().toISOString();
  const res = await new Promise<{ value: number }>((resolve, reject) =>
    getStepCount({ date: today }, (err, r) => (err ? reject(err) : resolve(r))),
  );
  return Math.round(res.value);
}

/* ---------------- Device info (expo-battery + expo-device) ---------------- */

/**
 * Device info. Permission-free — no iOS authorization needed, the system
 * clock and battery APIs are open to every app.
 */
export interface DeviceInfo {
  /** Battery level 0-100, null when unknown. */
  batteryLevel: number | null;
  batteryState: "unknown" | "unplugged" | "charging" | "full";
  lowPowerMode: boolean | null;
  modelName: string | null;
  osName: string | null;
  osVersion: string | null;
  deviceName: string | null;
}

export function formatBatteryState(state: DeviceInfo["batteryState"]): StringKey {
  switch (state) {
    case "charging":
      return "napp.deviceInfo.charging";
    case "full":
      return "napp.deviceInfo.full";
    case "unplugged":
      return "napp.deviceInfo.unplugged";
    default:
      return "napp.deviceInfo.unknown";
  }
}

/** Read battery + device info. Throws if the native modules are missing. */
export async function getDeviceInfo(): Promise<DeviceInfo> {
  const Battery = tryRequire(() => require("expo-battery")) as {
    getBatteryLevelAsync?: () => Promise<number>;
    getBatteryStateAsync?: () => Promise<number>;
    isLowPowerModeEnabledAsync?: () => Promise<boolean>;
  } | null;
  const Device = tryRequire(() => require("expo-device")) as {
    modelName?: string | null;
    osName?: string | null;
    osVersion?: string | null;
    deviceName?: string | null;
  } | null;
  if (!Battery && !Device) throw new Error(t("napp.deviceInfo.unavailable"));

  let batteryLevel: number | null = null;
  let batteryState: DeviceInfo["batteryState"] = "unknown";
  let lowPowerMode: boolean | null = null;
  if (Battery) {
    try {
      const lvl = await Battery.getBatteryLevelAsync?.();
      batteryLevel = typeof lvl === "number" && lvl >= 0 ? Math.round(lvl * 100) : null;
    } catch {
      // leave null — honest unknown
    }
    try {
      const st = await Battery.getBatteryStateAsync?.();
      batteryState = st === 2 ? "charging" : st === 3 ? "full" : st === 1 ? "unplugged" : "unknown";
    } catch {
      // leave unknown
    }
    try {
      const lpm = await Battery.isLowPowerModeEnabledAsync?.();
      lowPowerMode = typeof lpm === "boolean" ? lpm : null;
    } catch {
      // leave null
    }
  }

  return {
    batteryLevel,
    batteryState,
    lowPowerMode,
    modelName: Device?.modelName ?? null,
    osName: Device?.osName ?? null,
    osVersion: Device?.osVersion ?? null,
    deviceName: Device?.deviceName ?? null,
  };
}

/**
 * Device info needs no authorization — "granted" here means the native
 * modules are present and working. Nothing to request, so request = check.
 */
export async function checkDeviceInfoStatus(): Promise<NativeAppStatus> {
  const Battery = tryRequire(() => require("expo-battery"));
  const Device = tryRequire(() => require("expo-device"));
  return Battery || Device ? "granted" : "unavailable";
}

/* ---------------- Unwired capabilities (honest states) ---------------- */

export async function checkUnwired(): Promise<NativeAppStatus> {
  return "needs-setup";
}

export const checkers: Record<NativeAppId, () => Promise<NativeAppStatus>> = {
  "apple-music": checkAppleMusicStatus,
  calendar: checkCalendarStatus,
  reminders: checkRemindersStatus,
  contacts: checkContactsStatus,
  healthkit: checkHealthKitStatus,
  "device-info": checkDeviceInfoStatus,
  homekit: checkUnwired,
  siri: checkUnwired,
  weather: checkUnwired,
  shazam: checkUnwired,
};

export const requesters: Record<NativeAppId, () => Promise<NativeAppStatus>> = {
  "apple-music": requestAppleMusic,
  calendar: requestCalendar,
  reminders: requestReminders,
  contacts: requestContacts,
  healthkit: requestHealthKit,
  "device-info": checkDeviceInfoStatus,
  homekit: checkUnwired,
  siri: checkUnwired,
  weather: checkUnwired,
  shazam: checkUnwired,
};
