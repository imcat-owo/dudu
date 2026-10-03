/**
 * Pure core of AI authorization — no React Native / expo imports.
 * Unit-testable in plain node. ai-authorization.ts adds the AsyncStorage
 * singleton and the native popup on top of this.
 */

import { useSyncExternalStore } from "react";
import type { CapabilityId } from "./capabilities";

export type AiAuthPreference = "ask" | "always" | "never";

export const AI_AUTH_PREFERENCES: AiAuthPreference[] = ["ask", "always", "never"];

export function isAiAuthPreference(raw: string | null | undefined): raw is AiAuthPreference {
  return raw === "ask" || raw === "always" || raw === "never";
}

/** Pure: what does a saved preference mean for this request? */
export function decideFromPreference(pref: AiAuthPreference): "allow" | "deny" | "prompt" {
  if (pref === "always") return "allow";
  if (pref === "never") return "deny";
  return "prompt";
}

export interface AiAuthBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const STORAGE_KEY = "dudu.aiAuth.v1";

function storageKeyFor(id: CapabilityId): string {
  return `${STORAGE_KEY}.${id}`;
}

const DEFAULTS: Record<CapabilityId, AiAuthPreference> = {
  bluetooth: "ask",
  photos: "ask",
  location: "ask",
  clipboard: "ask",
  notifications: "ask",
  sandbox: "ask",
};

export function createAiAuthStore(backend: AiAuthBackend) {
  let prefs: Record<CapabilityId, AiAuthPreference> = { ...DEFAULTS };
  let loaded = false;
  let generation = 0;
  const listeners = new Set<() => void>();

  function emit() {
    for (const listener of listeners) listener();
  }

  // Load saved prefs once; a setPreference that won the race is never clobbered.
  if (!loaded) {
    loaded = true;
    const seen = generation;
    void (async () => {
      try {
        const next = { ...prefs };
        let changed = false;
        for (const id of Object.keys(prefs) as CapabilityId[]) {
          const raw = await backend.getItem(storageKeyFor(id));
          if (seen !== generation) return;
          if (isAiAuthPreference(raw) && raw !== next[id]) {
            next[id] = raw;
            changed = true;
          }
        }
        if (changed) {
          prefs = next;
          emit();
        }
      } catch {
        // Storage unavailable — keep in-memory defaults.
      }
    })();
  }

  function getSnapshot(): Record<CapabilityId, AiAuthPreference> {
    return prefs;
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  async function setPreference(id: CapabilityId, pref: AiAuthPreference): Promise<void> {
    generation += 1;
    prefs = { ...prefs, [id]: pref };
    emit();
    try {
      await backend.setItem(storageKeyFor(id), pref);
    } catch {
      // Best effort — the in-memory value still applies this session.
    }
  }

  function usePreferences(): Record<CapabilityId, AiAuthPreference> {
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  }

  function usePreference(id: CapabilityId): AiAuthPreference {
    const all = usePreferences();
    return all[id];
  }

  return { getSnapshot, subscribe, setPreference, usePreferences, usePreference };
}
