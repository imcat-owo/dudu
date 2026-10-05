/**
 * Batch 7 I9 — haptics, honoring the user's prefs.
 *
 * Wraps expo-haptics with try/catch (a failed buzz must never break the
 * action it accompanies) and the extras prefs gates:
 * - hapticsEnabled: master switch
 * - hapticsOnSend: light tap when she sends a message
 * - hapticsOnReceive: success pulse when the AI finishes replying
 * Taps on toggles/list rows use hapticTap() (gated by the master switch).
 */

import * as Haptics from "expo-haptics";
import { getExtrasPrefs } from "./prefs";

async function safe(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch {
    // Haptics are decorative — never throw.
  }
}

/** Light tap on send. */
export function hapticSend(): void {
  const p = getExtrasPrefs();
  if (!p.hapticsEnabled || !p.hapticsOnSend) return;
  void safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** Success pulse when the AI's reply lands. */
export function hapticReceive(): void {
  const p = getExtrasPrefs();
  if (!p.hapticsEnabled || !p.hapticsOnReceive) return;
  void safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** Selection tick for toggles / list taps / sheet opens. */
export function hapticTap(): void {
  if (!getExtrasPrefs().hapticsEnabled) return;
  void safe(() => Haptics.selectionAsync());
}

/** Gentle error buzz (e.g. send failed). */
export function hapticError(): void {
  if (!getExtrasPrefs().hapticsEnabled) return;
  void safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}
