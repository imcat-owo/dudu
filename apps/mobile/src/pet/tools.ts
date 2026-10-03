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
export function createPetInteractionVideoTools(
  videoStore: PetInteractionVideoStore,
): LocalTool[] {
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
            description:
              "Video URI (mp4). Empty string resets to the bundled default clip.",
          },
        },
        required: ["interaction"],
        additionalProperties: false,
      },
      manualId: "pet",
      run: async (args) => {
        const raw = strArg(args, "interaction").toLowerCase() as PetInteraction;
        if (!(PET_INTERACTIONS as readonly string[]).includes(raw)) {
          throw new ToolError(
            'interaction must be "pinch", "headpat", "headphones", or "reach".',
          );
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
