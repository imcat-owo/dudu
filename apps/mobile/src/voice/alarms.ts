/**
 * Alarms: let the AI set alarms that actually ring.
 *
 * iOS 26+ has AlarmKit — the system alarm UI (full-screen, snooze).
 * AlarmKit is Swift-only, so it's exposed via a native module added by
 * the `with-alarmkit` config plugin (see apps/mobile/plugins/).
 *
 * This module is the TS side:
 * - Tries the native AlarmKit module first (full alarm experience).
 * - Falls back to expo-notifications scheduling (a loud notification —
 *   not a full alarm, but it does wake her) when AlarmKit is unavailable
 *   (iOS < 26, or the native module isn't linked).
 * - Every alarm is persisted locally so the list survives restarts and
 *   is included in backups.
 *
 * PURE-ish: native modules and notifications are loaded lazily; the
 * scheduling logic and validation are testable in plain node.
 */

export interface Alarm {
  /** Stable id (native id when via AlarmKit, local id otherwise). */
  id: string;
  /** Fire time as epoch ms. */
  fireAt: number;
  /** Label shown on the alarm ("起床", "吃药"…). */
  label: string;
  /** True when scheduled via AlarmKit (system alarm UI). */
  viaAlarmKit: boolean;
  createdAt: number;
}

export class AlarmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlarmError";
  }
}

export interface AlarmBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const ALARMS_KEY = "dudu.alarms.v1";

/** An alarm must be at least this far in the future (1 minute). */
export const MIN_ALARM_LEAD_MS = 60_000;
/** …and not more than a year out (sanity cap). */
export const MAX_ALARM_LEAD_MS = 365 * 24 * 60 * 60 * 1000;

export type AlarmValidationProblem = "alarmPast" | "alarmTooFar" | "alarmLabelRequired";

/** Validate a fire time. Returns the problem key, or null when valid. */
export function validateAlarmTime(
  fireAt: number,
  now: number = Date.now(),
): AlarmValidationProblem | null {
  if (fireAt < now + MIN_ALARM_LEAD_MS) return "alarmPast";
  if (fireAt > now + MAX_ALARM_LEAD_MS) return "alarmTooFar";
  return null;
}

function parseAlarms(raw: string | null): Alarm[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (a): a is Alarm =>
        typeof a === "object" &&
        a !== null &&
        typeof (a as Alarm).id === "string" &&
        typeof (a as Alarm).fireAt === "number",
    );
  } catch {
    return [];
  }
}

/** Native AlarmKit module shape (injected for tests). */
export interface AlarmKitNative {
  isAvailable(): boolean;
  requestAuthorization(): Promise<boolean>;
  scheduleAlarm(fireAt: number, label: string): Promise<string>;
  cancelAlarm(id: string): Promise<void>;
  listAlarms(): Promise<Array<{ id: string; fireAt: number; label: string }>>;
}

/** expo-notifications shape (injected for tests). */
export interface NotificationsNative {
  requestPermissionsAsync(): Promise<{ granted: boolean }>;
  scheduleNotificationAsync(opts: {
    content: { title: string; body: string; sound: boolean };
    trigger: { type: "date"; date: Date };
  }): Promise<string>;
  cancelScheduledNotificationAsync(id: string): Promise<void>;
}

export interface AlarmDeps {
  backend: AlarmBackend;
  alarmKit: () => Promise<AlarmKitNative | null>;
  notifications: () => Promise<NotificationsNative | null>;
}

export function createAlarmStore(deps: AlarmDeps) {
  async function load(): Promise<Alarm[]> {
    return parseAlarms(await deps.backend.getItem(ALARMS_KEY));
  }

  async function save(alarms: Alarm[]): Promise<void> {
    try {
      await deps.backend.setItem(ALARMS_KEY, JSON.stringify(alarms));
    } catch {
      // Non-fatal: memory keeps this session working.
    }
  }

  return {
    async list(): Promise<Alarm[]> {
      const alarms = await load();
      const now = Date.now();
      // Drop fired alarms older than an hour — they've rung.
      const live = alarms.filter((a) => a.fireAt > now - 3_600_000);
      if (live.length !== alarms.length) await save(live);
      return live.sort((a, b) => a.fireAt - b.fireAt);
    },

    /**
     * Schedule an alarm. Prefers AlarmKit (system alarm UI); falls back
     * to a scheduled notification. Throws AlarmError (loud) on failure.
     */
    async schedule(fireAt: number, label: string): Promise<Alarm> {
      const problem = validateAlarmTime(fireAt);
      if (problem === "alarmPast") {
        throw new AlarmError("闹钟时间得是未来，至少 1 分钟以后");
      }
      if (problem === "alarmTooFar") {
        throw new AlarmError("闹钟时间太远了，一年以内吧");
      }
      const cleanLabel = label.trim() || "闹钟";

      // Try AlarmKit first.
      const kit = await deps.alarmKit();
      if (kit) {
        try {
          if (!kit.isAvailable()) throw new Error("unavailable");
          const ok = await kit.requestAuthorization();
          if (!ok) throw new AlarmError("得先允许闹钟权限，不然到点叫不醒你");
          const id = await kit.scheduleAlarm(fireAt, cleanLabel);
          const alarm: Alarm = {
            id,
            fireAt,
            label: cleanLabel,
            viaAlarmKit: true,
            createdAt: Date.now(),
          };
          const alarms = await load();
          alarms.push(alarm);
          await save(alarms);
          return alarm;
        } catch (e) {
          if (e instanceof AlarmError) throw e;
          // Fall through to notifications.
        }
      }

      // Fallback: scheduled notification.
      const notif = await deps.notifications();
      if (!notif) {
        throw new AlarmError("闹钟功能不可用：需要 iOS 26+ 的 AlarmKit 或通知权限");
      }
      const { granted } = await notif.requestPermissionsAsync();
      if (!granted) {
        throw new AlarmError("得先允许通知权限，不然到点叫不醒你");
      }
      const id = await notif.scheduleNotificationAsync({
        content: { title: cleanLabel, body: "到点了", sound: true },
        trigger: { type: "date", date: new Date(fireAt) },
      });
      const alarm: Alarm = {
        id,
        fireAt,
        label: cleanLabel,
        viaAlarmKit: false,
        createdAt: Date.now(),
      };
      const alarms = await load();
      alarms.push(alarm);
      await save(alarms);
      return alarm;
    },

    async cancel(id: string): Promise<void> {
      const alarms = await load();
      const target = alarms.find((a) => a.id === id);
      if (target) {
        if (target.viaAlarmKit) {
          const kit = await deps.alarmKit();
          if (kit) {
            try {
              await kit.cancelAlarm(id);
            } catch {
              // Best-effort: still drop it from our list.
            }
          }
        } else {
          const notif = await deps.notifications();
          if (notif) {
            try {
              await notif.cancelScheduledNotificationAsync(id);
            } catch {
              // Best-effort.
            }
          }
        }
      }
      await save(alarms.filter((a) => a.id !== id));
    },

    async clear(): Promise<void> {
      const alarms = await load();
      for (const a of alarms) {
        try {
          await this.cancel(a.id);
        } catch {
          // Best-effort.
        }
      }
    },
  };
}

export type AlarmStore = ReturnType<typeof createAlarmStore>;
