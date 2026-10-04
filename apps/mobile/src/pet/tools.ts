/**
 * Pet interaction video tools — let the AI swap the desktop pet's
 * interaction videos (pinch/headpat/headphones/reach) when she asks.
 *
 * Same pattern as task-buddy-video tools: thin wrapper around
 * PetInteractionVideoStore, PURE, no React Native imports.
 */

import type { LocalTool } from "../api-groups/local-tools.js";
import { ToolError } from "../api-groups/local-tools.js";
import {
  PET_INTERACTIONS,
  type PetInteraction,
  type PetInteractionVideoStore,
} from "./interactions.js";

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

/**
 * Build the pet interaction video tool set bound to a store instance.
 */
export function createPetInteractionVideoTools(videoStore: PetInteractionVideoStore): LocalTool[] {
  return [
    {
      name: "pet_interaction_set_video",
      description:
        "Set a custom video animation for the desktop pet's touch interactions. interaction is pinch (dragging = cheek pinch) | headpat (double-tap) | headphones (music playing) | reach (long-press hand touch). uri is a video URI she gave you (e.g. from her uploads); empty string resets to the bundled default.",
      parameters: {
        type: "object",
        properties: {
          interaction: {
            type: "string",
            description:
              "pinch | headpat | headphones | reach — which touch interaction this video plays for.",
          },
          uri: {
            type: "string",
            description: "Video URI (mp4). Empty string resets to the bundled default clip.",
          },
        },
        required: ["interaction"],
        additionalProperties: false,
      },
      manualId: "pet",
      run: async (args) => {
        const raw = strArg(args, "interaction").toLowerCase() as PetInteraction;
        if (!(PET_INTERACTIONS as readonly string[]).includes(raw)) {
          throw new ToolError('interaction must be "pinch", "headpat", "headphones", or "reach".');
        }
        const uri = strArg(args, "uri");
        await videoStore.set(raw, uri || null);
        return uri
          ? `Pet interaction video for "${raw}" set to her custom video.`
          : `Pet interaction video for "${raw}" reset to the bundled default.`;
      },
    },
  ];
}

/** Must match PET_STORAGE_KEY in pet/store.ts */
const PET_STORAGE_KEY = "dudu.pet.v1.state";

export interface PetStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

type PetSkin =
  | { kind: "sora" }
  | { kind: "devil"; index: number }
  | { kind: "custom"; imageUri: string };

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
