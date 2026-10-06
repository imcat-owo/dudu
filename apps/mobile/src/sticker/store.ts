/**
 * 图片表情包 — pack/sticker metadata store.
 *
 * AsyncStorage-backed in production, injectable for tests (same pattern
 * as SegmentStore). File bytes live in files.ts (document dir); this store
 * only keeps metadata — pack names, sticker ids, file names.
 *
 * Her packs are hers (account-level, like WeChat — NOT per-persona).
 * The AI library is the built-in "ai" pack. Persona isolation applies to
 * the per-persona "may the AI send stickers here" toggle.
 */

import {
  AI_PACK_ID,
  MAX_HER_PACKS,
  MAX_STICKERS_PER_PACK,
  newPackId,
  newStickerId,
  type Sticker,
  type StickerPack,
  validatePackName,
  validateStickerName,
} from "./types";

export interface StickerStoreBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const KEY_PREFIX = "dudu.stickers.v1.";
const PACKS_KEY = `${KEY_PREFIX}packs`;
const STICKERS_KEY = `${KEY_PREFIX}stickers`;
const AI_ENABLED_PREFIX = `${KEY_PREFIX}ai-enabled.`;

/** The built-in AI library pack (seeded with the devil mascot art). */
export function aiPackSeed(): StickerPack {
  return { id: AI_PACK_ID, name: "AI", owner: "ai", createdAt: 0 };
}

interface Stored {
  packs: StickerPack[];
  stickers: Sticker[];
}

export class StickerStore {
  constructor(private backend: StickerStoreBackend) {}

  private async load(): Promise<Stored> {
    try {
      const [p, s] = await Promise.all([
        this.backend.getItem(PACKS_KEY),
        this.backend.getItem(STICKERS_KEY),
      ]);
      const packs: StickerPack[] = p ? (JSON.parse(p) as StickerPack[]) : [];
      const stickers: Sticker[] = s ? (JSON.parse(s) as Sticker[]) : [];
      return {
        packs: Array.isArray(packs) ? packs : [],
        stickers: Array.isArray(stickers) ? stickers : [],
      };
    } catch {
      return { packs: [], stickers: [] };
    }
  }

  private async save(data: Stored): Promise<void> {
    await Promise.all([
      this.backend.setItem(PACKS_KEY, JSON.stringify(data.packs)),
      this.backend.setItem(STICKERS_KEY, JSON.stringify(data.stickers)),
    ]);
  }

  /** All packs: the built-in AI library first, then hers by creation time. */
  async listPacks(): Promise<StickerPack[]> {
    const { packs } = await this.load();
    const hers = packs.filter((p) => p.id !== AI_PACK_ID).sort((a, b) => a.createdAt - b.createdAt);
    // The AI library pack is built-in (virtual) — always present, never stored.
    return [aiPackSeed(), ...hers];
  }

  async createPack(name: string): Promise<{ pack?: StickerPack; error?: string }> {
    const err = validatePackName(name);
    if (err) return { error: err };
    const data = await this.load();
    const herCount = data.packs.filter((p) => p.owner === "her").length;
    if (herCount >= MAX_HER_PACKS) return { error: "too-many" };
    const pack: StickerPack = {
      id: newPackId(),
      name: name.trim(),
      owner: "her",
      createdAt: Date.now(),
    };
    data.packs.push(pack);
    await this.save(data);
    return { pack };
  }

  async renamePack(packId: string, name: string): Promise<string | null> {
    const err = validatePackName(name);
    if (err) return err;
    const data = await this.load();
    const pack = data.packs.find((p) => p.id === packId);
    if (!pack) return "not-found";
    pack.name = name.trim();
    await this.save(data);
    return null;
  }

  /**
   * Delete a pack (metadata). The AI library pack can never be deleted.
   * Pack FILES are removed by files.ts — callers must call
   * deletePackFiles(packId) too. Sent messages keep rendering: they point
   * at copies in the sent dir, never at pack files.
   */
  async deletePack(packId: string): Promise<string | null> {
    if (packId === AI_PACK_ID) return "protected";
    const data = await this.load();
    const idx = data.packs.findIndex((p) => p.id === packId);
    if (idx < 0) return "not-found";
    data.packs.splice(idx, 1);
    data.stickers = data.stickers.filter((s) => s.packId !== packId);
    await this.save(data);
    return null;
  }

  async listStickers(packId: string): Promise<Sticker[]> {
    const { stickers } = await this.load();
    return stickers.filter((s) => s.packId === packId).sort((a, b) => a.createdAt - b.createdAt);
  }

  async addSticker(
    packId: string,
    input: { name: string; fileName: string },
  ): Promise<{ sticker?: Sticker; error?: string }> {
    const err = validateStickerName(input.name);
    if (err) return { error: err };
    if (!input.fileName) return { error: "no-file" };
    const data = await this.load();
    const pack =
      data.packs.find((p) => p.id === packId) ?? (packId === AI_PACK_ID ? aiPackSeed() : null);
    if (!pack) return { error: "pack-not-found" };
    const count = data.stickers.filter((s) => s.packId === packId).length;
    if (count >= MAX_STICKERS_PER_PACK) return { error: "pack-full" };
    const sticker: Sticker = {
      id: newStickerId(),
      packId,
      name: input.name.trim(),
      fileName: input.fileName,
      createdAt: Date.now(),
    };
    data.stickers.push(sticker);
    await this.save(data);
    return { sticker };
  }

  async removeSticker(packId: string, stickerId: string): Promise<string | null> {
    const data = await this.load();
    const idx = data.stickers.findIndex((s) => s.id === stickerId && s.packId === packId);
    if (idx < 0) return "not-found";
    data.stickers.splice(idx, 1);
    await this.save(data);
    return null;
  }

  /** Find a sticker by id across all packs (for sticker_send). */
  async getSticker(stickerId: string): Promise<Sticker | null> {
    const { stickers } = await this.load();
    return stickers.find((s) => s.id === stickerId) ?? null;
  }

  /** Per-persona toggle: may the AI send stickers in this persona's chats. Default true. */
  async isAiEnabled(personaId: string | null): Promise<boolean> {
    try {
      const v = await this.backend.getItem(AI_ENABLED_PREFIX + (personaId ?? "default"));
      return v !== "0";
    } catch {
      return true;
    }
  }

  async setAiEnabled(personaId: string | null, enabled: boolean): Promise<void> {
    const key = AI_ENABLED_PREFIX + (personaId ?? "default");
    if (enabled) await this.backend.removeItem(key);
    else await this.backend.setItem(key, "0");
  }
}
