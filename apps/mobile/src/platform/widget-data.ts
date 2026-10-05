/**
 * H5 — Home screen Widget data (TS side).
 *
 * Aligns with the existing task-card plan (src/our-space/task-cards-ui.tsx):
 * the TS side writes a compact snapshot into the App Group shared defaults;
 * the native WidgetKit widget (see plugins/dudu-platform/widget/) reads it
 * and renders the home-screen widget. No fake widget — if the native
 * extension isn't wired, this is a documented no-op.
 */

import { SHARED_KEYS, getNativeModule } from "./types";

export interface WidgetTaskSnapshot {
  id: string;
  title: string;
  /** 0..1 */
  progress: number;
  status: "running" | "done" | "stuck";
  stageText?: string;
}

export interface WidgetData {
  updatedAt: number;
  tasks: WidgetTaskSnapshot[];
  /** Unread / pending nudges count for the badge-ish line. */
  pendingCount: number;
}

async function loadSharedModule(): Promise<{
  setString(key: string, value: string): Promise<void>;
} | null> {
  return getNativeModule<{
    setString(key: string, value: string): Promise<void>;
  }>("DuduSharedData");
}

/** Push the current widget snapshot to the App Group. Best-effort. */
export async function pushWidgetData(data: WidgetData): Promise<boolean> {
  const mod = await loadSharedModule();
  if (!mod) return false;
  try {
    await mod.setString(SHARED_KEYS.widgetData, JSON.stringify({ ...data, updatedAt: Date.now() }));
    // Ask WidgetKit to reload timelines.
    const widget = getNativeModule<{ reloadTimelines(): Promise<void> }>("DuduWidget");
    try {
      await widget?.reloadTimelines();
    } catch {
      /* widget module optional */
    }
    return true;
  } catch {
    return false;
  }
}

/** Build a snapshot from the task-progress store shape. */
export function buildWidgetData(
  tasks: Array<{ id: string; title: string; progress: number; status: string; stageText?: string }>,
  pendingCount: number,
): WidgetData {
  return {
    updatedAt: Date.now(),
    tasks: tasks.slice(0, 5).map((t) => ({
      id: t.id,
      title: t.title,
      progress: Math.max(0, Math.min(1, t.progress)),
      status: t.status === "done" ? "done" : t.status === "stuck" ? "stuck" : "running",
      stageText: t.stageText,
    })),
    pendingCount,
  };
}
