/**
 * Personality evolution （性格进化） — app singletons and production wiring.
 *
 * No scheduler: the model distills patterns itself (nudged weekly by the
 * prompt hint), so there is no background engine to wire here.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { personaStore } from "../persona/stores";
import type { Persona } from "../persona/types";
import { buildEvolutionSection } from "./prompt";
import { createEvolutionStore } from "./store";
import { createEvolutionTools } from "./tools";

export const evolutionStore = createEvolutionStore(AsyncStorage);

async function getPersona(personaId: string): Promise<Persona | null> {
  try {
    return await personaStore.get(personaId);
  } catch {
    return null;
  }
}

/** Production AI-tool set for local-agent wiring. Synchronous. */
export function createProductionEvolutionTools() {
  return createEvolutionTools({
    evolutionStore,
    getPersona: async (personaId: string) => {
      const p = await getPersona(personaId);
      return p ? { id: p.id, name: p.name } : null;
    },
    listPersonas: async () => {
      try {
        const ps = await personaStore.list();
        return ps.map((p) => ({ id: p.id, name: p.name }));
      } catch {
        return [];
      }
    },
    nowMs: () => Date.now(),
  });
}

/**
 * Build the evolution section for the active persona's system prompt.
 * Never throws — a storage hiccup must never break the turn.
 * Empty string in incognito: the session promises no memory.
 */
export async function buildActiveEvolutionSection(
  personaId: string | null,
  personaName: string,
  opts: { incognito: boolean; nowMs?: number },
): Promise<string> {
  if (opts.incognito || !personaId) return "";
  try {
    const now = opts.nowMs ?? Date.now();
    const [enabled, notes, lastDistilledAt] = await Promise.all([
      evolutionStore.isEnabled(),
      evolutionStore.list(personaId),
      evolutionStore.lastDistilledAt(),
    ]);
    return buildEvolutionSection(notes, { personaName, enabled, lastDistilledAt, nowMs: now });
  } catch {
    return "";
  }
}
