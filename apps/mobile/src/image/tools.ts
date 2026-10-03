/**
 * AI image generation tools — let the AI draw on its own ("画个logo").
 * PURE module: no React Native / expo imports.
 *
 * Uses Pollinations.ai (free, no API key) via buildImageUrl — the same
 * backend as the /img user command. Display follows the /img convention:
 * the AI outputs the encodeImageMessage JSON as its message content and
 * chat.tsx renders it as an image bubble.
 *
 * Tool naming follows the existing local-tools convention (snake_case,
 * human-language descriptions written FOR the AI).
 */

import { type LocalTool, ToolError } from "../api-groups/local-tools.js";
import { buildImageUrl, encodeImageMessage } from "./protocol.js";

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

/**
 * Build the AI image tool set. No store needed — generation is stateless.
 */
export function createImageTools(): LocalTool[] {
  return [
    {
      name: "generate_image",
      description:
        "Generate an image from a text prompt (free, no API key needed). Use when she asks you to draw, make, or create an image — or when a picture would genuinely delight her in the moment. Write the prompt in English and be specific: subject, style, colors, composition, mood. The optional style hint is appended to the prompt (e.g. 'cute chibi style, soft pastel colors'). IMPORTANT — showing it to her: after calling, output EXACTLY the image_message JSON from the result as your entire next message (no other text, no code fences). It renders as an image bubble in chat. To iterate on a picture (\"把刚才那张改成蓝色的\"), call generate_image again with the FULL refined prompt — describe the whole image again with the change applied, never just the delta.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description:
              "Detailed image prompt in English. Be specific: subject, style, colors, composition, mood.",
          },
          style: {
            type: "string",
            description:
              "Optional style hint appended to the prompt, e.g. 'cute chibi style, soft pastel colors' or 'minimalist line art'.",
          },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
      manualId: "media",
      run: async (args) => {
        const prompt = strArg(args, "prompt").trim();
        if (!prompt) throw new ToolError("prompt is required.");
        const style = strArg(args, "style").trim();
        const fullPrompt = style ? `${prompt}, ${style}` : prompt;
        const url = buildImageUrl(fullPrompt);
        const encoded = encodeImageMessage(url, fullPrompt);
        return (
          `Image generated for prompt: "${prompt}"\n` +
          `To show it to her, output EXACTLY the following as your entire next message (no other text, no code fences):\n` +
          `${encoded}\n\n` +
          `To iterate (e.g. she says "改成蓝色的"): call generate_image again with the FULL refined prompt — ` +
          `describe the complete image again with the change applied, not just the delta.`
        );
      },
    },
  ];
}
