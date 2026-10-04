/**
 * Local tool registry — MCP-style tool calling for local (direct) mode.
 *
 * PURE module: no React Native / expo imports, so it stays unit-testable
 * in plain node. Device-backed implementations (photos, location, …) are
 * injected via ToolDeps; the real wiring lives in local-agent.ts.
 *
 * Two tool kinds:
 * - in-app: full authority, no authorization needed (time, app info, …)
 * - capability: crosses the app boundary — MUST pass the authorize gate
 *   (her popup / saved preference) before executing. Fail closed: a denied
 *   or failed authorization becomes a tool ERROR returned to the model,
 *   never a silent drop.
 *
 * MCP extension point: McpToolProvider defines the interface external MCP
 * servers (stdio/SSE) will implement later. This pass does NOT implement
 * MCP transports — the registry accepts providers so they plug in cleanly.
 */

import type { AiAuthRequest } from "../ai-authorization";
import type { CapabilityId } from "../capabilities";
import { getManual, MANUALS } from "../manuals/index.js";
import appJson from "../../app.json";
import type { WireToolDef } from "./direct-transport";

/**
 * Real app version from app.json (audit round 2, AI-use P2-5): get_app_info
 * must never tell her "dev". JSON import keeps this module PURE and
 * node-testable. deps.appInfo can still override (tests, future native
 * version wiring).
 */
function readAppVersion(): string {
  const v = (appJson as { expo?: { version?: unknown } } | null)?.expo?.version;
  return typeof v === "string" && v.length > 0 ? v : "dev";
}
const APP_VERSION = readAppVersion();

/** JSON Schema (subset) for tool input parameters. */
export interface ToolParametersSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

/** OpenAI function-calling wire shape (re-exported from direct-transport). */
export type FunctionToolDef = WireToolDef;

export interface ToolContext {
  /**
   * Gate for out-of-app tools. Returns true only when SHE allows it
   * (this time or via saved preference). Never throws — implementations
   * must fail closed.
   */
  authorize: (req: AiAuthRequest) => Promise<boolean>;
}

/** Injectable device/system implementations (real ones wired in local-agent). */
export interface ToolDeps {
  now?: () => Date;
  appInfo?: () => { name: string; version: string; platform: string };
  readPhotos?: (limit: number) => Promise<Array<{ uri: string; id: string }>>;
  readLocation?: () => Promise<{ latitude: number; longitude: number }>;
  readClipboard?: () => Promise<string>;
  writeClipboard?: (text: string) => Promise<void>;
}

export interface LocalTool {
  name: string;
  /** Human-language description, written FOR the AI. */
  description: string;
  parameters: ToolParametersSchema;
  /** Set for out-of-app tools — triggers the authorize gate before run. */
  capability?: CapabilityId;
  /**
   * Manual id for the proactive note system (纸条机制): when this tool
   * FAILS, the agent appends a one-line note pointing at the manual —
   * unless the model already read it this turn.
   */
  manualId?: string;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

/** Name of the on-demand manual reader tool (also used for read-tracking). */
export const READ_MANUAL_TOOL_NAME = "read_manual";

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

function numArg(args: Record<string, unknown>, name: string, fallback: number): number {
  const v = args[name];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * Build the local tool set. deps inject the real device implementations;
 * tests pass fakes. Every tool here REALLY works — no placeholders.
 */
export function createLocalTools(deps: ToolDeps = {}): LocalTool[] {
  const now = deps.now ?? (() => new Date());
  // Default app info reads the REAL version from app.json (AI-use P2-5) —
  // the old "dev" placeholder was a lie the AI repeated to her.
  const appInfo = deps.appInfo ?? (() => ({ name: "嘟嘟", version: APP_VERSION, platform: "ios" }));

  const tools: LocalTool[] = [
    {
      name: "get_current_time",
      description:
        "Get the current date and time (device local timezone). Use when the user asks about time, dates, or scheduling.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      run: async () => {
        // Same clock as the system-prompt injection (AI-use P2-1): device
        // timezone + weekday, so prompt and tool never disagree.
        const d = now();
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        return (
          d.toLocaleString("zh-CN", {
            timeZone: tz,
            weekday: "long",
            year: "numeric",
            month: "numeric",
            day: "numeric",
            hour: "numeric",
            minute: "numeric",
            second: "numeric",
          }) + ` (${tz})`
        );
      },
    },
    {
      name: "get_app_info",
      description:
        "Get basic info about this app (name, version, platform). Use when the user asks about the app itself.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      run: async () => {
        const info = appInfo();
        return `name: ${info.name}\nversion: ${info.version}\nplatform: ${info.platform}`;
      },
    },
  ];

  // --- Capability tools: out-of-app, gated by her authorization. ---

