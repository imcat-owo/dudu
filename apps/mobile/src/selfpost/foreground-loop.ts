/**
 * AI self-post trigger （自发帖触发器） — foreground loop wiring.
 * Kept separate from scheduler.ts (which stays node-testable): this file
 * imports react-native's AppState.
 */

import { AppState } from "react-native";
import { checkDueSelfpostSlots, SELFPOST_TICK_MS, type SelfpostSchedulerDeps } from "./scheduler";

/**
 * Start the foreground loop. Call once at app start. Returns a stop
 * function. The tick runs on cold start, on every foreground event, and
 * every 60s while foregrounded. Never throws; never blocks startup.
 */
export function startSelfpostForegroundLoop(
  getDeps: () => Promise<SelfpostSchedulerDeps>,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = () => {
    if (stopped) return;
    void getDeps()
      .then((deps) => checkDueSelfpostSlots(deps))
      .catch(() => {});
  };

  const onChange = (state: string) => {
    if (stopped) return;
    if (state === "active") tick();
  };

  let sub: { remove(): void } | null = null;
  try {
    sub = AppState.addEventListener("change", onChange);
  } catch {
    sub = null;
  }
  try {
    timer = setInterval(tick, SELFPOST_TICK_MS);
    if (typeof (timer as unknown as { unref?: unknown }).unref === "function") {
      (timer as unknown as { unref(): void }).unref();
    }
  } catch {
    timer = null;
  }
  // Cold start: run one check (covers "app was backgrounded at slot time").
  tick();

  return () => {
    stopped = true;
    try {
      sub?.remove();
    } catch {
      // ignore
    }
    if (timer) clearInterval(timer);
  };
}
