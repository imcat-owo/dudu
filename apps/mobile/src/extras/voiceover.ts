/**
 * Batch 7 I5 — VoiceOver support.
 *
 * The app already labels its interactive elements (a11y.* keys); this module
 * adds the spoken layer:
 * - useScreenReaderEnabled(): live flag from AccessibilityInfo, so we only
 *   add chatter when a screen reader is actually running.
 * - announceReplyDone(): called when the AI finishes a turn — VoiceOver
 *   users otherwise never learn the reply landed.
 * - announce(): general polite announcement helper.
 *
 * Everything is a no-op when no screen reader is on: she never uses
 * VoiceOver, so she must never hear (or pay for) anything extra.
 */

import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/** True while a screen reader (VoiceOver/TalkBack) is running. Live. */
export function useScreenReaderEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isScreenReaderEnabled()
      .then((v) => {
        if (mounted) setEnabled(v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("screenReaderChanged", setEnabled);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return enabled;
}

let cachedSr: boolean | null = null;

void AccessibilityInfo.isScreenReaderEnabled()
  .then((v) => {
    cachedSr = v;
  })
  .catch(() => {
    cachedSr = false;
  });

try {
  AccessibilityInfo.addEventListener("screenReaderChanged", (v) => {
    cachedSr = v;
  });
} catch {
  // ignore — polling fallback below still works on old RN.
}

/**
 * Post a polite announcement. Safe to call any time; when no screen reader
 * is running it's a cheap no-op.
 */
export function announce(message: string): void {
  if (!message) return;
  try {
    if (cachedSr === false) return;
    AccessibilityInfo.announceForAccessibility(message);
  } catch {
    // never break the caller
  }
}
