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
  return getNativeModule<{
    getString(key: string): Promise<string | null>;
    remove(key: string): Promise<void>;
    getSharedFilePath(name: string): Promise<string | null>;
  }>("DuduSharedData");
}

/** Read and clear the pending share. Returns null when nothing is waiting. */
export async function takePendingShare(): Promise<PendingShare | null> {
  const mod = await loadSharedModule();
  if (!mod) return null;
  try {
    const raw = await mod.getString(SHARED_KEYS.pendingShare);
    if (!raw) return null;
    // Parse BEFORE removing: a corrupt payload stays queued for the next
    // attempt instead of being silently destroyed.
    const parsed = JSON.parse(raw) as PendingShare;
    if (!Array.isArray(parsed.items)) return null;
    await mod.remove(SHARED_KEYS.pendingShare);
    return parsed;
  } catch {
    return null;
  }
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

export const __sharedForTests = { APP_GROUP_ID, SHARED_KEYS };

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
