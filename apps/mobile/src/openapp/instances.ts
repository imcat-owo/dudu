/**
 * open_app （轻控制） — app singletons and production wiring.
 *
 * expo/react-native imports are lazy (dynamic import) so this module stays
 * importable in node tests.
 */

import { browserController } from "../browser/controller";
import { requestBrowserViewMount } from "../browser/mount";
import { createNotificationPort } from "../initiative/instances";
import type { NotificationPort } from "../outreach/notify";
import { personaStore } from "../persona/stores";
import { createOpenAppTools, type OpenAppToolEnv } from "./tools";
import { handleOpenAppTap, type OpenAppWatchDeps } from "./watchdog";

let notificationPortPromise: Promise<NotificationPort> | null = null;

function getNotificationPort(): Promise<NotificationPort> {
  if (!notificationPortPromise) notificationPortPromise = createNotificationPort();
  return notificationPortPromise;
}

/** Production env for the open_app tool. threadId = the dialog she's in. */
export function createProductionOpenAppTools(threadId: string) {
  const env: OpenAppToolEnv = {
    openExternalUrl: async (url: string) => {
      try {
        const { Linking } = await import("react-native");
        const can = await Linking.canOpenURL(url).catch(() => false);
        if (!can) return false;
        await Linking.openURL(url);
        return true;
      } catch {
        return false;
      }
    },
    openWebViewUrl: async (url: string) => {
      // Same path as the AI browser's browser_navigate: the controller holds
      // the URL, the mounted AIBrowserView drives the WebView. Crash-bisection
      // (2026-10-06): the view mounts lazily — request it and wait for the
      // controller instead of failing when it isn't there yet.
      requestBrowserViewMount();
      const start = Date.now();
      while (!browserController.isReady()) {
        if (Date.now() - start > 12000) {
          throw new Error("Browser view did not mount in time — the browser view failed to start.");
        }
        await new Promise((r) => setTimeout(r, 120));
      }
      browserController.setUrl(url);
      const r = await browserController.evaluate(
        `location.href='${url.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'; "navigating"`,
      );
      if (!r.ok) throw new Error(r.error || "Navigation failed.");
    },
    notifications: {
      getPermissionsAsync: async () => {
        const p = await getNotificationPort();
        return p.getPermissionsAsync();
      },
      cancelScheduledNotificationAsync: async (id: string) => {
        const p = await getNotificationPort();
        return p.cancelScheduledNotificationAsync(id);
      },
      scheduleNotificationAsync: async (req) => {
        const p = await getNotificationPort();
        return p.scheduleNotificationAsync(req);
      },
    },
    getActivePersonaId: async () => {
      try {
        return await personaStore.getActiveId();
      } catch {
        return null;
      }
    },
    getThreadId: () => threadId,
    nowMs: () => Date.now(),
  };
  return createOpenAppTools(env);
}

/**
 * Handle a watchdog notification tap (kind "openapp-watch").
 * Reuses the initiative production deps (storage, trace, visibility,
 * generateText, persona lookup) — same proven path, no duplication.
 * Never throws.
 */
export async function handleOpenAppWatchTap(data: unknown): Promise<void> {
  try {
    const { buildInitiativeDeps } = await import("../initiative/instances");
    const deps = (await buildInitiativeDeps()) as OpenAppWatchDeps;
    await handleOpenAppTap(deps, data);
  } catch {
    // Fail closed: the tap already routed her to chat; a missing greeting
    // is better than a crash.
  }
}
