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
import { relayInstallGuideText } from "./relay-install";
import { newServerId } from "./servers";
import type { SandboxBackend, SshConfig } from "./types";

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  if (typeof v !== "string" || !v.trim()) throw new ToolError(`Missing "${name}".`);
  return v;
}

/**
 * Throw an honest, actionable error when the backend can't run commands.
 * "unavailable" means the backend's transport failed to initialize — a bug,
 * not something she can fix in settings, so say so plainly.
 */
export function requireRunnable(backend: SandboxBackend): void {
  const state = backend.connectionState();
  if (state === "connected") return;
  if (state === "unavailable") {
    throw new ToolError(
      `Sandbox backend "${backend.id}" is unavailable in this build ` +
        `(${
          backend.id === "cloud"
            ? "its relay transport failed to initialize — a bug, not a settings problem; this needs an app update to fix"
            : "the native iSH module is not bundled yet"
        }). ` +
        `Tell her honestly; do NOT ask her to connect it in settings — it cannot connect.`,
    );
  }
  throw new ToolError(
    "Sandbox is not connected. Ask her to connect it in the sandbox settings first.",
  );
}

function optStr(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v.trim() : "";
}

/**
 * D14: AI-assisted server setup. When she says "连我的云服务器", the model
 * fills in host/port/username/secret from the dialog and calls this — she
 * gets ONE confirmation popup showing the filled values (never the secret),
 * taps Allow, and the tool saves to the real server store (SecureStore, the
 * same store the settings UI writes) and connects. No more staring at four
 * naked input boxes.
 */
function sshSetupTool(manager: SandboxManager): LocalTool {
  return {
    name: "sandbox_ssh_setup",
    description:
      "Set up her cloud sandbox server from dialog. Call this when she asks to connect her cloud server (e.g. she says '连我的云服务器'): fill in host, port, username, auth type and the secret (private key PEM or password) from what she told you — ask her in chat for anything missing, NEVER guess credentials. She gets one confirmation popup showing the filled values; she taps Allow and only then the server is saved and connected. If the secret is omitted for an existing server, the saved secret is kept.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Her name for this server, e.g. '主力机'. Defaults to the host.",
        },
        host: {
          type: "string",
          description: "Server host / domain — the same domain Caddy serves for the relay.",
        },
        port: { type: "number", description: "SSH port. Defaults to 22." },
        username: { type: "string", description: "SSH username." },
        authType: {
          type: "string",
          description: '"key" (private key) or "password".',
        },
        secret: {
          type: "string",
          description:
            "Private key PEM (authType=key) or password (authType=password). Required for a new server; omit when updating to keep the saved secret.",
        },
      },
      required: ["host", "username", "authType"],
    },
    capability: "sandbox",
    manualId: "sandbox",
    run: async (args, ctx) => {
      const host = strArg(args, "host").trim();
      const username = strArg(args, "username").trim();
      const authType = args.authType === "key" || args.authType === "password" ? args.authType : "";
      if (!host) throw new ToolError('Missing "host".');
      if (!username) throw new ToolError('Missing "username".');
      if (!authType) throw new ToolError('authType must be "key" or "password".');
      const port = args.port === undefined ? 22 : Number(args.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new ToolError(`Bad port: ${String(args.port)}. Use 1-65535.`);

      await manager.init();
      // Same host = same server: update it instead of duplicating.
      const existing = manager
        .serverList()
        .find((s) => s.config.host.toLowerCase() === host.toLowerCase());
      const keepOldSecret = !!existing && existing.config.authType === authType;
      const secretText = optStr(args, "secret");
      if (!secretText && !keepOldSecret) {
        throw new ToolError(
          existing
            ? `The auth type changed for "${existing.name}" — ask her for the new ${authType === "key" ? "private key" : "password"} in chat.`
            : `A new server needs its ${authType === "key" ? "private key" : "password"} — ask her for it in chat.`,
        );
      }
      const finalSecret =
        secretText ||
        (authType === "key" ? existing?.config.privateKey : existing?.config.password) ||
        null;
      if (!finalSecret) throw new ToolError("No secret available — ask her for it in chat.");

      const config: SshConfig = {
        host,
        port,
        username,
        authType,
        privateKey: authType === "key" ? finalSecret : null,
        password: authType === "password" ? finalSecret : null,
      };
      const server = {
        id: existing?.id ?? newServerId(),
        name: optStr(args, "name") || existing?.name || host,
        config,
      };

      // Her ONE tap: the popup shows every filled value except the secret.
      const ok = await ctx.authorize({
        capability: "sandbox",
        action:
          `Save cloud server "${server.name}": ${host}:${port}, user ${username}, ` +
          `${authType === "key" ? "key" : "password"} auth` +
          (existing ? " (updates the saved server)" : ""),
        reason:
          "She asked to connect this server and the details are filled in. Allow to save and connect; tell her in chat if anything needs changing.",
      });
      if (!ok) throw new ToolError("She did not approve saving this server.");

      await manager.saveServer(server);
      await manager.setActiveServer(server.id);
      try {
        await manager.backend("cloud").connect();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Saved honestly; connect failed honestly. Relay-missing is the
        // common case — point at the real install path, not a dead end.
        const hint = msg.includes("sandbox.relay.unreachable")
          ? " The relay (传话员) isn't installed on that server yet — the install steps are shown in the sandbox settings screen, and the sandbox_relay_install_guide tool has the exact commands."
          : "";
        throw new ToolError(`Server "${server.name}" is saved, but connecting failed: ${msg}.${hint}`);
      }
      return `Server "${server.name}" (${host}:${port}) saved and connected.`;
    },
  };
}

/**
 * D18: the relay install guide as an AI tool. The relay must run ON her
 * server and only SHE can reach her server's shell — so instead of the old
 * dead-end "tell the AI" copy, the model gets the exact commands to hand
 * her (the same ones shown copyable in the settings UI).
 */
function relayInstallGuideTool(): LocalTool {
  return {
    name: "sandbox_relay_install_guide",
    description:
      "Get the step-by-step commands for installing the sandbox relay (传话员) on her server. The relay MUST be running on her server before the cloud sandbox can connect, and only SHE can reach her server's shell — the AI cannot install it for her. Call this when she asks how to install the relay, or when a connect fails with relay unreachable: walk her through the commands in chat (or point her at the copyable steps in the sandbox settings screen) and have HER run them.",
    parameters: {
      type: "object",
      properties: {
        language: {
          type: "string",
          description: '"zh" (default) or "en" — the language of the guide text.',
        },
      },
    },
    manualId: "sandbox",
    run: async (args) => relayInstallGuideText(args.language === "en" ? "en" : "zh"),
  };
}

export function sandboxTools(manager: SandboxManager): LocalTool[] {
  const active = () => manager.activeBackend();

  return [
    sshSetupTool(manager),
    relayInstallGuideTool(),
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
        requireRunnable(backend);
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
        requireRunnable(backend);
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
        requireRunnable(backend);
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
        requireRunnable(backend);
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
