/**
 * Cross-session agent CLI — PURE module (no React Native imports).
 *
 * D13: When the AI is working in the sandbox (or just wants a CLI feel),
 * `dudu` commands let it list, search, and read other sessions (dialogs).
 * Same data as the cross-dialog chat tools, but shaped for agent use:
 * terse, greppable, scriptable.
 *
 * This reuses the cross-dialog infrastructure (dialog registry + history).
 * The storage backend is injected (same pattern as cross-dialog.ts).
 */

import type { LocalTool } from "../api-groups/local-tools";

export interface DialogSummary {
  id: string;
  name: string;
  messageCount: number;
  updatedAt: number;
}

export interface AgentCliDeps {
  listDialogs: () => Promise<DialogSummary[]>;
  readDialog: (id: string, limit: number) => Promise<string>;
  searchDialogs: (query: string) => Promise<DialogSummary[]>;
}

export function createAgentCliTools(deps: AgentCliDeps): LocalTool[] {
  return [
    {
      name: "dudu",
      description:
        "Cross-session agent CLI. Subcommands: `list` (all dialogs), `search <query>` (find dialogs), `read <id> [--limit N]` (read another dialog's messages). For when you're working across sessions and need context from elsewhere. Reads are traced (she can see you looked).",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            enum: ["list", "search", "read"],
            description: "Subcommand.",
          },
          arg: {
            type: "string",
            description: "For search: the query. For read: the dialog id or name.",
          },
          limit: {
            type: "number",
            description: "For read: how many recent messages (default 20, max 50).",
          },
        },
        required: ["command"],
        additionalProperties: false,
      },
      run: async (args, _ctx) => {
        const command = String(args["command"] ?? "");
        const arg = String(args["arg"] ?? "").trim();
        const limit = Math.min(Number(args["limit"] ?? 20), 50);

        switch (command) {
          case "list": {
            const dialogs = await deps.listDialogs();
            if (dialogs.length === 0) return "No dialogs.";
            return dialogs
              .map((d) => `${d.id}\t${d.name}\t${d.messageCount} msgs`)
              .join("\n");
          }
          case "search": {
            if (!arg) throw new Error("dudu search: empty query");
            const hits = await deps.searchDialogs(arg);
            if (hits.length === 0) return `No dialogs matching "${arg}".`;
            return hits.map((d) => `${d.id}\t${d.name}`).join("\n");
          }
          case "read": {
            if (!arg) throw new Error("dudu read: empty dialog id");
            return deps.readDialog(arg, limit);
          }
          default:
            throw new Error(`dudu: unknown command "${command}" (list/search/read)`);
        }
      },
    },
  ];
}
