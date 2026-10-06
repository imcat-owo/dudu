/**
 * 图片表情包 — app singletons and production wiring.
 *
 * expo-file-system is loaded lazily (via files.ts) so the store/tools stay
 * importable in plain node tests. The AI library pack seeds from the devil
 * mascot art (her own art, already bundled — nothing sourced from outside):
 * mascotUri() resolves each bundled devil to a URI, files.ts copies it into
 * the ai pack dir on first use. Seeding is best-effort: if the bundle can't
 * be read, the AI pack simply starts empty for her to fill later.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { MASCOT_COUNT } from "../mascot";
import { mascotUri } from "../mascot-assets";
import {
  addStickerFile,
  copyForSend as copyForSendFile,
  stickerFileUri as packStickerUri,
} from "./files";
import { StickerStore, type StickerStoreBackend } from "./store";
import { createStickerTools, type StickerToolEnv } from "./tools";
import { AI_PACK_ID } from "./types";

const asyncBackend: StickerStoreBackend = {
  getItem: (k) => AsyncStorage.getItem(k),
  setItem: (k, v) => AsyncStorage.setItem(k, v),
  removeItem: (k) => AsyncStorage.removeItem(k),
};

export const stickerStore = new StickerStore(asyncBackend);

let aiSeeded = false;

/** Seed the AI library pack from the devil mascot art (once per launch). */
export async function ensureAiPackSeeded(): Promise<void> {
  if (aiSeeded) return;
  aiSeeded = true;
  try {
    const existing = await stickerStore.listStickers(AI_PACK_ID);
    if (existing.length > 0) return;
    for (let i = 0; i < MASCOT_COUNT; i++) {
      const uri = mascotUri(i);
      if (!uri) continue;
      try {
        const fileName = await addStickerFile(AI_PACK_ID, uri);
        await stickerStore.addSticker(AI_PACK_ID, {
          name: `devil-${String(i + 1).padStart(2, "0")}`,
          fileName,
        });
      } catch {
        // One bad asset must not stop the rest.
      }
    }
  } catch {
    // Seeding is best-effort: the AI pack starts empty, she fills it later.
  }
}

const productionEnv: StickerToolEnv = {
  listAll: async () => {
    await ensureAiPackSeeded();
    const packs = await stickerStore.listPacks();
    return Promise.all(
      packs.map(async (pack) => ({
        pack,
        stickers: await stickerStore.listStickers(pack.id),
      })),
    );
  },
  stickerFileUri: (packId, fileName) => packStickerUri(packId, fileName),
  copyForSend: (srcUri) => copyForSendFile(srcUri),
  // Resolved per tool call (never captured at construction) so a persona
  // switch mid-session takes effect immediately — same rule as
  // currentPersonaId() in local-agent.ts. Lazy import avoids any
  // module-cycle risk with the persona stores.
  isAiEnabled: async () => {
    try {
      const { personaStore } = await import("../persona/stores");
      const id = await personaStore.getActiveId().catch(() => null);
      return stickerStore.isAiEnabled(id);
    } catch {
      return true;
    }
  },
};

/** Production AI-tool set for local-agent wiring. */
export function createProductionStickerTools() {
  return createStickerTools(productionEnv);
}
