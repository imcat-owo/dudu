/**
 * Theme/wallpaper AI tools — let the AI change the wallpaper on request.
 * PURE module: no React Native imports (storage is injectable).
 */

import type { LocalTool } from "../api-groups/local-tools.js";
import { ToolError } from "../api-groups/local-tools.js";
/** Must match THEME_STORAGE_KEY in ThemeContext.tsx */
const THEME_STORAGE_KEY = "dudu.theme.bundle.v1";

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

export interface ThemeStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/**
 * Build the wallpaper tool set.
 */
export function createWallpaperTools(storage: ThemeStorage): LocalTool[] {
  return [
    {
      name: "set_wallpaper",
      description:
        "Set the app wallpaper to an image. Use when she says '帮我把这张图片变成壁纸' or asks to change the wallpaper. uri is the image URI (from a photo she shared in chat, or an image you generated). The wallpaper applies immediately.",
      parameters: {
        type: "object",
        properties: {
          uri: {
            type: "string",
            description: "Image URI (mp4 not supported, must be an image).",
          },
        },
        required: ["uri"],
        additionalProperties: false,
      },
      manualId: "themes",
      run: async (args) => {
        const uri = strArg(args, "uri").trim();
        if (!uri) throw new ToolError("uri is required.");
        // Read current bundle, update wallpaper, write back.
        const raw = await storage.getItem(THEME_STORAGE_KEY);
        let bundle: Record<string, unknown> = {};
        if (raw) {
          try {
            bundle = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            bundle = {};
          }
        }
        bundle.wallpaper = { uri, fit: "cover", dim: 0.35 };
        await storage.setItem(THEME_STORAGE_KEY, JSON.stringify(bundle));
        return "Wallpaper updated. It applies on the next theme refresh.";
      },
    },
  ];
}
