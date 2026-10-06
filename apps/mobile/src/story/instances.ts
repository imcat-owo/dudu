/**
 * Interactive story mode （互动故事） — app singletons and production
 * wiring.
 *
 * Stories are chat-driven (no timers, no background work): the model
 * narrates through normal turns while a story is ACTIVE in the dialog,
 * and the STORY MODE prompt section (bible + progress + last choice)
 * keeps the narration coherent. Everything is persona-isolated and
 * incognito-aware.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { personaStore } from "../persona/stores";
import { buildStorySection } from "./prompt";
import { StoryStore } from "./store";
import { createStoryTools } from "./tools";

export const storyStore = new StoryStore(AsyncStorage);

/** Production AI-tool set for local-agent wiring. Bound to one dialog. */
export function createProductionStoryTools(threadId: string) {
  return createStoryTools({
    storyStore,
    currentThreadId: () => threadId,
    getPersona: async (personaId: string) => {
      try {
        const p = await personaStore.get(personaId);
        return p ? { id: p.id, name: p.name } : null;
      } catch {
        return null;
      }
    },
    nowMs: () => Date.now(),
  });
}

/**
 * Build the STORY MODE prompt section for a dialog. Never throws —
 * returns "" when story mode is not in effect (no story, not active,
 * incognito, or persona mismatch). Called per turn by local-agent.
 */
export async function buildStorySectionForThread(
  threadId: string,
  opts: { incognito: boolean; personaId: string | null },
): Promise<string> {
  try {
    if (opts.incognito) return "";
    if (!threadId) return "";
    const story = await storyStore.findByThread(threadId);
    return buildStorySection(story, { personaId: opts.personaId, incognito: opts.incognito });
  } catch {
    // A storage hiccup must never break the turn.
    return "";
  }
}
