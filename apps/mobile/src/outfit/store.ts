/**
 * Outfit / dress-up system （换装系统） — store.
 * AsyncStorage-backed, write-serialized, injectable storage for tests.
 *
 * Wardrobes are keyed per persona: { [personaId]: Wardrobe }. Persona
 * isolation is structural — a persona's outfits live under its own key
 * and are never read for another persona.
 *
 * Deleting the active outfit clears the active slot (falls back to no
 * outfit, honestly — never to a random other outfit).
 */

import { blankWardrobe, newOutfitId, type Outfit, type Wardrobe } from "./types";

const KEY = "dudu.outfit.v1.wardrobes";

export const OUTFIT_BACKUP_KEYS = [KEY] as const;

export interface OutfitStorage {
  getItem(k: string): Promise<string | null>;
  setItem(k: string, v: string): Promise<void>;
}

type WardrobeMap = Record<string, Wardrobe>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function sanitizeOutfit(v: unknown, personaId: string): Outfit | null {
  if (!isRecord(v)) return null;
  const { id, name, description, refImageUri, createdBy, createdAt, updatedAt } = v;
  if (typeof id !== "string" || !id) return null;
  if (typeof name !== "string" || !name.trim()) return null;
  if (typeof description !== "string" || !description.trim()) return null;
  return {
    id,
    personaId,
    name: name.trim(),
    description: description.trim(),
    ...(typeof refImageUri === "string" && refImageUri ? { refImageUri } : {}),
    createdBy: createdBy === "ai" ? "ai" : "her",
    createdAt: typeof createdAt === "number" ? createdAt : 0,
    updatedAt: typeof updatedAt === "number" ? updatedAt : 0,
  };
}

function sanitizeWardrobe(v: unknown, personaId: string): Wardrobe {
  const w = blankWardrobe();
  if (!isRecord(v)) return w;
  const raw = Array.isArray(v.outfits) ? v.outfits : [];
  w.outfits = raw.map((o) => sanitizeOutfit(o, personaId)).filter((o): o is Outfit => o !== null);
  const activeId = typeof v.activeId === "string" ? v.activeId : null;
  // Drop stale active ids (pointing at a deleted outfit).
  w.activeId = activeId && w.outfits.some((o) => o.id === activeId) ? activeId : null;
  return w;
}

export class OutfitStore {
  private writeChain: Promise<void> = Promise.resolve();
  private readonly nowMs: () => number;

  constructor(
    private storage: OutfitStorage,
    opts?: { nowMs?: () => number },
  ) {
    this.nowMs = opts?.nowMs ?? (() => Date.now());
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.writeChain;
    const cur = (async () => {
      await prev;
      return fn();
    })();
    this.writeChain = cur.then(
      () => {},
      () => {},
    );
    return cur;
  }

  private async loadAll(): Promise<WardrobeMap> {
    try {
      const raw = await this.storage.getItem(KEY);
      if (!raw) return {};
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) return {};
      const out: WardrobeMap = {};
      for (const [personaId, w] of Object.entries(parsed)) {
        if (typeof personaId === "string" && personaId) {
          out[personaId] = sanitizeWardrobe(w, personaId);
        }
      }
      return out;
    } catch {
      return {};
    }
  }

  private async saveAll(map: WardrobeMap): Promise<void> {
    await this.storage.setItem(KEY, JSON.stringify(map));
  }

  /** This persona's wardrobe (never another persona's). */
  async getWardrobe(personaId: string): Promise<Wardrobe> {
    const all = await this.loadAll();
    return all[personaId] ?? blankWardrobe();
  }

  /** The outfit currently worn, or null when none is set. */
  async getActiveOutfit(personaId: string): Promise<Outfit | null> {
    const w = await this.getWardrobe(personaId);
    if (!w.activeId) return null;
    return w.outfits.find((o) => o.id === w.activeId) ?? null;
  }

  /** The active outfit's English prompt fragment, or null. */
  async getActiveOutfitDescription(personaId: string): Promise<string | null> {
    const o = await this.getActiveOutfit(personaId);
    return o ? o.description : null;
  }

  async add(
    personaId: string,
    input: { name: string; description: string; refImageUri?: string; createdBy: "her" | "ai" },
  ): Promise<Outfit> {
    if (!personaId) throw new Error("personaId is required.");
    return this.exclusive(async () => {
      const all = await this.loadAll();
      const w = all[personaId] ?? blankWardrobe();
      const now = this.nowMs();
      const outfit: Outfit = {
        id: newOutfitId(now),
        personaId,
        name: input.name.trim(),
        description: input.description.trim(),
        ...(input.refImageUri ? { refImageUri: input.refImageUri } : {}),
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
      };
      w.outfits.push(outfit);
      all[personaId] = w;
      await this.saveAll(all);
      return outfit;
    });
  }

  /**
   * Set the worn outfit (null clears it). The outfit must belong to THIS
   * persona — cross-persona ids are refused, not silently ignored.
   */
  async setActive(personaId: string, outfitId: string | null): Promise<Outfit | null> {
    if (!personaId) throw new Error("personaId is required.");
    return this.exclusive(async () => {
      const all = await this.loadAll();
      const w = all[personaId] ?? blankWardrobe();
      if (outfitId !== null) {
        const found = w.outfits.find((o) => o.id === outfitId);
        if (!found) throw new Error("outfit-not-found");
        w.activeId = found.id;
        all[personaId] = w;
        await this.saveAll(all);
        return found;
      }
      w.activeId = null;
      all[personaId] = w;
      await this.saveAll(all);
      return null;
    });
  }

  /**
   * Delete an outfit. If it was the active one, the active slot falls
   * back to null (no outfit) — never to a random replacement.
   * Returns false when the outfit doesn't exist under this persona.
   */
  async remove(personaId: string, outfitId: string): Promise<boolean> {
    if (!personaId) throw new Error("personaId is required.");
    return this.exclusive(async () => {
      const all = await this.loadAll();
      const w = all[personaId] ?? blankWardrobe();
      if (!w.outfits.some((o) => o.id === outfitId)) return false;
      w.outfits = w.outfits.filter((o) => o.id !== outfitId);
      if (w.activeId === outfitId) w.activeId = null;
      all[personaId] = w;
      await this.saveAll(all);
      return true;
    });
  }

  /** Test hook. */
  async __resetForTests(): Promise<void> {
    await this.exclusive(async () => {
      await this.storage.setItem(KEY, "{}");
    });
  }
}
