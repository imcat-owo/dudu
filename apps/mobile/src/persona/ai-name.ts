/**
 * AI display name — the name the USER gave the AI.
 *
 * The user's way to name the AI is the active persona's `name`. When no
 * persona is selected (or its name is blank), fall back to the neutral
 * default (`ai.defaultName`, i.e. 嘟嘟). No hardcoded personal names here:
 * the app must never assume what the AI is called.
 *
 * PURE module: no React Native / expo imports.
 */

import type { StringKey } from "../i18n";
import type { PersonaStore } from "./store";

/** Minimal store surface getAiDisplayName needs (injectable for tests). */
export type AiNameStore = Pick<PersonaStore, "getActiveId" | "get">;

/** Sync resolution when the persona name is already known (may be null/blank). */
export function resolveAiDisplayName(
  personaName: string | null | undefined,
  resolve: (key: StringKey) => string,
): string {
  const n = personaName?.trim();
  return n ? n : resolve("ai.defaultName");
}

/**
 * Async: read the active persona from the store and resolve the display name.
 * Never throws — storage hiccups fall back to the default name.
 * The store is passed explicitly so this module stays PURE (no RN imports)
 * and testable; call sites pass the app singleton `personaStore`.
 */
export async function getAiDisplayName(
  resolve: (key: StringKey) => string,
  store: AiNameStore,
): Promise<string> {
  try {
    const id = await store.getActiveId().catch(() => null);
    if (id) {
      const p = await store.get(id).catch(() => null);
      const n = p?.name?.trim();
      if (n) return n;
    }
  } catch {
    // ignore — fall through to the default name
  }
  return resolve("ai.defaultName");
}
