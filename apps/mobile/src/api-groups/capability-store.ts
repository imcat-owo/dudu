/**
 * Capability group persistence + routing flags.
 *
 * Groups hold no secrets (only ApiGroup ids, names, model names), so they
 * live in AsyncStorage — NOT SecureStore. Follows the model-profiles.ts
 * pattern: lazy AsyncStorage import (stays importable in plain node
 * tests), guarded fallbacks, injectable backend.
 *
 * Two flags (vision doc 开启原则):
 * - routingEnabled (default ON): passive capability routing — the current
 *   model is always tried first (fast path); routing only kicks in when it
 *   provably can't handle the attachment. Conservative, automatic, visible.
 * - coordinationEnabled (default OFF): AI-driven multi-model orchestration
 *   (feature 2). The AI may only PROPOSE a plan (plan-only); she approves
 *   before anything runs. See ./plan-gate.ts.
 */

import { useSyncExternalStore } from "react";
import {
  type CapabilityGroup,
  newCapabilityGroupId,
  seedCapabilityGroups,
} from "./capability-groups";
import type { RankingMode } from "./model-ranking";

const GROUPS_KEY = "dudu.capability-groups.v1";
const ROUTING_KEY = "dudu.capability-routing-enabled.v1";
const COORDINATION_KEY = "dudu.multi-model-coordination.v1";
const RANKING_MODE_KEY = "dudu.ranking-mode.v1";

export interface CapabilityBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

async function loadAsyncStorage(): Promise<CapabilityBackend> {
  const mod = await import("@react-native-async-storage/async-storage");
  const AsyncStorage = mod.default;
  return {
    getItem: (k) => AsyncStorage.getItem(k),
    setItem: (k, v) => AsyncStorage.setItem(k, v),
  };
}

function parseGroups(raw: string | null): CapabilityGroup[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const out = parsed.filter(
      (g): g is CapabilityGroup =>
        typeof g === "object" &&
        g !== null &&
        typeof (g as CapabilityGroup).id === "string" &&
        typeof (g as CapabilityGroup).tag === "string" &&
        Array.isArray((g as CapabilityGroup).members),
    );
    return out;
  } catch {
    return null;
  }
}

/** Merge stored groups with presets: presets she deleted stay deleted only
 *  if she disabled them — simpler rule: any missing preset is re-seeded
 *  (enabled, empty). Stored groups always win on conflicts. */
function mergeWithPresets(stored: CapabilityGroup[]): CapabilityGroup[] {
  const seeds = seedCapabilityGroups();
  const byPreset = new Map(stored.filter((g) => g.presetId).map((g) => [g.presetId as string, g]));
  const customs = stored.filter((g) => !g.presetId);
  const merged = seeds.map((s) => {
    const prev = s.presetId ? byPreset.get(s.presetId) : undefined;
    return prev ?? s;
  });
  return [...merged, ...customs].sort((a, b) => a.createdAt - b.createdAt);
}

