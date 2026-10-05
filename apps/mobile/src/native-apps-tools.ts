/**
 * 原生应用授权 — AI tools. PURE module: no React Native / expo imports.
 *
 * The most obvious AI hookups for the wired native capabilities:
 * - calendar: read today's events, create events
 * - reminders: list reminders, create reminders
 * - contacts: search contacts by name
 * - healthkit: read today's step count, read recent sleep sessions
 * - device-info: battery level / charging state / device model (permission-free)
 *
 * Every tool checks the iOS authorization state FIRST via the hooks —
 * the RN layer owns the native bridges, this pure module must not import them.
 * If not authorized, the tool says so honestly and points at Settings →
 * 原生应用授权 instead of faking data.
 *
 * Tool naming follows the existing local-tools convention (snake_case,
 * human-language descriptions written FOR the AI).
 */

import type { LocalTool } from "./api-groups/local-tools";
import type { DeviceInfo, SleepSession } from "./native-apps";

export interface NativeAppToolHooks {
  /** iOS auth state for a capability: granted / denied / undetermined / unavailable / needs-setup */
  getAuthState?: (id: string) => Promise<string>;
  /** List today's calendar events (RN layer implements via expo-calendar) */
  listTodayEvents?: () => Promise<Array<{ title: string; start: string; end: string; id: string }>>;
  /** Create a calendar event. start/end are ISO strings. Returns the event id. */
  createEvent?: (input: {
    title: string;
    start: string;
    end: string;
    notes?: string;
  }) => Promise<string>;
  /** List reminders (RN layer implements via expo-calendar) */
  listReminders?: () => Promise<
    Array<{ title: string; due: string | null; id: string; completed: boolean }>
  >;
  /** Create a reminder. dueDate is an ISO string or null. Returns the id. */
  createReminder?: (input: {
    title: string;
    dueDate?: string | null;
    notes?: string;
  }) => Promise<string>;
  /** Search contacts by name (RN layer implements via expo-contacts) */
  searchContacts?: (
    query: string,
  ) => Promise<Array<{ name: string; phone: string | null; id: string }>>;
  /** Today's step count (RN layer implements via react-native-health) */
  getTodaySteps?: () => Promise<number>;
  /** Recent sleep sessions (RN layer implements via react-native-health) */
  getSleepSessions?: () => Promise<SleepSession[]>;
  /** Battery + device info (RN layer implements via expo-battery/expo-device). No auth needed. */
  getBatteryStatus?: () => Promise<DeviceInfo>;
}

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

async function requireAuth(
  hooks: NativeAppToolHooks,
  id: string,
  humanName: string,
): Promise<void> {
  const state = (await hooks.getAuthState?.(id)) ?? "unavailable";
  if (state !== "granted") {
    throw new Error(
      `${humanName} 未授权（当前状态：${state}）。请让她去「设置 → 原生应用授权」里打开，我不能编数据。`,
    );
  }
}

const SH_TIME = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Shanghai",
});

