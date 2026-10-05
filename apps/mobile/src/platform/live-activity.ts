/**
 * H6 — Live Activity (Dynamic Island / Lock Screen) controller (TS side).
 *
 * Shows AI task progress on the Lock Screen and Dynamic Island while a
 * long task runs — so she never stares at a spinner wondering.
 *
 * Native: ActivityKit via the `DuduLiveActivity` module
 * (see plugins/dudu-platform/liveactivity/). If unavailable, all calls
 * are safe no-ops.
 */

import { getNativeModule } from "./types";

export interface LiveActivityState {
  title: string;
  /** 0..1 */
  progress: number;
  stageText: string;
  /** Unix ms when the activity started. */
  startedAt: number;
}

async function loadModule(): Promise<{
  start(id: string, title: string, progress: number, stageText: string): Promise<boolean>;
  update(id: string, title?: string, progress?: number, stageText?: string): Promise<boolean>;
  end(id: string): Promise<boolean>;
  isActive(id: string): Promise<boolean>;
} | null> {
  return getNativeModule<{
    start(id: string, title: string, progress: number, stageText: string): Promise<boolean>;
    update(id: string, title?: string, progress?: number, stageText?: string): Promise<boolean>;
    end(id: string): Promise<boolean>;
    isActive(id: string): Promise<boolean>;
  }>("DuduLiveActivity");
}

/** Start a Live Activity for a long task. Returns false when unsupported. */
export async function startLiveActivity(id: string, state: LiveActivityState): Promise<boolean> {
  const mod = await loadModule();
  if (!mod) return false;
  try {
    return await mod.start(id, state.title, state.progress, state.stageText);
  } catch {
    return false;
  }
}

/** Update progress. Throttle callers to ~1/sec — ActivityKit rate-limits. */
export async function updateLiveActivity(
  id: string,
  state: Partial<LiveActivityState>,
): Promise<boolean> {
  const mod = await loadModule();
  if (!mod) return false;
  try {
    return await mod.update(id, state.title, state.progress, state.stageText);
  } catch {
    return false;
  }
}

/** End the activity (dismisses from Lock Screen / Island). */
export async function endLiveActivity(id: string): Promise<boolean> {
  const mod = await loadModule();
  if (!mod) return false;
  try {
    return await mod.end(id);
  } catch {
    return false;
  }
}

/** Whether a Live Activity is currently active for this id. */
export async function isLiveActivityActive(id: string): Promise<boolean> {
  const mod = await loadModule();
  if (!mod) return false;
  try {
    return await mod.isActive(id);
  } catch {
    return false;
  }
}