export function createCapabilityStore(backend?: CapabilityBackend) {
  let resolved: CapabilityBackend | null = backend ?? null;
  let groups: CapabilityGroup[] | null = null;
  let routingEnabled = true;
  let coordinationEnabled = false;
  let rankingMode: RankingMode = "balanced";
  let loadDone = false;
  const listeners = new Set<() => void>();

  function emit() {
    for (const l of listeners) l();
  }

  async function impl(): Promise<CapabilityBackend> {
    if (!resolved) resolved = await loadAsyncStorage();
    return resolved;
  }

  let loadPromise: Promise<void> | null = null;
  function ensureLoaded(): Promise<void> {
    if (!loadPromise) {
      loadPromise = (async () => {
        const b = await impl();
        try {
          const raw = await b.getItem(GROUPS_KEY);
          const parsed = parseGroups(raw);
          groups = parsed ? mergeWithPresets(parsed) : seedCapabilityGroups();
        } catch {
          groups = seedCapabilityGroups();
        }
        try {
          const r = await b.getItem(ROUTING_KEY);
          routingEnabled = r === null ? true : r === "1";
        } catch {
          routingEnabled = true;
        }
        try {
          const c = await b.getItem(COORDINATION_KEY);
          coordinationEnabled = c === "1";
        } catch {
          coordinationEnabled = false;
        }
        try {
          const m = await b.getItem(RANKING_MODE_KEY);
          rankingMode = m === "smart" || m === "fast" || m === "balanced" ? m : "balanced";
        } catch {
          rankingMode = "balanced";
        }
        loadDone = true;
        emit();
      })();
    }
    return loadPromise;
  }
  void ensureLoaded();

  async function persist(): Promise<void> {
    try {
      await (await impl()).setItem(GROUPS_KEY, JSON.stringify(groups ?? []));
    } catch {
      // convenience only — never break chat over it
    }
    emit();
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot(): {
      groups: CapabilityGroup[];
      routingEnabled: boolean;
      coordinationEnabled: boolean;
      rankingMode: RankingMode;
      loaded: boolean;
    } {
      return {
        groups: groups ?? [],
        routingEnabled,
        coordinationEnabled,
        rankingMode,
        loaded: loadDone,
      };
    },

    async upsert(group: CapabilityGroup): Promise<void> {
      await ensureLoaded();
      const next = (groups ?? []).some((g) => g.id === group.id)
        ? (groups ?? []).map((g) => (g.id === group.id ? group : g))
        : [...(groups ?? []), group];
      groups = next;
      await persist();
    },

    async remove(id: string): Promise<void> {
      await ensureLoaded();
      // Presets can't be deleted — disable them instead (safer for her).
      const target = (groups ?? []).find((g) => g.id === id);
      if (target?.presetId) {
        groups = (groups ?? []).map((g) =>
          g.id === id ? { ...g, enabled: false, members: [] } : g,
        );
      } else {
        groups = (groups ?? []).filter((g) => g.id !== id);
      }
      await persist();
    },

    newCustomGroup(tag: string, kind: CapabilityGroup["kind"], name: string): CapabilityGroup {
      return {
        id: newCapabilityGroupId(),
        name: name.trim(),
        tag: tag.trim(),
        kind,
        members: [],
        enabled: true,
        createdAt: Date.now(),
      };
    },

    async setRoutingEnabled(on: boolean): Promise<void> {
      await ensureLoaded();
      routingEnabled = on;
      try {
        await (await impl()).setItem(ROUTING_KEY, on ? "1" : "0");
      } catch {
        // ignore
      }
      emit();
    },

    async setCoordinationEnabled(on: boolean): Promise<void> {
      await ensureLoaded();
      coordinationEnabled = on;
      try {
        await (await impl()).setItem(COORDINATION_KEY, on ? "1" : "0");
      } catch {
        // ignore
      }
      emit();
    },

    async setRankingMode(mode: RankingMode): Promise<void> {
      await ensureLoaded();
      rankingMode = mode;
      try {
        await (await impl()).setItem(RANKING_MODE_KEY, mode);
      } catch {
        // ignore
      }
      emit();
    },

    /** Test hook. */
    async __resetForTests(): Promise<void> {
      groups = seedCapabilityGroups();
      routingEnabled = true;
      coordinationEnabled = false;
      rankingMode = "balanced";
      loadDone = true;
      emit();
    },
  };
}

export type CapabilityStore = ReturnType<typeof createCapabilityStore>;

/** App-wide singleton. */
export const capabilityStore = createCapabilityStore();

export function useCapabilityGroups(): {
  groups: CapabilityGroup[];
  routingEnabled: boolean;
  coordinationEnabled: boolean;
  rankingMode: RankingMode;
  loaded: boolean;
} {
  const snap = useSyncExternalStore(
    capabilityStore.subscribe,
    capabilityStore.getSnapshot,
    capabilityStore.getSnapshot,
  );
  return {
    groups: snap.groups,
    routingEnabled: snap.routingEnabled,
    coordinationEnabled: snap.coordinationEnabled,
    rankingMode: snap.rankingMode,
    loaded: snap.loaded,
  };
}
