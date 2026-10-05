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
  /**
   * False when she switched it off in settings. The record is kept (for
   * re-enable / edit / delete) but nothing is scheduled natively.
   * Absent on old records — they count as enabled.
   */
  enabled?: boolean;
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

  /** Run the native scheduling (AlarmKit, else notification). Shared by schedule/enable/reschedule. */
  async function scheduleNative(
    fireAt: number,
    label: string,
  ): Promise<{ id: string; viaAlarmKit: boolean }> {
    // Try AlarmKit first.
    const kit = await deps.alarmKit();
    if (kit) {
      try {
        if (!kit.isAvailable()) throw new Error("unavailable");
        const ok = await kit.requestAuthorization();
        if (!ok) throw new AlarmError("得先允许闹钟权限，不然到点叫不醒你");
        const id = await kit.scheduleAlarm(fireAt, label);
        return { id, viaAlarmKit: true };
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
      content: { title: label, body: "到点了", sound: true },
      trigger: { type: "date", date: new Date(fireAt) },
    });
    return { id, viaAlarmKit: false };
  }

  /** Best-effort native cancellation for one record. */
  async function cancelNative(alarm: Alarm): Promise<void> {
    if (alarm.viaAlarmKit) {
      const kit = await deps.alarmKit();
      if (kit) {
        try {
          await kit.cancelAlarm(alarm.id);
        } catch {
          // Best-effort: the record is dropped regardless.
        }
      }
    } else {
      const notif = await deps.notifications();
      if (notif) {
        try {
          await notif.cancelScheduledNotificationAsync(alarm.id);
        } catch {
          // Best-effort.
        }
      }
    }
  }

  return {
    async list(): Promise<Alarm[]> {
      const alarms = await load();
      const now = Date.now();
      // Drop fired alarms older than an hour — they've rung. Disabled
      // alarms are kept no matter how old: she's managing them, and
      // deleting is her explicit call.
      const live = alarms.filter((a) => a.enabled === false || a.fireAt > now - 3_600_000);
      if (live.length !== alarms.length) await save(live);
      return live
        .map((a) => ({ ...a, enabled: a.enabled !== false }))
        .sort((a, b) => a.fireAt - b.fireAt);
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

      const { id, viaAlarmKit } = await scheduleNative(fireAt, cleanLabel);
      const alarm: Alarm = {
        id,
        fireAt,
        label: cleanLabel,
        viaAlarmKit,
        enabled: true,
        createdAt: Date.now(),
      };
      const alarms = await load();
      alarms.push(alarm);
      await save(alarms);
      return alarm;
    },

    /**
     * Switch an alarm on/off from the settings UI.
     * Off: native scheduling is cancelled but the record is kept for
     * re-enable / edit / delete. On: re-schedules natively; the time
     * must still be in the future (else it throws honestly — edit the
     * time instead).
     */
    async setEnabled(id: string, enabled: boolean): Promise<Alarm> {
      const alarms = await load();
      const target = alarms.find((a) => a.id === id);
      if (!target) throw new AlarmError("找不到这个闹钟，可能已经被删了");
      const isEnabled = target.enabled !== false;
      if (isEnabled === enabled) return { ...target, enabled: isEnabled };
      if (!enabled) {
        await cancelNative(target);
        const updated: Alarm = { ...target, enabled: false };
        await save(alarms.map((a) => (a.id === id ? updated : a)));
        return updated;
      }
      const problem = validateAlarmTime(target.fireAt);
      if (problem === "alarmPast") {
        throw new AlarmError("这个时间已经过了，改个时间再打开吧");
      }
      if (problem === "alarmTooFar") {
        throw new AlarmError("闹钟时间太远了，一年以内吧");
      }
      const { id: newId, viaAlarmKit } = await scheduleNative(target.fireAt, target.label);
      const updated: Alarm = { ...target, id: newId, viaAlarmKit, enabled: true };
      await save(alarms.map((a) => (a.id === id ? updated : a)));
      return updated;
    },

    /**
     * Move an alarm to a new time (and optionally a new label).
     * An enabled alarm is re-scheduled natively — the new schedule goes
     * first, then the old one is cancelled, so a failed schedule never
     * leaves a record that says "on" with no native alarm behind it.
     * A disabled one just moves and stays off.
     */
    async reschedule(id: string, fireAt: number, label?: string): Promise<Alarm> {
      const problem = validateAlarmTime(fireAt);
      if (problem === "alarmPast") {
        throw new AlarmError("闹钟时间得是未来，至少 1 分钟以后");
      }
      if (problem === "alarmTooFar") {
        throw new AlarmError("闹钟时间太远了，一年以内吧");
      }
      const alarms = await load();
      const target = alarms.find((a) => a.id === id);
      if (!target) throw new AlarmError("找不到这个闹钟，可能已经被删了");
      const cleanLabel = label === undefined ? target.label : label.trim() || "闹钟";
      const wasEnabled = target.enabled !== false;
      if (!wasEnabled) {
        const updated: Alarm = { ...target, fireAt, label: cleanLabel, enabled: false };
        await save(alarms.map((a) => (a.id === id ? updated : a)));
        return updated;
      }
      // Schedule the NEW time first, then cancel the old native alarm.
      // If the new schedule fails (permission revoked, native module gone),
      // the old alarm stays exactly as it was — the record and the native
      // schedule never disagree about whether the alarm will fire.
      const { id: newId, viaAlarmKit } = await scheduleNative(fireAt, cleanLabel);
      await cancelNative(target);
      const updated: Alarm = {
        ...target,
        id: newId,
        fireAt,
        label: cleanLabel,
        viaAlarmKit,
        enabled: true,
      };
      await save(alarms.map((a) => (a.id === id ? updated : a)));
      return updated;
    },

    async cancel(id: string): Promise<void> {
      const alarms = await load();
      const target = alarms.find((a) => a.id === id);
      if (target) await cancelNative(target);
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
