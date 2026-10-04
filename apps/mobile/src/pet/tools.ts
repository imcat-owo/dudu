/**
 * Pet tools — let the AI change the desktop pet's skin when she asks.
 *
 * PURE, no React Native imports.
 */

import type { LocalTool } from "../api-groups/local-tools.js";
import { ToolError } from "../api-groups/local-tools.js";

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

/** Must match PET_STORAGE_KEY in pet/store.ts */
const PET_STORAGE_KEY = "dudu.pet.v1.state";

export interface PetStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export type PetSkin =
  | { kind: "sora" }
  | { kind: "devil"; index: number }
  | { kind: "custom"; imageUri: string };

/**
 * Callback the UI layer registers to apply skin changes immediately
 * via petStore.setSkin() (which updates React state + persists + emits).
 * Falls back to direct storage write when no handler is registered.
 */
type PetSkinHandler = (skin: PetSkin) => Promise<void>;

let skinHandler: PetSkinHandler | null = null;

/** UI layer (pet provider) calls this once to wire immediate apply. */
export function registerPetSkinHandler(h: PetSkinHandler): void {
  skinHandler = h;
}

/**
 * Build the pet skin tool set — change the desktop pet's skin on request.
 */
export function createPetSkinTools(storage: PetStorage): LocalTool[] {
  return [
    {
      name: "set_pet_skin",
      description:
        "Change the desktop pet's skin. Use when she says '换个小恶魔皮肤' / '换回穹妹' / '桌宠换个皮肤'. skin is: 'sora' (default Sora), 'devil:N' (devil sticker 0-9, e.g. 'devil:3'), or 'custom:URI' (her own image).",
      parameters: {
        type: "object",
        properties: {
          skin: {
            type: "string",
            description: "'sora' | 'devil:0'-'devil:9' | 'custom:<image-uri>' — which skin to use.",
          },
        },
        required: ["skin"],
        additionalProperties: false,
      },
      manualId: "pet",
      run: async (args) => {
        const raw = strArg(args, "skin").trim();
        let skin: PetSkin;
        if (raw === "sora") {
          skin = { kind: "sora" };
        } else if (raw.startsWith("devil:")) {
          const index = parseInt(raw.slice(6), 10);
          if (!Number.isInteger(index) || index < 0 || index > 9) {
            throw new ToolError('devil skin index must be 0-9, e.g. "devil:3".');
          }
          skin = { kind: "devil", index };
        } else if (raw.startsWith("custom:")) {
          const uri = raw.slice(7).trim();
          if (!uri) throw new ToolError('custom skin needs a URI, e.g. "custom:https://..."');
          skin = { kind: "custom", imageUri: uri };
        } else {
          throw new ToolError('skin must be "sora", "devil:0"-"devil:9", or "custom:<image-uri>".');
        }
        if (skinHandler) {
          await skinHandler(skin);
          return `Pet skin changed to ${raw}.`;
        }
        const stored = await storage.getItem(PET_STORAGE_KEY);
        let state: Record<string, unknown> = {};
        if (stored) {
          try {
            state = JSON.parse(stored) as Record<string, unknown>;
          } catch {
            state = {};
          }
        }
        state.skin = skin;
        await storage.setItem(PET_STORAGE_KEY, JSON.stringify(state));
        return `Pet skin changed to ${raw}. It applies on the next pet refresh.`;
      },
    },
  ];
}
