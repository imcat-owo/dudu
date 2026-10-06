/**
 * Personality dials （人格维度滑杆） — app singletons and production wiring.
 *
 * No AI tools by design: only SHE drags the dials. The AI may suggest
 * ("要不要把粘人度调高一点？") in chat; it can never move them itself.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { buildDialsSection } from "./prompt";
import { createDialsStore, DIALS_KEYS, type DialsStorage } from "./store";

/**
 * Injectable factory — production uses the module singletons below;
 * tests pass a Map-backed fake. Same logic, both paths.
 */
export function createDialsInstances(storage: DialsStorage) {
  const store = createDialsStore(storage);

  /**
   * Build the dials section for the active persona's system prompt.
   * Never throws — a storage hiccup must never break the turn.
   * Empty string in incognito: the session promises no memory, and dials
   * are a form of remembered preference.
   */
  async function buildActiveDialsSection(
    personaId: string | null,
    opts: { incognito: boolean },
  ): Promise<string> {
    if (opts.incognito || !personaId) return "";
    try {
      const [enabled, values] = await Promise.all([store.isEnabled(), store.get(personaId)]);
      // The store methods fall back to defaults when storage hiccups —
      // fine for the UI, but the prompt must never present GUESSED 50s
      // as her settings. Verify the raw read works before trusting them.
      await storage.getItem(DIALS_KEYS.values);
      return buildDialsSection(values, { enabled });
    } catch {
      return "";
    }
  }

  return { store, buildActiveDialsSection };
}

const production = createDialsInstances(AsyncStorage);
export const dialsStore = production.store;
export const buildActiveDialsSection = production.buildActiveDialsSection;