  if (deps.readPhotos) {
    const readPhotos = deps.readPhotos;
    tools.push({
      name: "read_recent_photos",
      description:
        "Read the most recent photos from her phone photo library. Returns photo URIs and IDs. This is her private photo library — the system will ask her for permission before running.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "How many recent photos to read (1-10).",
          },
        },
        additionalProperties: false,
      },
      capability: "photos",
      manualId: "permissions",
      run: async (args, ctx) => {
        const ok = await ctx.authorize({
          capability: "photos",
          action: "读取你相册里最新的照片",
          reason: "你让 AI 看看相册里的照片",
        });
        if (!ok) throw new ToolError("She did not allow reading the photo library.");
        const limit = Math.min(10, Math.max(1, Math.round(numArg(args, "limit", 3))));
        const photos = await readPhotos(limit);
        if (photos.length === 0) return "No photos found.";
        return photos.map((p, i) => `${i + 1}. id=${p.id} uri=${p.uri}`).join("\n");
      },
    });
  }

  if (deps.readLocation) {
    const readLocation = deps.readLocation;
    tools.push({
      name: "get_current_location",
      description:
        "Get her current location (latitude and longitude). This is sensitive private data — the system will ask her for permission before running.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      capability: "location",
      manualId: "permissions",
      run: async (_args, ctx) => {
        const ok = await ctx.authorize({
          capability: "location",
          action: "获取你当前所在的位置",
          reason: "你让 AI 获取位置信息",
        });
        if (!ok) throw new ToolError("She did not allow reading the location.");
        const loc = await readLocation();
        return `latitude: ${loc.latitude}\nlongitude: ${loc.longitude}`;
      },
    });
  }

  if (deps.readClipboard) {
    const readClipboard = deps.readClipboard;
    tools.push({
      name: "read_clipboard",
      description:
        "Read the current clipboard text. The clipboard may contain sensitive info like passwords — the system will ask her for permission before running.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      capability: "clipboard",
      manualId: "permissions",
      run: async (_args, ctx) => {
        const ok = await ctx.authorize({
          capability: "clipboard",
          action: "读取剪贴板的内容",
          reason: "你让 AI 看看剪贴板里复制了什么",
        });
        if (!ok) throw new ToolError("She did not allow reading the clipboard.");
        const text = await readClipboard();
        return text ? text : "(clipboard is empty)";
      },
    });
  }

  if (deps.writeClipboard) {
    const writeClipboard = deps.writeClipboard;
    tools.push({
      name: "write_clipboard",
      description:
        "Write text to her clipboard so she can paste it elsewhere. The system will ask her for permission before running.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "The text to copy to the clipboard." },
        },
        required: ["text"],
        additionalProperties: false,
      },
      capability: "clipboard",
      manualId: "permissions",
      run: async (args, ctx) => {
        const ok = await ctx.authorize({
          capability: "clipboard",
          action: "把文字写入剪贴板",
          reason: "你让 AI 把内容复制到剪贴板",
        });
        if (!ok) throw new ToolError("She did not allow writing the clipboard.");
        const text = strArg(args, "text");
        if (!text) throw new ToolError("Missing required argument: text.");
        await writeClipboard(text);
        return "Copied to clipboard.";
      },
    });
  }

  // --- Proactive manual notes (纸条机制): on-demand manual reader. ---
  // The index lives in the system prompt; the model calls this when unsure.

  tools.push({
    name: READ_MANUAL_TOOL_NAME,
    description:
      "Read the full manual for an app feature. The system prompt lists available manuals with their ids. Call this BEFORE acting when you are unsure how a feature works. If you already know it, do not call — save the tokens.",
    parameters: {
      type: "object",
      properties: {
        manual_id: {
          type: "string",
          description: `Manual id from the manuals index (e.g. "permissions"). Available: ${MANUALS.map((m) => m.id).join(", ")}.`,
        },
      },
      required: ["manual_id"],
      additionalProperties: false,
    },
    run: async (args) => {
      const id = strArg(args, "manual_id");
      const m = getManual(id);
      if (!m) {
        throw new ToolError(
          `Unknown manual: "${id}". Available: ${MANUALS.map((mm) => mm.id).join(", ")}.`,
        );
      }
      return `# ${m.title}\n\n${m.body}`;
    },
  });

  return tools;
}

/**
 * Registry: tool definitions for the API request + execution by name.
 * Accepts extra providers (e.g. MCP servers later) — they plug in here.
 */
export interface ToolRegistry {
  /** OpenAI function-calling definitions for the chat request. */
  definitions: () => FunctionToolDef[];
  /** Execute a tool call by name. Unknown tools and auth denials throw ToolError. */
  execute: (name: string, args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
  /** All registered tool names (for logging/debugging). */
  names: () => string[];
}

export function createToolRegistry(tools: LocalTool[]): ToolRegistry {
  const byName = new Map(tools.map((t) => [t.name, t]));
  return {
    definitions: () =>
      tools.map((t) => ({
        type: "function" as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
    execute: async (name, args, ctx) => {
      const tool = byName.get(name);
      if (!tool) throw new ToolError(`Unknown tool: ${name}.`);
      return tool.run(args, ctx);
    },
    names: () => tools.map((t) => t.name),
  };
}

/**
 * MCP extension point (NOT implemented in this pass).
 *
 * An external MCP server (stdio or SSE transport) will implement this:
 * - listTools(): fetch the server's tool definitions, converted to LocalTool
 * - callTool(): route execution to the MCP server
 * The registry accepts these providers via a future `registerProvider()`.
 * Transports are deliberately out of scope here.
 */
export interface McpToolProvider {
  /** Stable provider id, e.g. the MCP server name. */
  readonly providerId: string;
  /** Fetch tool definitions from the MCP server. */
  listTools: () => Promise<LocalTool[]>;
  /** Execute a tool on the MCP server. */
  callTool: (name: string, args: Record<string, unknown>) => Promise<string>;
}
