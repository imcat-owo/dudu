/**
 * Batch 7 (小功能 I) — chat-comfort preferences.
 *
 * One persisted store for the small chat/display toggles, aligned with
 * Kelivo's display settings (researched from Chevey339/kelivo
 * lib/core/providers/settings_provider.dart, 2026-10-05):
 * - enter-to-send on mobile (Kelivo defaults to true on iOS)
 * - keep screen on during generation (wakelock)
 * - haptics (global + per-event)
 * - new-chat behavior: on launch / on persona switch / after delete
 *   (Kelivo defaults: true / false / false)
 * - message display: model name / timestamp / avatars
 * - auto-scroll + idle-resume seconds (Kelivo default 8s)
 * - collapse long user messages (Kelivo default 500 chars, off by default)
 * - markdown rendering per role: user / assistant / reasoning
 *   (Kelivo: display_enable_user_markdown / _assistant / _reasoning)
 * - draft token counter in the composer (Kelivo's DraftTokenCounter)
 * - last used translation target language
 *
 * Module-level store (useSyncExternalStore) like app-settings.ts so every
 * consumer re-renders live. NOT part of the theme bundle.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

export interface ExtrasPrefs {
  /** I7: mobile return key sends the message instead of a newline. */
  enterToSendMobile: boolean;
  /** I8: keep the screen awake while the AI is generating. */
  keepScreenOnWhileGenerating: boolean;
  /** I9: master haptics switch. */
  hapticsEnabled: boolean;
  /** I9: light tap when a message is sent. */
  hapticsOnSend: boolean;
  /** I9: success pulse when the AI finishes replying. */
  hapticsOnReceive: boolean;
  /** I10: start a fresh dialog on every app launch. */
  newChatOnLaunch: boolean;
  /** I10: start a fresh dialog when the persona is switched. */
  newChatOnPersonaSwitch: boolean;
  /** I10: start a fresh dialog after the current dialog is deleted. */
  newChatAfterDelete: boolean;
  /** I11: show the model name under assistant messages. */
  showModelName: boolean;
  /** I11: show the receive time under messages. */
  showTimestamp: boolean;
  /** I11: show avatars beside bubbles. */
  showAvatars: boolean;
  /** I12: follow new output while streaming. */
  autoScroll: boolean;
  /** I12: seconds of scroll-idle before auto-scroll resumes (Kelivo: 8). */
  autoScrollIdleSeconds: number;
  /** I13: fold long user messages behind an expand row. */
  collapseLongUserMessages: boolean;
  /** I13: char threshold for folding (Kelivo default 500). */
  collapseThresholdChars: number;
  /** I14: render markdown in user messages. */
  markdownUser: boolean;
  /** I14: render markdown in assistant messages. */
  markdownAssistant: boolean;
  /** I14: render markdown in reasoning/thinking text. */
  markdownReasoning: boolean;
  /** I6: show the live token estimate under the composer. */
  draftTokenCount: boolean;
  /** I1: last translation target language code. */
  translateTargetLang: string;
}

function defaultEnterToSendMobile(): boolean {
  try {
    // Guarded require: plain node test runners cannot transform
    // react-native; on device this loads normally (same pattern as
    // i18n/index.ts).
    const { Platform } = require("react-native") as {
      Platform: { OS: string };
    };
    return Platform.OS === "ios";
  } catch {
    // Unknown platform — this app is iOS-first.
    return true;
  }
}

export const DEFAULT_EXTRAS_PREFS: ExtrasPrefs = {
  enterToSendMobile: defaultEnterToSendMobile(),
  keepScreenOnWhileGenerating: true,
  hapticsEnabled: true,
  hapticsOnSend: true,
  hapticsOnReceive: true,
  newChatOnLaunch: true,
  newChatOnPersonaSwitch: false,
  newChatAfterDelete: true,
  showModelName: true,
  showTimestamp: true,
  showAvatars: true,
  autoScroll: true,
  autoScrollIdleSeconds: 8,
  collapseLongUserMessages: false,
  collapseThresholdChars: 500,
  markdownUser: true,
  markdownAssistant: true,
  markdownReasoning: true,
  draftTokenCount: true,
  translateTargetLang: "en",
};

