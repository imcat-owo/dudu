/**
 * Personality dials （人格维度滑杆） — store. PURE module: no React Native /
 * expo imports, injectable KV backend (AsyncStorage in production,
 * Map-backed fake in tests).
 *
 * Keys:
 *   values  -> "dudu.dials.v1.values"   (JSON: { personaId: { dialId: 0–100 } })
 *   enabled -> "dudu.dials.v1.enabled"  (JSON: boolean, default true)
 *
 * All values are plain JSON, no secrets — safe for backup PLAIN_KEYS.
 * Persona-isolated: one persona's dials never leak into another's prompt.
 */

import { createWriteChain } from "../util/write-chain";
import {
  clampDial,
  DIAL_IDS,
  type DialId,
  type DialValues,
  isDialId,
  normalizeDialValues,
} from "./types";

export const DIALS_KEYS = {
  values: "dudu.dials.v1.values",
  enabled: "dudu.dials.v1.enabled",
} as const;

export interface DialsStorage {
  getItem(k: string): Promise<string | null>;
  setItem(k: string, v: string): Promise<void>;
}

type PersonaDialMap = Record<string, DialValues>;

function sanitizePersonaDialMap(v: unknown): PersonaDialMap {
  if (typeof v !== "object" || v === null) return {};
  const out: PersonaDialMap = {};
  for (const [personaId, raw] of Object.entries(v as Record<string, unknown>)) {
    if (typeof personaId !== "string" || personaId.length === 0) continue;
    if (typeof raw !== "object" || raw === null) continue;
    const dims: DialValues = {};
    for (const [dimId, val] of Object.entries(raw as Record<string, unknown>)) {
      if (isDialId(dimId)) dims[dimId] = clampDial(val);
    }
    out[personaId] = dims;
  }
  return out;
}

export function createDialsStore(storage: DialsStorage) {
  const chain = createWriteChain();
  let all: PersonaDialMap | null = null;
  let enabled: boolean | null = null;

  async function loadAll(): Promise<PersonaDialMap> {
    if (all) return all;
    try {
      const raw = await storage.getItem(DIALS_KEYS.values);
      all = raw ? sanitizePersonaDialMap(JSON.parse(raw)) : {};
    } catch {
      all = {};
    }
    return all;
  }

  async function saveAll(next: PersonaDialMap): Promise<void> {
    all = next;
    await chain(() => storage.setItem(DIALS_KEYS.values, JSON.stringify(next)));
  }

  return {
    /** Dial values for one persona, merged over the 50 defaults. */
    async get(personaId: string): Promise<Record<DialId, number>> {
      const map = await loadAll();
      return normalizeDialValues(map[personaId]);
    },

    /** Set one dial for one persona. Throws on unknown dial id. Immediate — no restart. */
    async set(personaId: string, dialId: DialId, value: number): Promise<Record<DialId, number>> {
      if (!DIAL_IDS.includes(dialId)) throw new Error(`unknown dial: ${dialId}`);
      const map = await loadAll();
      const cur = normalizeDialValues(map[personaId]);
      cur[dialId] = clampDial(value);
      // Only persist non-defaults, so reset = delete the row.
      const persisted: DialValues = {};
      for (const id of DIAL_IDS) {
        if (cur[id] !== 50) persisted[id] = cur[id];
      }
      const next = { ...map };
      if (Object.keys(persisted).length === 0) delete next[personaId];
      else next[personaId] = persisted;
      await saveAll(next);
      return cur;
    },

    /** Reset one persona's dials to the defaults (50). */
    async reset(personaId: string): Promise<void> {
      const map = await loadAll();
      if (!(personaId in map)) return;
      const next = { ...map };
      delete next[personaId];
      await saveAll(next);
    },

    async isEnabled(): Promise<boolean> {
      if (enabled !== null) return enabled;
      try {
        const raw = await storage.getItem(DIALS_KEYS.enabled);
        enabled = raw === null ? true : JSON.parse(raw) === true;
      } catch {
        enabled = true;
      }
      return enabled;
    },

    async setEnabled(on: boolean): Promise<void> {
      enabled = on;
      await chain(() => storage.setItem(DIALS_KEYS.enabled, JSON.stringify(on)));
    },
  };
}

export type DialsStore = ReturnType<typeof createDialsStore>;
