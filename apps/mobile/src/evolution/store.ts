/**
 * Personality evolution （性格进化） — store. PURE module: no React Native /
 * expo imports, injectable KV backend (AsyncStorage in production,
 * Map-backed fake in tests).
 *
 * Keys:
 *   notes    -> "dudu.evolution.v1.notes"        (JSON: EvolutionNote[])
 *   enabled  -> "dudu.evolution.v1.enabled"      (JSON: boolean, default true)
 *   distilled-> "dudu.evolution.v1.lastDistilled" (JSON: number ms, weekly hint cadence)
 *
 * All values are plain JSON, no secrets — safe for backup PLAIN_KEYS.
 */

import { createWriteChain } from "../util/write-chain";
import {
  type EvolutionNote,
  newEvolutionNoteId,
  sanitizeEvolutionNote,
  validateEvolutionNote,
} from "./types";

export const EVOLUTION_KEYS = {
  notes: "dudu.evolution.v1.notes",
  enabled: "dudu.evolution.v1.enabled",
  lastDistilled: "dudu.evolution.v1.lastDistilled",
} as const;

const NOTES_CAP = 200;

export interface EvolutionStorage {
  getItem(k: string): Promise<string | null>;
  setItem(k: string, v: string): Promise<void>;
}

export function createEvolutionStore(storage: EvolutionStorage) {
  const chain = createWriteChain();
  let notes: EvolutionNote[] | null = null;
  let enabled: boolean | null = null;
  let lastDistilled: number | null = null;

  async function loadNotes(): Promise<EvolutionNote[]> {
    if (notes) return notes;
    try {
      const raw = await storage.getItem(EVOLUTION_KEYS.notes);
      const arr = raw ? JSON.parse(raw) : [];
      notes = Array.isArray(arr)
        ? arr.map(sanitizeEvolutionNote).filter((n): n is EvolutionNote => n !== null)
        : [];
    } catch {
      notes = [];
    }
    return notes;
  }

  async function saveNotes(next: EvolutionNote[]): Promise<void> {
    notes = next.slice(0, NOTES_CAP);
    await chain(() => storage.setItem(EVOLUTION_KEYS.notes, JSON.stringify(notes)));
  }

  return {
    /** Active notes for one persona, newest first. Persona-isolated. */
    async list(personaId: string): Promise<EvolutionNote[]> {
      const all = await loadNotes();
      return all.filter((n) => n.personaId === personaId).sort((a, b) => b.createdAt - a.createdAt);
    },

    async get(id: string): Promise<EvolutionNote | null> {
      const all = await loadNotes();
      return all.find((n) => n.id === id) ?? null;
    },

    async add(input: {
      personaId: string;
      content: string;
      source: { kind: "chat" | "manual"; dateMs: number; ref: string };
      nowMs?: number;
    }): Promise<EvolutionNote> {
      const err = validateEvolutionNote(input);
      if (err) throw new Error(err);
      if (!(await this.isEnabled())) throw new Error("evolution is off");
      const now = input.nowMs ?? Date.now();
      const note: EvolutionNote = {
        id: newEvolutionNoteId(now),
        personaId: input.personaId.trim(),
        content: input.content.trim(),
        source: {
          kind: input.source.kind,
          dateMs: input.source.dateMs,
          ref: input.source.ref.trim(),
        },
        createdAt: now,
        updatedAt: now,
      };
      const all = await loadNotes();
      await saveNotes([note, ...all]);
      await this.markDistilled(now);
      return note;
    },

    async edit(
      id: string,
      patch: { content?: string; source?: EvolutionNote["source"] },
    ): Promise<EvolutionNote> {
      const all = await loadNotes();
      const idx = all.findIndex((n) => n.id === id);
      if (idx < 0) throw new Error("note not found");
      const cur = all[idx];
      const next: EvolutionNote = { ...cur, updatedAt: Date.now() };
      if (patch.content !== undefined) {
        if (typeof patch.content !== "string" || patch.content.trim().length === 0) {
          throw new Error("content must be non-empty");
        }
        if (patch.content.trim().length > 200)
          throw new Error("content must be 200 characters or fewer");
        next.content = patch.content.trim();
      }
      if (patch.source !== undefined) {
        const err = validateEvolutionNote({
          personaId: cur.personaId,
          content: next.content,
          source: patch.source,
        });
        if (err) throw new Error(err);
        next.source = patch.source;
      }
      const out = all.slice();
      out[idx] = next;
      await saveNotes(out);
      return next;
    },

    async remove(id: string): Promise<void> {
      const all = await loadNotes();
      await saveNotes(all.filter((n) => n.id !== id));
    },

    /** Wipe every note for one persona — back to the card baseline. */
    async reset(personaId: string): Promise<number> {
      const all = await loadNotes();
      const kept = all.filter((n) => n.personaId !== personaId);
      const dropped = all.length - kept.length;
      await saveNotes(kept);
      return dropped;
    },

    async isEnabled(): Promise<boolean> {
      if (enabled !== null) return enabled;
      try {
        const raw = await storage.getItem(EVOLUTION_KEYS.enabled);
        enabled = raw === null ? true : JSON.parse(raw) === true;
      } catch {
        enabled = true;
      }
      return enabled;
    },

    async setEnabled(on: boolean): Promise<void> {
      enabled = on;
      await chain(() => storage.setItem(EVOLUTION_KEYS.enabled, JSON.stringify(on)));
    },

    async lastDistilledAt(): Promise<number> {
      if (lastDistilled !== null) return lastDistilled;
      try {
        const raw = await storage.getItem(EVOLUTION_KEYS.lastDistilled);
        lastDistilled = typeof raw === "string" && raw !== null ? Number(JSON.parse(raw)) || 0 : 0;
      } catch {
        lastDistilled = 0;
      }
      return lastDistilled;
    },

    async markDistilled(nowMs: number): Promise<void> {
      lastDistilled = nowMs;
      await chain(() => storage.setItem(EVOLUTION_KEYS.lastDistilled, JSON.stringify(nowMs)));
    },
  };
}

export type EvolutionStore = ReturnType<typeof createEvolutionStore>;
