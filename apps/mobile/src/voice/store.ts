/**
 * Voice settings persistence.
 *
 * Secrets (custom TTS/STT keys) live in expo-secure-store — NEVER in
 * AsyncStorage, NEVER in the repo. Everything else (provider choice,
 * voice ids, URLs, models, mic mode) is non-secret and lives in
 * AsyncStorage.
 *
 * Follows the apps/mobile/src/api-groups/store.ts pattern: lazy
 * SecureStore import (stays importable in plain node tests), guarded
 * fallbacks, and an injectable backend for tests.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import {
  blankSttConfig,
  blankTtsConfig,
  defaultVoiceSettings,
  type SttConfig,
  type TtsConfig,
  type VoiceSettings,
} from "./types";

const TTS_KEY = "openmuse.tts.v1";
const STT_KEY = "openmuse.stt.v1";
const VOICE_SETTINGS_KEY = "openmuse.voice-settings.v1";

export interface SecureBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

async function loadSecureBackend(): Promise<SecureBackend> {
  const SecureStore = await import("expo-secure-store");
  return {
    getItem: (key) => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value),
    deleteItem: (key) => SecureStore.deleteItemAsync(key),
  };
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null) return { ...fallback, ...parsed };
  } catch {
    // corrupted — fall back
  }
  return fallback;
}

export function createVoiceStore(secure?: SecureBackend) {
  let resolvedSecure: SecureBackend | null = secure ?? null;
  let tts: TtsConfig | null = null;
  let stt: SttConfig | null = null;
  let settings: VoiceSettings | null = null;
  const listeners = new Set<() => void>();

  function emit() {
    for (const l of listeners) l();
  }

  async function secureBackend(): Promise<SecureBackend> {
    if (!resolvedSecure) resolvedSecure = await loadSecureBackend();
    return resolvedSecure;
  }

  let loadPromise: Promise<void> | null = null;
  let loadDone = false;
  function ensureLoaded(): Promise<void> {
    if (!loadPromise) {
      loadPromise = (async () => {
        try {
          tts = parseJson(await (await secureBackend()).getItem(TTS_KEY), blankTtsConfig());
        } catch {
          tts = blankTtsConfig();
        }
        try {
          stt = parseJson(await (await secureBackend()).getItem(STT_KEY), blankSttConfig());
        } catch {
          stt = blankSttConfig();
        }
        try {
          const raw = await AsyncStorage.getItem(VOICE_SETTINGS_KEY);
          settings = parseJson(raw, defaultVoiceSettings());
        } catch {
          settings = defaultVoiceSettings();
        }
        loadDone = true;
        emit();
      })();
    }
    return loadPromise;
  }
  void ensureLoaded();

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot(): {
      tts: TtsConfig;
      stt: SttConfig;
      settings: VoiceSettings;
      loaded: boolean;
    } {
      return {
        tts: tts ?? blankTtsConfig(),
        stt: stt ?? blankSttConfig(),
        settings: settings ?? defaultVoiceSettings(),
        loaded: loadDone,
      };
    },

    async setTts(next: TtsConfig): Promise<void> {
      await ensureLoaded();
      tts = next;
      try {
        await (await secureBackend()).setItem(TTS_KEY, JSON.stringify(next));
      } catch {
        // SecureStore unavailable — memory mirror keeps this session working.
      }
      emit();
    },

    async setStt(next: SttConfig): Promise<void> {
      await ensureLoaded();
      stt = next;
      try {
        await (await secureBackend()).setItem(STT_KEY, JSON.stringify(next));
      } catch {
        // memory mirror keeps this session working
      }
      emit();
    },

    async setSettings(next: VoiceSettings): Promise<void> {
      await ensureLoaded();
      settings = next;
      try {
        await AsyncStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // non-fatal
      }
      emit();
    },

    /**
     * Re-read everything from storage and notify listeners.
     * Used after backup restore so the UI picks up the restored data
     * instead of showing the stale in-memory mirrors.
     */
    async refresh(): Promise<void> {
      await loadPromise; // let any in-flight load settle first
      loadPromise = null;
      await ensureLoaded();
    },

    /** Test hook: wipe everything. */
    async __resetForTests(): Promise<void> {
      tts = blankTtsConfig();
      stt = blankSttConfig();
      settings = defaultVoiceSettings();
      loadDone = true;
      try {
        const sb = await secureBackend();
        await sb.deleteItem(TTS_KEY);
        await sb.deleteItem(STT_KEY);
      } catch {
        // ignore
      }
      try {
        await AsyncStorage.removeItem(VOICE_SETTINGS_KEY);
      } catch {
        // ignore
      }
      emit();
    },
  };
}

export type VoiceStore = ReturnType<typeof createVoiceStore>;

/** App-wide singleton. */
export const voiceStore = createVoiceStore();

export function useVoiceConfig(): {
  tts: TtsConfig;
  stt: SttConfig;
  settings: VoiceSettings;
  loaded: boolean;
} {
  const snap = useSyncExternalStore(
    voiceStore.subscribe,
    voiceStore.getSnapshot,
    voiceStore.getSnapshot,
  );
  return snap;
}
