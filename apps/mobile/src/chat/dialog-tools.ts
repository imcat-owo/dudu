/**
 * Dialog management AI tools — open a new chat dialog on request.
 * PURE module: no React Native imports. Navigation is done through an
 * injected callback registered by the UI layer (threads.tsx).
 */

import type { LocalTool } from "../api-groups/local-tools.js";

/** Callback the UI registers to actually open a new dialog. */
type NewDialogHandler = () => void;

let handler: NewDialogHandler | null = null;

/**
 * UI layer calls this once at startup to wire real navigation.
 */
export function registerNewDialogHandler(h: NewDialogHandler): void {
  handler = h;
}

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

/**
 * Build the dialog tool set.
 */
export function createDialogTools(): LocalTool[] {
  return [
    {
      name: "new_dialog",
      description:
        "Open a fresh new chat dialog. Use when she says '开个新对话框' / '我们换个话题聊' / '新开一个聊天'. Optionally give it a title so she can find it later in the thread list.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Optional title for the new dialog, e.g. '旅行计划'.",
          },
        },
        additionalProperties: false,
      },
      run: async (args) => {
        const title = strArg(args, "title").trim();
        if (handler) {
          handler();
          return title ? `New dialog opened${title ? ` (“${title}”)` : ""}.` : "New dialog opened.";
        }
        return (
          "I can't open a new dialog from here right now — " + "ask her to tap the new-chat button."
        );
      },
    },
  ];
}
