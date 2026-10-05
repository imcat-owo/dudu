/**
 * Editable tool descriptions — PURE module (no React Native imports).
 *
 * D8: Override any built-in tool's description. For when I (not she) am
 * tuning how the AI understands its tools — she doesn't need to care,
 * but the knob exists.
 *
 * Overrides live in AsyncStorage, keyed by tool name. The tool registry
 * applies them via applyDescriptionOverrides() before handing tools to
 * the model. Empty string = reset to built-in.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

const KEY = "dudu.tool-desc-overrides.v1";

export type DescOverrides = Record<string, string>;

export function createDescOverrideStore() {
  let overrides: DescOverrides | null = null;
  const listeners = new Set<() => void>();
  let snapshot: { overrides: DescOverrides; loaded: boolean } = {
    overrides: {},
    loaded: false,
  };

  function emit() {
    snapshot = { overrides: overrides ?? {}, loaded: overrides !== null };
    for (const l of listeners) l();
  }

  let loadPromise: Promise<void> | null = null;
  function ensureLoaded(): Promise<void> {
    if (!loadPromise) {
      loadPromise = (async () => {
        try {
          const raw = await AsyncStorage.getItem(KEY);
          overrides = raw ? (JSON.parse(raw) as DescOverrides) : {};
        } catch {
          overrides = {};
        }
        emit();
      })();
    }
    return loadPromise;
  }
  void ensureLoaded();

  async function persist(): Promise<void> {
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(overrides ?? {}));
    } catch {
      // ignore
    }
    emit();
  }

  return {
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    getSnapshot() {
      return snapshot;
    },

    async setOverride(toolName: string, description: string): Promise<void> {
      await ensureLoaded();
      const next = { ...(overrides ?? {}) };
      if (!description.trim()) delete next[toolName];
      else next[toolName] = description;
      overrides = next;
      await persist();
    },

    async getOverride(toolName: string): Promise<string | undefined> {
      await ensureLoaded();
      return (overrides ?? {})[toolName];
    },

    async getAll(): Promise<DescOverrides> {
      await ensureLoaded();
      return { ...(overrides ?? {}) };
    },

    /** Apply overrides to a tool list (returns a new array). */
    async apply<T extends { name: string; description: string }>(tools: T[]): Promise<T[]> {
      const ov = await this.getAll();
      if (Object.keys(ov).length === 0) return tools;
      return tools.map((t) =>
        ov[t.name] ? ({ ...t, description: ov[t.name] } as T) : t,
      );
    },
  };
}

export const descOverrideStore = createDescOverrideStore();

export function useDescOverrides(): { overrides: DescOverrides; loaded: boolean } {
  const snap = useSyncExternalStore(
    descOverrideStore.subscribe,
    descOverrideStore.getSnapshot,
    descOverrideStore.getSnapshot,
  );
  return snap;
}
