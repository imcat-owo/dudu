/**
 * AI-operable sandbox tools (her global principle 2026-10-03:
 * "AI能在对话框完成，就别喊我去干").
 *
 * These LocalTools let the AI drive the sandbox from dialog:
 * - sandbox_run: run a command in the active backend's environment
 * - sandbox_containers: list environments (Docker containers / iSH guest)
 * - sandbox_container_start / sandbox_container_stop: manage them
 *
 * All sandbox operations are out-of-app (they touch her server or a VM),
 * so every tool carries capability "sandbox" and goes through the
 * authorize gate — she approves each time (or via saved preference).
 * Failures get the proactive manual note via manualId.
 */
import { type LocalTool, ToolError } from "../api-groups/local-tools";
import type { SandboxManager } from "./manager";

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  if (typeof v !== "string" || !v.trim()) throw new ToolError(`Missing "${name}".`);
  return v;
}

export function sandboxTools(manager: SandboxManager): LocalTool[] {
  const active = () => manager.activeBackend();

  return [
    {
      name: "sandbox_run",
      description:
        "Run a shell command in the active sandbox backend (her cloud Docker container or the local iSH Linux). Use this when she asks you to run code, check something on the server, or do computer work. Out-of-app: she must approve each run.",
      parameters: {
        type: "object",
        properties: {
          container: {
            type: "string",
            description:
              "Container/environment id (from sandbox_containers). Omit to use the first running one.",
          },
          command: { type: "string", description: "Shell command to run." },
        },
        required: ["command"],
      },
      capability: "sandbox",
      manualId: "sandbox",
      run: async (args, ctx) => {
        const backend = active();
        if (backend.connectionState() !== "connected") {
          throw new ToolError(
            "Sandbox is not connected. Ask her to connect it in the sandbox settings first.",
          );
        }
        const ok = await ctx.authorize({
          capability: "sandbox",
          action: `Run in sandbox: ${String(args.command).slice(0, 120)}`,
          reason: "She asked the AI to run this.",
        });
        if (!ok) throw new ToolError("She did not approve this sandbox command.");
        let envId = args.container as string | undefined;
        if (!envId) {
          const envs = await backend.listEnvironments();
          const running =
            envs.find((e) => e.status === "running" || e.status === "booted") ?? envs[0];
          if (!running) throw new ToolError("No sandbox environments available.");
          envId = running.id;
        }
        const r = await backend.runCommand(envId, strArg(args, "command"));
        const out = (r.stdout + (r.stderr ? `\n[stderr]\n${r.stderr}` : "")).slice(0, 8000);
        return `exit=${r.exitCode} (${r.durationMs}ms)\n${out}`;
      },
    },
    {
      name: "sandbox_containers",
      description:
        "List the sandbox environments (Docker containers on her cloud server, or the local iSH Linux guest). Call this before sandbox_run when you need a container id.",
      parameters: { type: "object", properties: {} },
      capability: "sandbox",
      manualId: "sandbox",
      run: async (_args, ctx) => {
        const backend = active();
        if (backend.connectionState() !== "connected") {
          throw new ToolError("Sandbox is not connected.");
        }
        const ok = await ctx.authorize({
          capability: "sandbox",
          action: "List sandbox environments",
          reason: "She asked the AI to check the sandbox.",
        });
        if (!ok) throw new ToolError("She did not approve this.");
        const envs = await backend.listEnvironments();
        if (!envs.length) return "No environments.";
        return envs
          .map((e) => `${e.id} | ${e.name} | ${e.status}${e.image ? ` | ${e.image}` : ""}`)
          .join("\n");
      },
    },
    {
      name: "sandbox_container_start",
      description: "Start a stopped Docker container on her cloud server (Backend A only).",
      parameters: {
        type: "object",
        properties: { container: { type: "string", description: "Container id." } },
        required: ["container"],
      },
      capability: "sandbox",
      manualId: "sandbox",
      run: async (args, ctx) => {
        const backend = active();
        if (backend.id !== "cloud")
          throw new ToolError("Container start/stop is only for the cloud backend.");
        if (backend.connectionState() !== "connected")
          throw new ToolError("Sandbox is not connected.");
        const ok = await ctx.authorize({
          capability: "sandbox",
          action: `Start container ${strArg(args, "container")}`,
          reason: "She asked the AI to start it.",
        });
        if (!ok) throw new ToolError("She did not approve this.");
        await backend.startEnvironment(strArg(args, "container"));
        return "Started.";
      },
    },
    {
      name: "sandbox_container_stop",
      description: "Stop a running Docker container on her cloud server (Backend A only).",
      parameters: {
        type: "object",
        properties: { container: { type: "string", description: "Container id." } },
        required: ["container"],
      },
      capability: "sandbox",
      manualId: "sandbox",
      run: async (args, ctx) => {
        const backend = active();
        if (backend.id !== "cloud")
          throw new ToolError("Container start/stop is only for the cloud backend.");
        if (backend.connectionState() !== "connected")
          throw new ToolError("Sandbox is not connected.");
        const ok = await ctx.authorize({
          capability: "sandbox",
          action: `Stop container ${strArg(args, "container")}`,
          reason: "She asked the AI to stop it.",
        });
        if (!ok) throw new ToolError("She did not approve this.");
        await backend.stopEnvironment(strArg(args, "container"));
        return "Stopped.";
      },
    },
  ];
}
