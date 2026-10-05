/**
 * Theme/wallpaper AI tools — let the AI change the wallpaper on request.
 * PURE module: no React Native imports (storage is injectable).
 */

import type { LocalTool } from "../api-groups/local-tools";
import { ToolError } from "../api-groups/local-tools";

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
 * Callback the UI layer registers to apply theme changes immediately
 * via ThemeContext.applyBundle (which updates React state + persists).
 * Falls back to direct storage write when no handler is registered.
 */
type ThemeApplyHandler = (patch: Record<string, unknown>) => Promise<string>;

let applyHandler: ThemeApplyHandler | null = null;

/** UI layer (ThemeContext provider) calls this once to wire immediate apply. */
export function registerThemeApplyHandler(h: ThemeApplyHandler): void {
  applyHandler = h;
}

type ThemeReloadHandler = () => Promise<void>;

let reloadHandler: ThemeReloadHandler | null = null;

/** UI layer (ThemeContext provider) calls this once to wire post-restore reload. */
export function registerThemeReloadHandler(h: ThemeReloadHandler): void {
  reloadHandler = h;
}

/**
 * Ask the UI layer to re-read the theme bundle from storage (e.g. after a
 * backup restore wrote a new bundle behind the context's back).
 * Returns true when the UI actually reloaded, false when no UI is mounted
 * (the stored bundle applies on next launch).
 */
export async function requestThemeReload(): Promise<boolean> {
  if (!reloadHandler) return false;
  await reloadHandler();
  return true;
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
        const wallpaper = { uri, fit: "cover", dim: 0.35 };
        if (applyHandler) {
          const result = await applyHandler({ wallpaper });
          return result === "ok" ? "Wallpaper updated." : "Wallpaper updated (local only).";
        }
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
        bundle.wallpaper = wallpaper;
        await storage.setItem(THEME_STORAGE_KEY, JSON.stringify(bundle));
        return "Wallpaper updated. It applies on the next theme refresh.";
      },
    },
  ];
}

/**
 * Build the theme mode + AI avatar tool set.
 */
export function createThemeTools(storage: ThemeStorage): LocalTool[] {
  async function readBundle(): Promise<Record<string, unknown>> {
    const raw = await storage.getItem(THEME_STORAGE_KEY);
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  return [
    {
      name: "set_theme",
      description:
        "Switch the app theme mode. Use when she says '换成深色模式' / '换成浅色' / '跟随系统'. mode is light | dark | system.",
      parameters: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            description: "light | dark | system — which theme mode to use.",
          },
        },
        required: ["mode"],
        additionalProperties: false,
      },
      manualId: "themes",
      run: async (args) => {
        const mode = strArg(args, "mode").toLowerCase().trim();
        if (mode !== "light" && mode !== "dark" && mode !== "system") {
          throw new ToolError('mode must be "light", "dark", or "system".');
        }
        if (applyHandler) {
          const result = await applyHandler({ mode });
          return result === "ok"
            ? `Theme mode set to ${mode}.`
            : `Theme mode set to ${mode} (local only).`;
        }
        const bundle = await readBundle();
        bundle.mode = mode;
        await storage.setItem(THEME_STORAGE_KEY, JSON.stringify(bundle));
        return `Theme mode set to ${mode}. It applies on the next theme refresh.`;
      },
    },
    {
      name: "set_ai_avatar",
      description:
        "Change the AI assistant's avatar image. Use when she says '把你的头像换成这张' — uri is the image she shared or picked. Empty string resets to the default Sora avatar.",
      parameters: {
        type: "object",
        properties: {
          uri: {
            type: "string",
            description: "Image URI for the new avatar. Empty string resets to default.",
          },
        },
        required: ["uri"],
        additionalProperties: false,
      },
      manualId: "themes",
      run: async (args) => {
        const uri = strArg(args, "uri").trim();
        if (applyHandler) {
          const bundle = await readBundle();
          const avatar =
            typeof bundle.avatar === "object" && bundle.avatar !== null
              ? (bundle.avatar as Record<string, unknown>)
              : {};
          if (uri) {
            avatar.assistant = uri;
          } else {
            delete avatar.assistant;
          }
          const result = await applyHandler({ avatar });
          return uri
            ? result === "ok"
              ? "AI avatar updated."
              : "AI avatar updated (local only)."
            : "AI avatar reset to the default.";
        }
        const bundle = await readBundle();
        const avatar =
          typeof bundle.avatar === "object" && bundle.avatar !== null
            ? (bundle.avatar as Record<string, unknown>)
            : {};
        if (uri) {
          avatar.assistant = uri;
        } else {
          delete avatar.assistant;
        }
        bundle.avatar = avatar;
        await storage.setItem(THEME_STORAGE_KEY, JSON.stringify(bundle));
        return uri
          ? "AI avatar updated. It applies on the next theme refresh."
          : "AI avatar reset to the default. It applies on the next theme refresh.";
      },
    },
  ];
}
