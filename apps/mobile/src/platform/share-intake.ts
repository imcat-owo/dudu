/**
 * H2 — Share Extension intake (TS side).
 *
 * The native Share Extension (see plugins/dudu-platform/share/) saves shared
 * items into the App Group shared defaults + shared file directory, then
 * deep-links into the app. This module reads the pending share on launch
 * and turns it into something the chat can consume.
 *
 * We can't read the App Group directly from JS — the native module
 * `DuduSharedData` (see plugins/) exposes it. If unavailable, intake
 * is a no-op (honest, not faked).
 */

import { APP_GROUP_ID, getNativeModule, SHARED_KEYS } from "./types";

export type SharedItemKind = "text" | "url" | "image" | "file";

export interface SharedItem {
  kind: SharedItemKind;
  /** Text content or URL string. */
  value: string;
  /** For image/file: path in the shared container. */
  filePath?: string;
  fileName?: string;
  mimeType?: string;
}

export interface PendingShare {
  items: SharedItem[];
  sourceApp?: string;
  receivedAt: number;
}

async function loadSharedModule(): Promise<{
  getString(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
  getSharedFilePath(name: string): Promise<string | null>;
} | null> {
  if (sharedModuleForTests !== undefined) return sharedModuleForTests;
  return getNativeModule<{
    getString(key: string): Promise<string | null>;
    remove(key: string): Promise<void>;
    getSharedFilePath(name: string): Promise<string | null>;
  }>("DuduSharedData");
}

/**
 * Poison-pill guard: a payload that parses as JSON but has the wrong shape
 * (or isn't JSON at all) would otherwise be retried on every cold start /
 * foreground forever. Count consecutive parse/shape failures in module
 * memory; after POISON_DROP_AFTER_FAILURES of them, drop the payload and
 * log one line. The counter resets on any successful take.
 */
const POISON_DROP_AFTER_FAILURES = 3;
let consecutiveParseFailures = 0;

/** Test seam: undefined = resolve the real native module. */
let sharedModuleForTests:
  | {
      getString(key: string): Promise<string | null>;
      remove(key: string): Promise<void>;
      getSharedFilePath(name: string): Promise<string | null>;
    }
  | null
  | undefined;

/** Read and clear the pending share. Returns null when nothing is waiting. */
export async function takePendingShare(): Promise<PendingShare | null> {
  const mod = await loadSharedModule();
  if (!mod) return null;
  let raw: string | null;
  try {
    raw = await mod.getString(SHARED_KEYS.pendingShare);
  } catch {
    return null;
  }
  if (!raw) return null;
  // Parse BEFORE removing: a corrupt payload stays queued for the next
  // attempt instead of being silently destroyed — but only up to
  // POISON_DROP_AFTER_FAILURES consecutive failures, after which the
  // poisoned payload is dropped so we don't retry it forever.
  let parsed: PendingShare;
  try {
    parsed = JSON.parse(raw) as PendingShare;
    if (!Array.isArray(parsed.items)) {
      throw new Error("pending share payload has no items array");
    }
  } catch {
    consecutiveParseFailures += 1;
    if (consecutiveParseFailures >= POISON_DROP_AFTER_FAILURES) {
      consecutiveParseFailures = 0;
      console.warn(
        `[share-intake] dropping poisoned share payload after ${POISON_DROP_AFTER_FAILURES} failed parses`,
      );
      try {
        await mod.remove(SHARED_KEYS.pendingShare);
      } catch {
        // best-effort: the key may already be gone
      }
    }
    return null;
  }
  consecutiveParseFailures = 0;
  try {
    await mod.remove(SHARED_KEYS.pendingShare);
  } catch {
    return null;
  }
  return parsed;
}

/**
 * Turn a pending share into a chat-ready prompt.
 * Text/URL become message text; images/files are noted for attachment.
 */
export function shareToPrompt(share: PendingShare): { text: string; attachments: SharedItem[] } {
  const texts: string[] = [];
  const attachments: SharedItem[] = [];
  for (const item of share.items) {
    if (item.kind === "text" || item.kind === "url") {
      texts.push(item.value);
    } else {
      attachments.push(item);
    }
  }
  return { text: texts.join("\n\n"), attachments };
}

export const __sharedForTests = {
  APP_GROUP_ID,
  SHARED_KEYS,
  POISON_DROP_AFTER_FAILURES,
  /** Inject a fake native module (null = force "no module"). */
  __setModule(
    mod: {
      getString(key: string): Promise<string | null>;
      remove(key: string): Promise<void>;
      getSharedFilePath(name: string): Promise<string | null>;
    } | null,
  ) {
    sharedModuleForTests = mod;
  },
  /** Back to resolving the real native module. */
  __resetModule() {
    sharedModuleForTests = undefined;
  },
  /** Reset the poison-pill failure counter. */
  __resetPoisonGuard() {
    consecutiveParseFailures = 0;
  },
};

/**
 * Pure routing step: turn a drained share into an `ask()` call that drops
 * the content into the chat prompt. Returns true when something was routed.
 * Kept separate from the native read so it is unit-testable without modules.
 */
export function routePendingShare(
  pending: PendingShare | null,
  ask: (text: string) => void,
): boolean {
  if (!pending) return false;
  const { text, attachments } = shareToPrompt(pending);
  const extra =
    attachments.length > 0
      ? `\n\n[${attachments.length} attachment(s) saved to the shared container]`
      : "";
  if (!text && attachments.length === 0) return false;
  ask(text + extra);
  return true;
}

/**
 * Drain the App Group pending-share queue once and route it to `ask`.
 * Single source of truth for BOTH the cloud shell (App.tsx) and the local
 * shell (local-app.tsx) — do not duplicate this logic per mode.
 * Best-effort: never throws, returns true when something was routed.
 */
export async function consumePendingShare(ask: (text: string) => void): Promise<boolean> {
  try {
    return routePendingShare(await takePendingShare(), ask);
  } catch {
    return false;
  }
}
