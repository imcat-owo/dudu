/**
 * Persona store — PURE module: no React Native / expo imports.
 *
 * Persists personas and tags on the injectable KV backend (AsyncStorage in
 * production, Map-backed fake in tests):
 *   personas -> "dudu.persona.v1.list" (JSON: Persona[])
 *   tags     -> "dudu.persona.v1.tags"  (JSON: PersonaTag[])
 *
 * Deleting a persona does NOT delete dialogs using it — dialogs keep a
 * snapshot of the persona name at creation time.
 */

import {
  blankPersona,
  newPersonaTagId,
  validatePersona,
  type Persona,
  type PersonaTag,
} from "./types";
import { createWriteChain } from "../util/write-chain";

/** Minimal storage surface. AsyncStorage satisfies this in production. */
export interface PersonaStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem?: (key: string) => Promise<void>;
}

const PERSONAS_KEY = "dudu.persona.v1.list";
const TAGS_KEY = "dudu.persona.v1.tags";

/** Storage key for the active persona ID (per app, not per dialog). */
export const ACTIVE_PERSONA_KEY = "dudu.persona.v1.active";

export function createPersonaStore(storage: PersonaStorage) {
  const chain = createWriteChain();
  let personas: Persona[] | null = null;
  let tags: PersonaTag[] | null = null;
  let activeId: string | null = null;
  const listeners = new Set<() => void>();

  function emit() {
    for (const l of listeners) l();
  }

  async function loadPersonas(): Promise<Persona[]> {
    if (personas) return personas;
    try {
      const raw = await storage.getItem(PERSONAS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      personas = Array.isArray(arr) ? arr.filter((p) => p && typeof p.id === "string") : [];
    } catch {
      personas = [];
    }
    return personas;
  }

  async function savePersonas(next: Persona[]): Promise<void> {
    personas = next;
    await chain(() => storage.setItem(PERSONAS_KEY, JSON.stringify(next)));
    emit();
  }

  async function loadTags(): Promise<PersonaTag[]> {
    if (tags) return tags;
    try {
      const raw = await storage.getItem(TAGS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      tags = Array.isArray(arr) ? arr.filter((t) => t && typeof t.id === "string") : [];
    } catch {
      tags = [];
    }
    return tags;
  }

  async function saveTags(next: PersonaTag[]): Promise<void> {
    tags = next;
    await chain(() => storage.setItem(TAGS_KEY, JSON.stringify(next)));
    emit();
  }

  return {
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },

    /** All personas, newest first. */
    async list(): Promise<Persona[]> {
      const all = await loadPersonas();
      return [...all].sort((a, b) => b.updatedAt - a.updatedAt);
    },

    async get(id: string): Promise<Persona | null> {
      const all = await loadPersonas();
      return all.find((p) => p.id === id) ?? null;
    },

    /** Create or update. Returns error code or null on success. */
    async upsert(p: Persona): Promise<string | null> {
      const err = validatePersona(p);
      if (err) return err;
      const all = await loadPersonas();
      const now = Date.now();
      const next: Persona = { ...p, updatedAt: now };
      const idx = all.findIndex((x) => x.id === next.id);
      const updated = idx >= 0 ? all.map((x, i) => (i === idx ? next : x)) : [...all, next];
      await savePersonas(updated);
      return null;
    },

    async remove(id: string): Promise<void> {
      const all = await loadPersonas();
      await savePersonas(all.filter((p) => p.id !== id));
      if (activeId === id) {
        activeId = null;
        try {
          await storage.removeItem?.(ACTIVE_PERSONA_KEY);
        } catch {
          // ignore
        }
      }
    },

    /** All tags. */
    async listTags(): Promise<PersonaTag[]> {
      return loadTags();
    },

    async createTag(name: string, color?: string): Promise<PersonaTag> {
      const all = await loadTags();
      const tag: PersonaTag = {
        id: newPersonaTagId(),
        name: name.trim(),
        color,
        createdAt: Date.now(),
      };
      await saveTags([...all, tag]);
      return tag;
    },

    async removeTag(id: string): Promise<void> {
      const all = await loadTags();
      await saveTags(all.filter((t) => t.id !== id));
      // Remove the tag from all personas.
      const ps = await loadPersonas();
      const updated = ps.map((p) =>
        p.tagIds.includes(id) ? { ...p, tagIds: p.tagIds.filter((x) => x !== id), updatedAt: Date.now() } : p,
      );
      await savePersonas(updated);
    },

    /** Personas having a tag. */
    async byTag(tagId: string): Promise<Persona[]> {
      const all = await loadPersonas();
      return all.filter((p) => p.tagIds.includes(tagId));
    },

    /** The active persona ID (null = none selected). */
    async getActiveId(): Promise<string | null> {
      if (activeId) return activeId;
      try {
        activeId = await storage.getItem(ACTIVE_PERSONA_KEY);
      } catch {
        activeId = null;
      }
      return activeId;
    },

    async setActiveId(id: string | null): Promise<void> {
      activeId = id;
      try {
        if (id) await storage.setItem(ACTIVE_PERSONA_KEY, id);
        else await storage.removeItem?.(ACTIVE_PERSONA_KEY);
      } catch {
        // ignore
      }
      emit();
    },

    /** Create a blank persona (for the editor). Does not save until upsert. */
    blank(): Persona {
      return blankPersona();
    },
  };
}

export type PersonaStore = ReturnType<typeof createPersonaStore>;
