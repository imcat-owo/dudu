/**
 * App display settings AI tools — font size.
 * PURE module: no React Native imports (storage is injectable).
 */

import type { LocalTool } from "../api-groups/local-tools.js";
import { ToolError } from "../api-groups/local-tools.js";

/** Must match STORAGE_KEY in app-settings.ts */
const FONT_SIZE_STORAGE_KEY = "dudu.settings.fontSize.v1";

const VALID_OPTIONS = ["system", "small", "standard", "large"] as const;

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

export interface SettingsStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/**
 * Build the font-size tool set.
 */
export function createFontSizeTools(storage: SettingsStorage): LocalTool[] {
  return [
    {
      name: "set_font_size",
      description:
        "Change the app font size. Use when she says '字调大一点' / '字太小了' / '字调小一点'. option is system (follow OS) | small (compact, default) | standard | large. Applies on next app restart; tell her if she wants it immediately.",
      parameters: {
        type: "object",
        properties: {
          option: {
            type: "string",
            description: "system | small | standard | large — which font size to use.",
          },
        },
        required: ["option"],
        additionalProperties: false,
      },
      run: async (args) => {
        const option = strArg(args, "option").toLowerCase().trim();
        if (!(VALID_OPTIONS as readonly string[]).includes(option)) {
          throw new ToolError('option must be "system", "small", "standard", or "large".');
        }
        await storage.setItem(FONT_SIZE_STORAGE_KEY, option);
        return (
          `Font size set to ${option}. ` +
          `It applies after the app restarts — the in-app setting screen picks it up immediately if she opens it.`
        );
      },
    },
  ];
}
