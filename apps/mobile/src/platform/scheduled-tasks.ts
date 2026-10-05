/**
 * H3 — User-scheduled tasks ("remind me every day at 9am").
 *
 * Different from the AI's proactive triggers: these are HER explicit
 * cron-style tasks. iOS can't run code in the background reliably, so
 * tasks fire as local notifications (expo-notifications) — honest
 * degradation, same as Kelivo on iOS.
 *
 * Recurrence: once | daily | weekly | monthly.
 * When a notification fires while the app is open, we surface it in-app.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const STORE_KEY = "dudu.scheduled-tasks.v1";

export type TaskRecurrence = "once" | "daily" | "weekly" | "monthly";

export interface ScheduledTask {
  id: string;
  title: string;
  /** What to tell her when it fires. */
  message: string;
  /** Next fire time, epoch ms. */
  nextFireAt: number;
  recurrence: TaskRecurrence;
  /** For weekly: 0-6 (Sunday=0). For monthly: 1-31. */
  daySpec?: number;
  /** HH:mm in her local timezone. */
  timeOfDay: string;
  enabled: boolean;
  createdAt: number;
  /** Notification IDs scheduled with expo-notifications. */
  notificationIds: string[];
}

export interface NewScheduledTask {
  title: string;
  message: string;
  timeOfDay: string;
  recurrence: TaskRecurrence;
  daySpec?: number;
  /** For "once": the date. Defaults to today/tomorrow. */
  date?: string;
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Compute the next fire time for a task spec, in local time. */
export function computeNextFire(spec: {
  timeOfDay: string;
  recurrence: TaskRecurrence;
  daySpec?: number;
  date?: string;
  from?: number;
}): number {
  const [h, m] = spec.timeOfDay.split(":").map(Number);
  const from = new Date(spec.from ?? Date.now());
  const candidate = new Date(from);
  candidate.setHours(h, m, 0, 0);

  if (spec.recurrence === "once") {
    if (spec.date) {
      const [y, mo, d] = spec.date.split("-").map(Number);
      candidate.setFullYear(y, mo - 1, d);
    }
    if (candidate.getTime() <= from.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate.getTime();
  }
  if (spec.recurrence === "daily") {
    if (candidate.getTime() <= from.getTime()) candidate.setDate(candidate.getDate() + 1);
    return candidate.getTime();
  }
  if (spec.recurrence === "weekly") {
    const want = spec.daySpec ?? from.getDay();
    let delta = (want - candidate.getDay() + 7) % 7;
    if (delta === 0 && candidate.getTime() <= from.getTime()) delta = 7;
    candidate.setDate(candidate.getDate() + delta);
    return candidate.getTime();
  }
  // monthly
  const wantDay = spec.daySpec ?? from.getDate();
  candidate.setDate(wantDay);
  if (candidate.getTime() <= from.getTime()) candidate.setMonth(candidate.getMonth() + 1);
  return candidate.getTime();
}

/** After a task fires, compute its next occurrence (or null if once). */
export function advanceTask(task: ScheduledTask, from = Date.now()): number | null {
  if (task.recurrence === "once") return null;
  return computeNextFire({
    timeOfDay: task.timeOfDay,
    recurrence: task.recurrence,
    daySpec: task.daySpec,
    // nudge past the current fire time so we don't re-fire immediately
    from: from + 1000,
  });
}

async function loadNotifications(): Promise<{
  requestPermissionsAsync(): Promise<{ status: string }>;
  scheduleNotificationAsync(request: {
    content: { title: string; body: string };
    trigger: unknown;
  }): Promise<string>;
  cancelScheduledNotificationAsync(id: string): Promise<void>;
} | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const req = (typeof require !== "undefined" ? require : null) as
      | ((id: string) => unknown)
      | null;
    if (!req) return null;
    return req("expo-notifications") as {
      requestPermissionsAsync(): Promise<{ status: string }>;
      scheduleNotificationAsync(request: {
        content: { title: string; body: string };
        trigger: unknown;
      }): Promise<string>;
      cancelScheduledNotificationAsync(id: string): Promise<void>;
    };
  } catch {
    return null;
  }
}

type Listener = () => void;

function createScheduledTaskStore() {
  let tasks: ScheduledTask[] = [];
  const listeners = new Set<Listener>();

  function emit() {
    for (const l of listeners) l();
  }

  async function persist(): Promise<void> {
    try {
      await AsyncStorage.setItem(STORE_KEY, JSON.stringify(tasks));
    } catch {
      /* non-fatal */
    }
    emit();
  }

  async function load(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(STORE_KEY);
      tasks = raw ? (JSON.parse(raw) as ScheduledTask[]) : [];
    } catch {
      tasks = [];
    }
    emit();
  }

  async function scheduleNotification(task: ScheduledTask): Promise<string[]> {
    const ids: string[] = [];
    try {
      const N = await loadNotifications();
      if (!N) return ids;
      const { status } = await N.requestPermissionsAsync();
      if (status !== "granted") return ids;
      const id = await N.scheduleNotificationAsync({
        content: { title: task.title, body: task.message },
        trigger: { date: new Date(task.nextFireAt) },
      });
      ids.push(id);
    } catch {
      /* notifications unavailable — task still listed, honest */
    }
    return ids;
  }

  async function cancelNotifications(task: ScheduledTask): Promise<void> {
    try {
      const N = await loadNotifications();
      if (!N) return;
      for (const id of task.notificationIds) {
        await N.cancelScheduledNotificationAsync(id);
      }
    } catch {
      /* best effort */
    }
  }

  async function add(spec: NewScheduledTask): Promise<ScheduledTask> {
    const task: ScheduledTask = {
      id: uid(),
      title: spec.title,
      message: spec.message,
      timeOfDay: spec.timeOfDay,
      recurrence: spec.recurrence,
      daySpec: spec.daySpec,
      nextFireAt: computeNextFire(spec),
      enabled: true,
      createdAt: Date.now(),
      notificationIds: [],
    };
    task.notificationIds = await scheduleNotification(task);
    tasks = [...tasks, task];
    await persist();
    return task;
  }

  async function remove(id: string): Promise<void> {
    const task = tasks.find((t) => t.id === id);
    if (task) await cancelNotifications(task);
    tasks = tasks.filter((t) => t.id !== id);
    await persist();
  }

  async function setEnabled(id: string, enabled: boolean): Promise<void> {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    if (enabled) {
      task.nextFireAt = computeNextFire({
        timeOfDay: task.timeOfDay,
        recurrence: task.recurrence,
        daySpec: task.daySpec,
      });
      task.notificationIds = await scheduleNotification(task);
    } else {
      await cancelNotifications(task);
      task.notificationIds = [];
    }
    task.enabled = enabled;
    await persist();
  }

  /**
   * Called when a notification fires (or on app start, to catch up).
   * Advances recurring tasks; removes one-shot tasks.
   */
  async function markFired(id: string): Promise<void> {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const next = advanceTask(task);
    if (next == null) {
      tasks = tasks.filter((t) => t.id !== id);
    } else {
      task.nextFireAt = next;
      task.notificationIds = await scheduleNotification(task);
    }
    await persist();
  }

  return {
    subscribe(l: Listener) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    getTasks(): ScheduledTask[] {
      return tasks;
    },
    load,
    add,
    remove,
    setEnabled,
    markFired,
    computeNextFire,
    /** Test hook. */
    __resetForTests() {
      tasks = [];
      emit();
    },
  };
}

export type ScheduledTaskStore = ReturnType<typeof createScheduledTaskStore>;
export const scheduledTaskStore = createScheduledTaskStore();
