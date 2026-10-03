/**
 * 原生应用授权 — AI tools. PURE module: no React Native / expo imports.
 *
 * The most obvious AI hookups for the wired native capabilities:
 * - calendar: read today's events, create events
 * - reminders: list reminders, create reminders
 * - contacts: search contacts by name
 * - healthkit: read today's step count
 *
 * Every tool checks the iOS authorization state FIRST via the hooks —
 * the RN layer owns the native bridges, this pure module must not import them.
 * If not authorized, the tool says so honestly and points at Settings →
 * 原生应用授权 instead of faking data.
 *
 * Tool naming follows the existing local-tools convention (snake_case,
 * human-language descriptions written FOR the AI).
 */

import type { LocalTool } from "./api-groups/local-tools.js";

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
  ];
}
