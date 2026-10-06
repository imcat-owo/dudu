/**
 * Outfit / dress-up system （换装系统） — app singletons and production
 * wiring.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { personaStore } from "../persona/stores";
import type { Persona } from "../persona/types";
import { OutfitStore } from "./store";
import { createOutfitTools } from "./tools";

export const outfitStore = new OutfitStore(AsyncStorage);

async function getPersona(personaId: string): Promise<Persona | null> {
  try {
    return await personaStore.get(personaId);
  } catch {
    return null;
  }
}

/** Active outfit's English prompt fragment for image prompts, or null. */
export async function getActiveOutfitDescription(personaId: string): Promise<string | null> {
  try {
    return await outfitStore.getActiveOutfitDescription(personaId);
  } catch {
    return null;
  }
}

/** Production AI-tool set for local-agent wiring. Synchronous. */
export function createProductionOutfitTools() {
  return createOutfitTools({
    outfitStore,
    getPersona: async (personaId: string) => {
      const p = await getPersona(personaId);
      return p ? { id: p.id, name: p.name } : null;
    },
    nowMs: () => Date.now(),
  });
}
