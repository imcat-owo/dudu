/**
 * Interactive terminal tools — PURE module (no React Native imports).
 *
 * D14: A real terminal, not just run-to-completion. ssh, vi, password
 * prompts — the AI can hold a conversation with a shell.
 *
 * Sessions are managed here (id → shell handle). The sandbox backend
 * provides the actual shell via SshTransport.shell() (Backend A) or the
 * iSH channel (Backend B). If the backend can't do interactive shells,
 * the tools fail honestly.
 */

import { type LocalTool, ToolError } from "../api-groups/local-tools";
import { requireRunnable } from "./sandbox-tools";
import type { SandboxBackend } from "./types";

interface ShellSession {
  id: string;
  write: (data: string) => void;
  close: () => void;
  /** Buffered output since last read. */
  buffer: string;
  createdAt: number;
}

const sessions = new Map<string, ShellSession>();
let seq = 0;

function getSession(id: string): ShellSession {
  const s = sessions.get(id);
  if (!s) throw new Error(`No shell session "${id}". Open one with sandbox_shell_open first.`);
  return s;
}

export function createInteractiveTerminalTools(
  getBackend: () => SandboxBackend | null,
): LocalTool[] {
  return [
    {
      name: "sandbox_shell_open",
      description:
        "Open an interactive shell session (real terminal: ssh, vi, password prompts work). Returns a session id. Use sandbox_shell_write to send input and sandbox_shell_read to get output. For one-shot commands, use sandbox_run instead.",
      parameters: {
        type: "object",
        properties: {
          container: {
            type: "string",
            description: "Container/environment id (optional, uses the default).",
          },
        },
        additionalProperties: false,
      },
      capability: "sandbox",
      manualId: "sandbox",
      run: async (args, ctx) => {
        const backend = getBackend();
        if (!backend) throw new Error("Sandbox backend not available.");
        requireRunnable(backend);
        const ok = await ctx.authorize({
          capability: "sandbox",
          action: "Open an interactive shell session",
          reason: "She asked the AI to work in the terminal.",
        });
        if (!ok) throw new ToolError("She did not approve this.");
        const container = (args.container as string) || undefined;

        // The backend exposes an interactive shell via its transport.
        // We use a dynamic access pattern to avoid coupling to internals.
        // The session id is created FIRST so output has somewhere to land
        // from the very first chunk.
        const id = `sh_${Date.now()}_${++seq}`;
        const shell = await (
          backend as unknown as {
            openShell?: (
              container?: string,
              onData?: (chunk: string) => void,
            ) => Promise<{
              write: (data: string) => void;
              close: () => void;
            }>;
          }
        ).openShell?.(container, (chunk) => __pushShellOutput(id, chunk));

        if (!shell) {
          throw new Error(
            "This sandbox backend doesn't support interactive shells. Use sandbox_run for one-shot commands.",
          );
        }

        const session: ShellSession = {
          id,
          write: shell.write,
          close: shell.close,
          buffer: "",
          createdAt: Date.now(),
        };
        sessions.set(id, session);

        return JSON.stringify({ sessionId: id });
      },
    },
    {
      name: "sandbox_shell_write",
      description:
        "Send input to an interactive shell session (stdin). Include the trailing newline for Enter. For passwords, just send the text — it won't be echoed back.",
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          input: { type: "string", description: "Text to send (include \\n for Enter)." },
        },
        required: ["sessionId", "input"],
        additionalProperties: false,
      },
      run: async (args, _ctx) => {
        const s = getSession(String(args.sessionId));
        s.write(String(args.input ?? ""));
        return "Sent.";
      },
    },
    {
      name: "sandbox_shell_read",
      description:
        "Read new output from an interactive shell session since the last read. Poll this after writing input.",
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          timeoutMs: {
            type: "number",
            description: "How long to wait for output (default 2000, max 10000).",
          },
        },
        required: ["sessionId"],
        additionalProperties: false,
      },
      run: async (args, _ctx) => {
        const s = getSession(String(args.sessionId));
        const timeoutMs = Math.min(Number(args.timeoutMs ?? 2000), 10000);
        // The backend streams into session.buffer via its onData callback.
        // Wait briefly for output to arrive.
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (s.buffer.length > 0) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        const out = s.buffer;
        s.buffer = "";
        return out || "(no new output)";
      },
    },
    {
      name: "sandbox_shell_close",
      description: "Close an interactive shell session.",
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
        },
        required: ["sessionId"],
        additionalProperties: false,
      },
      run: async (args, _ctx) => {
        const id = String(args.sessionId);
        const s = sessions.get(id);
        if (s) {
          s.close();
          sessions.delete(id);
        }
        return "Closed.";
      },
    },
  ];
}

/** Called by the backend to push output into a session buffer. */
export function __pushShellOutput(sessionId: string, chunk: string): void {
  const s = sessions.get(sessionId);
  if (s) {
    s.buffer += chunk;
    // Cap the buffer to avoid unbounded growth.
    if (s.buffer.length > 100000) s.buffer = s.buffer.slice(-100000);
  }
}

/** For tests. */
export function __clearShellSessions(): void {
  sessions.clear();
}
