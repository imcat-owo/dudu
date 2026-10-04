/**
 * Dual-mode setting: which chat transport the app uses.
 *
 * - "local" (DEFAULT): pure client-side. Chat goes phone → the user's own
 *   configured API group directly (OpenAI-compatible), data stays on
 *   device. No backend needed, no login.
 * - "cloud": Dudu's cloud mode — chat routed through our backend
 *   (currently not deployed; the switch is disabled until it is).
 *
 * The user controls both and switches anytime from Settings. Stored in
 * AsyncStorage (not a secret). Follows apps/mobile/src/app-settings.ts.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useSyncExternalStore } from "react";

export type ChatMode = "local" | "cloud";

export const DEFAULT_CHAT_MODE: ChatMode = "local";

/**
 * user P2-5 / product P2: the cloud backend is not deployed. Offering a
 * live switch to a dead end is a forbidden dead switch — the UI disables
 * it and the setter refuses it until this flips true (backend deployed).
 */
export const CLOUD_MODE_AVAILABLE = false;

const STORAGE_KEY = "dudu.settings.chatMode.v1";

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
      // A "cloud" value persisted from an older build must not resurrect a
      // dead chat path — fall back to local while the backend is undeployed.
      const safe = raw === "cloud" && !CLOUD_MODE_AVAILABLE ? "local" : raw;
      if (isChatMode(safe) && safe !== current) {
        current = safe;
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
    // Fail-closed: "cloud" is not a real destination while the backend is
    // undeployed. Refuse instead of breaking her chat.
    if (mode === "cloud" && !CLOUD_MODE_AVAILABLE) return;
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
