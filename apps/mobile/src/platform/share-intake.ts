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
    await mod.remove(SHARED_KEYS.pendingShare);
    const parsed = JSON.parse(raw) as PendingShare;
    if (!Array.isArray(parsed.items)) return null;
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
