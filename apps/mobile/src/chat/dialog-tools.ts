/**
 * Dialog management AI tools — open a new chat dialog on request.
 * PURE module: no React Native imports. Navigation is done through an
 * injected callback registered by the UI layer (threads.tsx).
 */

import type { LocalTool } from "../api-groups/local-tools";
import { ToolError } from "../api-groups/local-tools";

/** Callback the UI registers to actually open a new dialog. */
type NewDialogHandler = (title?: string) => void;

/** Callback the UI registers to rename a dialog thread. */
type RenameDialogHandler = (threadId: string, name: string) => Promise<void>;

let handler: NewDialogHandler | null = null;
let renameHandler: RenameDialogHandler | null = null;

/**
 * UI layer calls this once at startup to wire real navigation.
 */
export function registerNewDialogHandler(h: NewDialogHandler): void {
  handler = h;
}

/**
 * UI layer calls this once at startup to wire real thread renaming.
 */
export function registerRenameDialogHandler(h: RenameDialogHandler): void {
  renameHandler = h;
}

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

/**
 * Build the dialog tool set.
 * Pass the current thread id so rename_dialog defaults to the dialog
 * the AI is actually talking in.
 */
export function createDialogTools(opts?: { threadId?: string }): LocalTool[] {
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
          handler(title || undefined);
          return "New dialog opened.";
        }
        return (
          "I can't open a new dialog from here right now — " + "ask her to tap the new-chat button."
        );
      },
    },
    {
      name: "rename_dialog",
      description:
        "Rename a chat dialog in her thread list. Use when she says '把这个对话框改名叫…' / '给这个聊天起个名字'. Defaults to the dialog you're currently talking in — only pass thread_id to rename a different one.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The new title, e.g. '旅行计划'. Keep it short.",
          },
          thread_id: {
            type: "string",
            description:
              "Optional: rename a different dialog by id. Omit to rename the current dialog.",
          },
        },
        required: ["name"],
        additionalProperties: false,
      },
      run: async (args) => {
        const name = strArg(args, "name").trim();
        if (!name)
          throw new ToolError("rename_dialog needs a name — what should the dialog be called?");
        const threadId = strArg(args, "thread_id").trim() || opts?.threadId;
        if (!threadId) {
          return "I don't know which dialog to rename — ask her which one she means.";
        }
        if (!renameHandler) {
          return (
            "I can't rename dialogs from here right now — " +
            "ask her to long-press the dialog in the thread list."
          );
        }
        await renameHandler(threadId, name);
        return `Dialog renamed to "${name}".`;
      },
    },
  ];
}