const STORAGE_KEY = "dudu.extras.prefs.v1";

function sanitize(raw: unknown): ExtrasPrefs {
  const base = { ...DEFAULT_EXTRAS_PREFS };
  if (typeof raw !== "object" || raw === null) return base;
  const r = raw as Record<string, unknown>;
  const out = { ...base };
  for (const key of Object.keys(base) as (keyof ExtrasPrefs)[]) {
    const v = r[key];
    if (typeof base[key] === "boolean" && typeof v === "boolean") {
      (out[key] as boolean) = v;
    } else if (typeof base[key] === "number" && typeof v === "number" && Number.isFinite(v)) {
      (out[key] as number) = v;
    } else if (typeof base[key] === "string" && typeof v === "string") {
      (out[key] as string) = v;
    }
  }
  // Clamp the numeric ranges to sane bounds (Kelivo: 50–100000 chars, idle seconds ≥ 1).
  out.autoScrollIdleSeconds = Math.min(120, Math.max(1, Math.round(out.autoScrollIdleSeconds)));
  out.collapseThresholdChars = Math.min(
    100000,
    Math.max(50, Math.round(out.collapseThresholdChars)),
  );
  if (!out.translateTargetLang) out.translateTargetLang = "en";
  return out;
}

let current: ExtrasPrefs = { ...DEFAULT_EXTRAS_PREFS };
let loaded = false;
let generation = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

async function loadOnce(): Promise<void> {
  const seen = generation;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (seen !== generation) return;
    if (raw) {
      const next = sanitize(JSON.parse(raw));
      current = next;
      emit();
    }
  } catch {
    // keep defaults
  }
}

if (!loaded) {
  loaded = true;
  void loadOnce();
}

/** Resolves when the persisted prefs have been read (for launch behavior). */
export function extrasPrefsReady(): Promise<ExtrasPrefs> {
  return loadOnce().then(() => current);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ExtrasPrefs {
  return current;
}

export function useExtrasPrefs(): {
  prefs: ExtrasPrefs;
  setPref: typeof setExtrasPref;
} {
  const prefs = useSyncExternalStore(subscribe, getSnapshot);
  return { prefs, setPref: setExtrasPref };
}

/** Sync read of the current prefs (safe from non-React code). */
export function getExtrasPrefs(): ExtrasPrefs {
  return current;
}

export async function setExtrasPref<K extends keyof ExtrasPrefs>(
  key: K,
  value: ExtrasPrefs[K],
): Promise<void> {
  if (current[key] !== value) {
    generation += 1;
    current = { ...current, [key]: value };
    emit();
  }
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Non-fatal: preference stays in memory for this session.
  }
}

/**
 * Re-read prefs from storage (e.g. after backup restore).
 */
export async function refreshExtrasPrefs(): Promise<void> {
  generation += 1;
  await loadOnce();
}

// ---------------------------------------------------------------------------
// I10: cross-component "start a new chat" signal.
// local-app.tsx subscribes and swaps the thread id; dialog-ui.tsx (delete,
// persona switch) fires it when the matching pref is on. Decoupled so the
// settings UI and the dialogs sheet don't need to know about ChatScreen.
// ---------------------------------------------------------------------------

let newChatSeq = 0;
const newChatListeners = new Set<(seq: number) => void>();

export function requestNewChat(): void {
  newChatSeq += 1;
  for (const l of newChatListeners) l(newChatSeq);
}

export function subscribeNewChat(listener: (seq: number) => void): () => void {
  newChatListeners.add(listener);
  return () => {
    newChatListeners.delete(listener);
  };
}

export function getNewChatSeq(): number {
  return newChatSeq;
}