function fmtDur(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}小时${m}分` : `${m}分`;
}

/** Human-readable summary of one sleep session. PURE — no native calls. Exported for tests. */
export function formatSleepSession(s: SleepSession): string {
  const bed = SH_TIME.format(new Date(s.bedTime));
  const wake = SH_TIME.format(new Date(s.wakeTime));
  const parts = [`上床 ${bed}，起床 ${wake}`];
  const totals: string[] = [];
  if (s.inBedMinutes > 0) totals.push(`在床上${fmtDur(s.inBedMinutes)}`);
  totals.push(`睡着${fmtDur(s.asleepMinutes)}`);
  parts.push(totals.join("，"));
  const stages: string[] = [];
  if (s.deepMinutes > 0) stages.push(`深睡${fmtDur(s.deepMinutes)}`);
  if (s.coreMinutes > 0) stages.push(`浅睡${fmtDur(s.coreMinutes)}`);
  if (s.remMinutes > 0) stages.push(`REM${fmtDur(s.remMinutes)}`);
  if (s.awakeMinutes > 0) stages.push(`清醒${fmtDur(s.awakeMinutes)}`);
  if (stages.length > 0) {
    parts.push(`分期：${stages.join("、")}`);
  } else if (s.asleepMinutes > 0) {
    parts.push("这台设备没给深睡/浅睡分期，只有总时长");
  }
  if (s.efficiency != null) {
    parts.push(`睡眠效率${Math.round(s.efficiency * 100)}%`);
  }
  return `昨晚睡眠：${parts.join("；")}。`;
}

/**
 * Build the native-app tool set.
 * Every tool REALLY works through the hooks — no placeholders.
 */
export function createNativeAppTools(hooks: NativeAppToolHooks = {}): LocalTool[] {
  return [
    {
      name: "napp_calendar_today",
      description:
        "Read today's calendar events (日历）. Use when she asks what's on today / whether she's free. Returns title + start/end times. Requires the Calendar authorization — if not granted, the tool tells you honestly instead of inventing events.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "native-apps",
      run: async () => {
        await requireAuth(hooks, "calendar", "日历");
        const events = (await hooks.listTodayEvents?.()) ?? [];
        if (events.length === 0) return "今天日历上没安排。";
        return events.map((e) => `- ${e.title}（${e.start} → ${e.end}）`).join("\n");
      },
    },
    {
      name: "napp_calendar_add",
      description:
        'Create a calendar event (日历）. Use when she says "记一下" / "约了…" with a time. title/start/end are required (ISO datetime strings, e.g. 2026-10-04T15:00:00). notes optional. Requires the Calendar authorization.',
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Event title (required)." },
          start: { type: "string", description: "Start time, ISO string (required)." },
          end: { type: "string", description: "End time, ISO string (required)." },
          notes: { type: "string", description: "Notes (optional)." },
        },
        required: ["title", "start", "end"],
        additionalProperties: false,
      },
      manualId: "native-apps",
      run: async (args: Record<string, unknown>) => {
        await requireAuth(hooks, "calendar", "日历");
        const id = await hooks.createEvent?.({
          title: strArg(args, "title"),
          start: strArg(args, "start"),
          end: strArg(args, "end"),
          notes: strArg(args, "notes") || undefined,
        });
        if (!id) throw new Error("创建日程失败。");
        return `记好了：「${strArg(args, "title")}」。`;
      },
    },
    {
      name: "napp_reminders_list",
      description:
        "List open reminders (提醒事项）. Use when she asks what she still needs to do. Requires the Reminders authorization.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "native-apps",
      run: async () => {
        await requireAuth(hooks, "reminders", "提醒事项");
        const items = (await hooks.listReminders?.()) ?? [];
        const open = items.filter((r) => !r.completed);
        if (open.length === 0) return "提醒事项里没欠着的事。";
        return open.map((r) => `- ${r.title}${r.due ? `（${r.due}）` : ""}`).join("\n");
      },
    },
    {
      name: "napp_reminder_add",
      description:
        'Create a reminder (提醒事项）. Use when she says "提醒我…" / "别忘了…". title required; dueDate is an ISO datetime string or omitted for no due date. Requires the Reminders authorization.',
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Reminder title (required)." },
          dueDate: { type: "string", description: "Due date/time, ISO string (optional)." },
          notes: { type: "string", description: "Notes (optional)." },
        },
        required: ["title"],
        additionalProperties: false,
      },
      manualId: "native-apps",
      run: async (args: Record<string, unknown>) => {
        await requireAuth(hooks, "reminders", "提醒事项");
        const due = strArg(args, "dueDate") || null;
        const id = await hooks.createReminder?.({
          title: strArg(args, "title"),
          dueDate: due,
          notes: strArg(args, "notes") || undefined,
        });
        if (!id) throw new Error("创建提醒失败。");
        return `记下了，到时候提醒你：「${strArg(args, "title")}」。`;
      },
    },
    {
      name: "napp_contacts_search",
      description:
        "Search her contacts by name (通讯录）. Use when she mentions someone and you need to know who that is. Returns name + phone. Requires the Contacts authorization — never guess contact info.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Name to search for (required)." },
        },
        required: ["query"],
        additionalProperties: false,
      },
      manualId: "native-apps",
      run: async (args: Record<string, unknown>) => {
        await requireAuth(hooks, "contacts", "通讯录");
        const q = strArg(args, "query");
        if (!q) throw new Error("要搜的名字不能为空。");
        const hits = (await hooks.searchContacts?.(q)) ?? [];
        if (hits.length === 0) return `通讯录里没找到「${q}」。`;
        return hits.map((c) => `- ${c.name}${c.phone ? `：${c.phone}` : ""}`).join("\n");
      },
    },
    {
      name: "napp_health_steps",
      description:
        "Read today's step count (健康）. Use when she asks about her activity, or when you want a small honest check-in. Requires the Health authorization — if not granted, say so instead of inventing a number.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "native-apps",
      run: async () => {
        await requireAuth(hooks, "healthkit", "健康");
        const steps = await hooks.getTodaySteps?.();
        if (steps == null) throw new Error("步数现在读不到。");
        return `今天走了 ${steps} 步。`;
      },
    },
    {
      name: "napp_health_sleep",
      description:
        "Read her recent sleep from HealthKit (睡眠）. Returns the most recent night: bed time, wake time, time asleep, sleep stages (deep / core / REM) and sleep efficiency — all from real HealthKit samples. Requires the Health authorization — if not granted, say so instead of inventing data. You're her partner, not her doctor: report, don't diagnose.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "native-apps",
      run: async () => {
        await requireAuth(hooks, "healthkit", "健康");
        const sessions = await hooks.getSleepSessions?.();
        if (sessions == null) throw new Error("睡眠数据现在读不到。");
        if (sessions.length === 0) {
          return "最近36小时里 HealthKit 没有睡眠记录。可能是她没戴表睡，或者手表/手机没记上 — 我不能编一个。";
        }
        return formatSleepSession(sessions[sessions.length - 1]);
      },
    },
    {
      name: "napp_battery_status",
      description:
        "Read the phone's battery level, charging state, and device info (电量）. Permission-free — no authorization needed, always available when the app runs on a real device. Use when she asks about battery, or when you want to warn her the phone is low before something heavy (e.g. a long voice call). Never invent numbers — report what the hook returns.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "native-apps",
      run: async () => {
        const info = await hooks.getBatteryStatus?.();
        if (!info) throw new Error("电量信息现在读不到。");
        const parts: string[] = [];
        if (info.batteryLevel != null) {
          parts.push(`电量 ${info.batteryLevel}%`);
        }
        const stateText =
          info.batteryState === "charging"
            ? "正在充电"
            : info.batteryState === "full"
              ? "已充满"
              : info.batteryState === "unplugged"
                ? "没在充电"
                : null;
        if (stateText) parts.push(stateText);
        if (info.lowPowerMode) parts.push("省电模式开着");
        const device = [info.modelName, info.osName, info.osVersion ? `${info.osVersion}` : null]
          .filter(Boolean)
          .join(" · ");
        if (device) parts.push(device);
        if (parts.length === 0) return "电量信息读到了，但是空的。";
        return `${parts.join("，")}。`;
      },
    },
  ];
}
