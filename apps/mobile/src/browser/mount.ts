/**
 * Browser view mount gate — crash-diagnostic bisection (2026-10-06).
 *
 * Her 2026-10-05 IPA crashed deterministically right after the splash on
 * every launch. The #1 suspect is the always-mounted hidden AIBrowserView
 * (react-native-webview + react-native-view-shot mounted at full window size
 * off-screen in local-app.tsx root). This module gates that mount:
 *
 * - At startup the WebView is NOT mounted (bisection: if the new build
 *   launches, the WebView was the killer).
 * - The first AI browser tool call (or her opening the browser tab) calls
 *   requestBrowserViewMount(); LocalApp's LazyBrowserHost subscribes and
 *   mounts the hidden view on demand. Tools wait for the controller to be
 *   ready instead of throwing "Browser is not ready".
 *
 * PURE: no React Native imports. The React side subscribes via
 * onBrowserViewMountChange.
 */

type MountListener = (mounted: boolean) => void;

let mounted = false;
const listeners = new Set<MountListener>();

/** Has anyone requested the browser view yet? */
export function isBrowserViewMounted(): boolean {
  return mounted;
}

/**
 * Request the hidden browser view. Idempotent — safe to call from every
 * tool run. LocalApp's LazyBrowserHost subscribes and mounts on change.
 */
export function requestBrowserViewMount(): void {
  if (mounted) return;
  mounted = true;
  for (const l of [...listeners]) {
    try {
      l(true);
    } catch {
      // A listener must never break the mount request.
    }
  }
}

/** Subscribe to mount changes. Returns an unsubscribe function. */
export function onBrowserViewMountChange(listener: MountListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only reset. Never call in production code. */
export function __resetBrowserViewMount(): void {
  mounted = false;
  listeners.clear();
}
