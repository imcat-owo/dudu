/**
 * Batch 7 I1 — one-tap message translation.
 *
 * Aligned with Kelivo's TranslationService
 * (lib/features/home/services/translation_service.dart, researched
 * 2026-10-05): long-press a message → pick a language → the translation
 * streams in under the message, saved per message id, clearable.
 *
 * Differences: Kelivo stores the translation on the message row in its DB;
 * dudu's agent messages are owned by the agent/session store, so
 * translations live in this module's own persisted map (message id →
 * { text, lang }). The UI reads it via useTranslation(messageId).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { type ChatMessage, streamChat } from "../api-groups/direct-transport";
import type { ApiGroup } from "../api-groups/types";
import { setExtrasPref } from "./prefs";

/** Target languages, named in their own language (no i18n needed). */
export const TRANSLATE_LANGS: Array<{ code: string; label: string }> = [
  { code: "en", label: "English" },
  { code: "zh-Hans", label: "简体中文" },
  { code: "zh-Hant", label: "繁體中文" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
  { code: "ru", label: "Русский" },
  { code: "ar", label: "العربية" },
];

export function translateLangLabel(code: string): string {
  return TRANSLATE_LANGS.find((l) => l.code === code)?.label ?? code;
}

export interface SavedTranslation {
  text: string;
  lang: string;
  at: number;
}

interface TranslationState {
  saved: Record<string, SavedTranslation>;
  /** message id → target lang code while a translation is streaming. */
  running: Record<string, string>;
  /** message id → streamed-so-far text. */
  partial: Record<string, string>;
  /** message id → error message. */
  errors: Record<string, string>;
}

const STORE_KEY = "dudu.extras.translations.v1";
const MAX_SAVED = 200;

let state: TranslationState = { saved: {}, running: {}, partial: {}, errors: {} };
const listeners = new Set<() => void>();
let storeLoaded = false;

function emit() {
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot(): TranslationState {
  return state;
}

async function loadStore(): Promise<void> {
  if (storeLoaded) return;
  storeLoaded = true;
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, SavedTranslation>;
      state = { ...state, saved: parsed };
      emit();
    }
  } catch {
    // start empty
  }
}

void loadStore();

async function persist(): Promise<void> {
  try {
    const ids = Object.keys(state.saved).slice(-MAX_SAVED);
    const trimmed: Record<string, SavedTranslation> = {};
    for (const id of ids) {
      const entry = state.saved[id];
      if (entry) trimmed[id] = entry;
    }
    state.saved = trimmed;
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(trimmed));
  } catch {
    // non-fatal
  }
}

/** React binding for one message's translation UI. */
export function useTranslation(messageId: string): {
  saved?: SavedTranslation;
  runningLang?: string;
  partial?: string;
  error?: string;
} {
  const s = useSyncExternalStore(subscribe, getSnapshot);
  return {
    saved: s.saved[messageId],
    runningLang: s.running[messageId],
    partial: s.partial[messageId],
    error: s.errors[messageId],
  };
}

/** Drop a saved/streaming translation (Kelivo's "clear translation"). */
export function clearTranslation(messageId: string): void {
  const saved = { ...state.saved };
  const running = { ...state.running };
  const partial = { ...state.partial };
  const errors = { ...state.errors };
  delete saved[messageId];
  delete running[messageId];
  delete partial[messageId];
  delete errors[messageId];
  state = { saved, running, partial, errors };
  emit();
  void persist();
  runningTransfers.delete(messageId);
}

const runningTransfers = new Map<string, AbortController>();

/**
 * Translate `text` into `langCode` with the active API group.
 * Streams into the per-message state; resolves with the full text.
 * Returns null when there is no API group to translate with.
 */
export async function translateMessage(
  messageId: string,
  text: string,
  langCode: string,
  group: ApiGroup | null,
): Promise<string | null> {
  if (!text.trim()) return null;
  // Remember her choice for next time.
  void setExtrasPref("translateTargetLang", langCode);
  if (!group) {
    state = {
      ...state,
      errors: { ...state.errors, [messageId]: "no-group" },
    };
    emit();
    return null;
  }
  // Supersede any in-flight translation for this message (Kelivo's run token).
  runningTransfers.get(messageId)?.abort();
  const ctrl = new AbortController();
  runningTransfers.set(messageId, ctrl);

  state = {
    ...state,
    running: { ...state.running, [messageId]: langCode },
    partial: { ...state.partial, [messageId]: "" },
    errors: { ...state.errors },
  };
  delete state.errors[messageId];
  emit();

  const langName = translateLangLabel(langCode);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        `You are a translator. Translate the user's text into ${langName}. ` +
        `Output ONLY the translation — no explanations, no quotes, no preamble. ` +
        `Preserve markdown formatting and line breaks.`,
    },
    { role: "user", content: text },
  ];
  let out = "";
  try {
    await streamChat(
      group,
      messages,
      {
        signal: ctrl.signal,
        onToken: (delta) => {
          if (ctrl.signal.aborted) return;
          out += delta;
          state = { ...state, partial: { ...state.partial, [messageId]: out } };
          emit();
        },
        onDone: () => {},
        onError: (e) => {
          throw e;
        },
      },
      { maxTokens: 4000 },
    );
  } catch (e) {
    if (ctrl.signal.aborted) return null;
    state = {
      ...state,
      running: { ...state.running },
      errors: { ...state.errors, [messageId]: e instanceof Error ? e.message : String(e) },
    };
    delete state.running[messageId];
    emit();
    return null;
  } finally {
    if (runningTransfers.get(messageId) === ctrl) runningTransfers.delete(messageId);
  }
  const final = out.trim();
  const running = { ...state.running };
  const partial = { ...state.partial };
  delete running[messageId];
  delete partial[messageId];
  state = {
    ...state,
    running,
    partial,
    saved: { ...state.saved, [messageId]: { text: final, lang: langCode, at: Date.now() } },
  };
  emit();
  void persist();
  return final;
}

/**
 * Standalone one-shot translation (for the translate page). No message id.
 */
export async function translateText(
  text: string,
  langCode: string,
  group: ApiGroup | null,
  onToken: (partial: string) => void,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!text.trim() || !group) return null;
  const langName = translateLangLabel(langCode);
  let out = "";
  try {
    await streamChat(
      group,
      [
        {
          role: "system",
          content:
            `You are a translator. Translate the user's text into ${langName}. ` +
            `Output ONLY the translation — no explanations, no quotes, no preamble. ` +
            `Preserve markdown formatting and line breaks.`,
        },
        { role: "user", content: text },
      ],
      {
        signal,
        onToken: (delta) => {
          out += delta;
          onToken(out);
        },
        onDone: () => {},
        onError: (e) => {
          throw e;
        },
      },
      { maxTokens: 4000 },
    );
  } catch {
    return null;
  }
  return out.trim() || null;
}
