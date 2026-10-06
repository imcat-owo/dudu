/**
 * 用户照片涂鸦回应 (photo doodle response) — AI tool.
 *
 * photo_doodle: draw on HER photo (heart / circle / arrow / handwritten
 * note) and send it back. The tool returns an image_message envelope —
 * the AI pastes it into its reply and it renders as a real image bubble.
 *
 * Write tool (creates a PNG file) → INCOGNITO_BLOCKED_TOOLS.
 * manualId "doodle" pairs with src/manuals/doodle.ts (paper slip:
 * honesty rules for placement — only doodle what you actually saw).
 */

import type { LocalTool } from "../api-groups/local-tools";
import { ToolError } from "../api-groups/local-tools";
import { encodeImageMessage } from "../image/protocol";
import { type DoodleAction, DoodleError, describeDoodles, validateDoodleActions } from "./doodle";

export interface DoodleToolEnv {
  /**
   * Rasterize photo + doodles into a real composited image file.
   * Production: DoodleComposerHost (ViewShot). Tests: injected mock.
   */
  compose: (
    photoUri: string,
    width: number,
    height: number,
    actions: DoodleAction[],
  ) => Promise<{ uri: string }>;
  /** Resolve a photo URI's pixel size (production: Image.getSize). */
  getImageSize: (uri: string) => Promise<{ width: number; height: number }>;
}

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v.trim() : "";
}

function dimArg(args: Record<string, unknown>, name: string): number | null {
  const v = args[name];
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  return Math.min(4096, Math.round(v));
}

export function createDoodleTools(env: DoodleToolEnv): LocalTool[] {
  return [
    {
      name: "photo_doodle",
      description:
        "Doodle ON a photo SHE sent (heart / circle / arrow / handwritten note) and send it back, playful. " +
        "photoUri: the photo's URI — read it from her image_message envelope in this dialog. " +
        "actions: up to 8 doodles, coordinates 0..1 (0,0 = top-left). Place them ONLY where you actually SAW something via 识图 — " +
        "if you couldn't see the photo, say what you drew blindly, never claim you see things you don't. " +
        "Returns an image_message envelope: paste that JSON into your reply so it renders as an image bubble, " +
        "and tell her in your own words what you drew and where.",
      parameters: {
        type: "object",
        properties: {
          photoUri: {
            type: "string",
            description: "URI of her photo (from her image_message envelope).",
          },
          actions: {
            type: "array",
            description:
              "Doodles: {kind:'heart'|'circle'|'arrow'|'text', x,y (0..1), size|radius (fraction of min edge), " +
              "x1/y1/x2/y2 for arrow, text (max 40 chars), color name or #hex}.",
            items: { type: "object" },
          },
          width: { type: "number", description: "Photo width px (optional; auto-detected)." },
          height: { type: "number", description: "Photo height px (optional; auto-detected)." },
        },
        required: ["photoUri", "actions"],
      },
      manualId: "doodle",
      run: async (args) => {
        try {
          const photoUri = strArg(args, "photoUri");
          if (!photoUri)
            throw new ToolError("photoUri is required — whose photo am I doodling on?");
          let actions: DoodleAction[];
          try {
            actions = validateDoodleActions(args.actions);
          } catch (e) {
            throw new ToolError(e instanceof DoodleError ? e.message : String(e));
          }
          let width = dimArg(args, "width");
          let height = dimArg(args, "height");
          if (!width || !height) {
            try {
              const size = await env.getImageSize(photoUri);
              width = width ?? Math.min(4096, Math.max(1, Math.round(size.width)));
              height = height ?? Math.min(4096, Math.max(1, Math.round(size.height)));
            } catch {
              width = width ?? 1080;
              height = height ?? 1080;
            }
          }
          const { uri } = await env.compose(photoUri, width, height, actions);
          const drew = describeDoodles(actions);
          const prompt = `涂鸦回应：${drew.join("；")}`;
          return JSON.stringify({
            image_message: encodeImageMessage(uri, prompt),
            drew,
            note: "Paste the image_message JSON into your reply so it renders as an image bubble.",
          });
        } catch (e) {
          if (e instanceof ToolError) throw e;
          throw new ToolError(e instanceof Error ? e.message : "photo_doodle failed.");
        }
      },
    },
  ];
}
