/**
 * H4 — Siri Shortcuts / App Intents bridge (TS side).
 *
 * The intents themselves are native (see plugins/dudu-platform/siri/).
 * This module handles what happens when the app is launched from an
 * intent: parse the deep link / user activity and route it.
 *
 * URL scheme: dudu://siri?action=ask&prompt=...&dialog=...
 *            dudu://siri?action=open&dialog=...
 */

export type SiriAction = "ask" | "open" | "new";

export interface SiriLaunch {
  action: SiriAction;
  prompt?: string;
  dialogId?: string;
}

/** Parse a dudu://siri deep link. Returns null if not a Siri link. */
export function parseSiriLink(url: string): SiriLaunch | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "dudu:" || u.host !== "siri") return null;
    const action = u.searchParams.get("action") as SiriAction | null;
    if (action !== "ask" && action !== "open" && action !== "new") return null;
    // URLSearchParams.get() already percent-decodes — do NOT decodeURIComponent
    // again (that corrupts prompts containing % and throws on stray %).
    const prompt = u.searchParams.get("prompt") ?? undefined;
    const dialogId = u.searchParams.get("dialog") ?? undefined;
    return { action, prompt, dialogId };
  } catch {
    return null;
  }
}

/** Build a Siri deep link (used by the native intents). */
export function buildSiriLink(launch: SiriLaunch): string {
  const params = new URLSearchParams();
  params.set("action", launch.action);
  // URLSearchParams.set() percent-encodes — do NOT encodeURIComponent first
  // (that double-encodes and breaks interop with single-encoded native URLs).
  if (launch.prompt) params.set("prompt", launch.prompt);
  if (launch.dialogId) params.set("dialog", launch.dialogId);
  return `dudu://siri?${params.toString()}`;
}

/**
 * The intents exposed to Siri/Shortcuts (must match the native AppIntent
 * definitions in plugins/dudu-platform/siri/).
 */
export const SIRI_INTENTS = [
  { id: "ask-dudu", titleKey: "platform.siri.intent.ask" },
  { id: "open-dialog", titleKey: "platform.siri.intent.open" },
  { id: "new-chat", titleKey: "platform.siri.intent.new" },
] as const;
