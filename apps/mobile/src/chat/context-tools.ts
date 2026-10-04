/**
 * Context management AI tools — clear or compress the chat context.
 * PURE module: no React Native imports.
 */

import type { LocalTool } from "../api-groups/local-tools.js";
import { ToolError } from "../api-groups/local-tools.js";

export interface ContextManager {
  /** Replace all messages with the given list (empty = clear). */
  setMessages(messages: Array<{ role: string; content: string }>): void;
  /** Current messages for summarization. */
  getMessages(): Array<{ role: string; content: string }>;
}

/**
 * Build context management tools.
 */
export function createContextTools(ctx: ContextManager): LocalTool[] {
  return [
    {
      name: "clear_context",
      description:
        "Clear the entire chat context (all messages). Use when she says '清除上下文' or wants a fresh start. This cannot be undone — confirm she means it if unsure.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      run: async () => {
        ctx.setMessages([]);
        return "Context cleared. Fresh start.";
      },
    },
    {
      name: "compress_context",
      description:
        "Compress the chat context: summarize the conversation so far into key points, then replace the full history with the summary. Use when she says '压缩上下文'. The summary preserves: decisions made, preferences stated, ongoing tasks, and important facts. The summary is saved as your own note (assistant role) — never as her message. After calling, output a brief confirmation to her.",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description:
              "Your summary of the conversation so far — decisions, preferences, tasks, key facts. Write it as if briefing yourself.",
          },
        },
        required: ["summary"],
        additionalProperties: false,
      },
      run: async (args) => {
        const summary =
          typeof args.summary === "string" ? args.summary.trim() : "";
        if (!summary) throw new ToolError("summary is required.");
        ctx.setMessages([
          {
            // Assistant role, NOT user: this is the AI's own compression
            // note. A "user" role here would fabricate a message in her
            // bubble; a "system" role would be dropped from the wire and
            // the summary would be lost.
            role: "assistant",
            content: `[Context compressed. Summary of previous conversation:]\n${summary}`,
          },
        ]);
        return (
          "Context compressed. The full history was replaced with your summary, " +
          "saved as your own note. Output a brief confirmation to her."
        );
      },
    },
  ];
}
