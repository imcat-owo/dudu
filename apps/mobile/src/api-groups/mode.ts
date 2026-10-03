/**
 * Dual-mode setting: which chat transport the app uses.
 *
 * - "local" (DEFAULT): pure client-side. Chat goes phone → the user's own
 *   configured API group directly (OpenAI-compatible), data stays on
 *   device. No backend needed, no login.
 * - "cloud": the original path — CopilotKit through the OpenMuse backend
 *   (needs a session token; backend currently not deployed).
 *
 * The user controls both and switches anytime from Settings. Stored in
 * AsyncStorage (not a secret). Follows apps/mobile/src/app-settings.ts.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useSyncExternalStore } from "react";

export type ChatMode = "local" | "cloud";

export const DEFAULT_CHAT_MODE: ChatMode = "local";

const STORAGE_KEY = "openmuse.settings.chatMode.v1";

function isChatMode(raw: string | null): raw is ChatMode {
  return raw === "local" || raw === "cloud";
}

let current: ChatMode = DEFAULT_CHAT_MODE;
let loaded = false;
const listeners = new Set<() => void>();
let generation = 0;

function emit() {
  for (const l of listeners) l();
}

if (!loaded) {
  loaded = true;
  const seen = generation;
  AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      if (seen !== generation) return;
      if (isChatMode(raw) && raw !== current) {
        current = raw;
        emit();
      }
    })
    .catch(() => {});
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ChatMode {
  return current;
}

export function useChatMode(): ChatMode {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useSetChatMode(): (mode: ChatMode) => Promise<void> {
  return useCallback(async (mode: ChatMode) => {
    generation += 1;
    current = mode;
    emit();
    try {
      await AsyncStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Non-fatal: the in-memory value drives this session.
    }
  }, []);
}

/**
 * Re-read chat mode from storage (e.g. after backup restore).
 * Bumps the generation so a stale in-flight load can't clobber it.
 */
export async function refreshChatMode(): Promise<void> {
  const seen = ++generation;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (seen !== generation) return;
    const next = isChatMode(raw) ? raw : DEFAULT_CHAT_MODE;
    if (next !== current) {
      current = next;
      emit();
    }
  } catch {
    // Non-fatal: keep the in-memory value.
  }
}
