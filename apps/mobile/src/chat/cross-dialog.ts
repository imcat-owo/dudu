/**
 * Cross-dialog read/write AI tools (AI orchestration vision, feature 2:
 * 跨对话框读写). Only the cross-dialog part — NOT the AI self-organized
 * group chat (that's feature 3, separate work).
 *
 * PURE module: no React Native imports. Storage is injectable; local-agent
 * wires AsyncStorage in production, tests pass fakes.
 *
 * What the AI gets:
 * - list_dialogs: see all dialogs (id, name, message count)
 * - read_dialog: read recent messages from another dialog (by id or name)
 * - send_to_dialog: deliver a message into another dialog
 *
 * Hard constraints (死线):
 * - 人设记忆隔离: every dialog carries a personaId. A tool call is denied
 *   when the target dialog's personaId differs from the current one.
 *   Personas don't exist as a code concept yet — today every dialog is
 *   "default", so the check never fires — but the enforcement point is
 *   real, dialog-scoped, and tested. When personas land, they partition
 *   this registry and the check starts biting.
 * - 跨对话框留痕: every list/read/send is appended to the trace store.
 *   The AI cannot act in another dialog without leaving a trace she can
 *   browse anytime.
 * - Send policy: the AI only sends when SHE explicitly asked for it, or
 *   when a coordination plan was proposed AND approved (plan gate). The
 *   tool requires a `reason` (her request, or the plan id) on every call
 *   so the trace entry is auditable. Proactive sends without either are
 *   refused by the tool description contract and visible in the trace.
 * - Incognito: a session that promised no side effects can't create them
 *   elsewhere — send_to_dialog is refused in incognito. Reads are allowed
 *   but still traced (the trace is the anti-abuse mechanism; it has no
 *   off switch).
 * - Honest failures: unknown dialog / persona mismatch / empty message
 *   are plain ToolErrors, never silent.
 */

import type { LocalTool } from "../api-groups/local-tools.js";
import { ToolError } from "../api-groups/local-tools.js";
import type { CrossDialogTraceStore, CrossDialogVisibilityStore } from "./cross-dialog-trace.js";

/** Must match historyKey() in api-groups/local-agent.ts. */
const CHAT_HISTORY_PREFIX = "dudu.local-chat.";
const CHAT_HISTORY_SUFFIX = ".v1";
/** threadId -> { name?, personaId }. */
const DIALOG_REGISTRY_KEY = "dudu.dialog-registry.v1";
/** History cap, mirroring saveLocalHistory in local-agent.ts. */
const HISTORY_CAP = 200;
/** Default persona until personas exist as a code concept. */
export const DEFAULT_PERSONA_ID = "default";

/** Minimal storage surface. AsyncStorage satisfies this in production. */
export interface CrossDialogStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
}

export interface DialogRegistryEntry {
  name?: string;
  personaId: string;
}

export interface DialogInfo {
  id: string;
  name: string;
  personaId: string;
  messageCount: number;
  /** Epoch ms of the newest message, 0 when unknown. */
  lastActiveAt: number;
  /** True when the name came from the registry (vs derived). */
  named: boolean;
}

export interface CrossDialogMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: unknown;
  /** Present on messages the AI delivered from another dialog. */
  crossDialog?: CrossDialogMarker;
}

/** Marker attached to messages the AI delivered from another dialog. */
export interface CrossDialogMarker {
  fromThreadId: string;
  fromName: string;
  at: number;
}

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

function numArg(args: Record<string, unknown>, name: string, fallback: number): number {
  const v = args[name];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function threadIdFromKey(key: string): string | null {
  if (!key.startsWith(CHAT_HISTORY_PREFIX) || !key.endsWith(CHAT_HISTORY_SUFFIX)) return null;
  const id = key.slice(CHAT_HISTORY_PREFIX.length, -CHAT_HISTORY_SUFFIX.length);
  return id ? id : null;
}

async function readRegistry(
  storage: CrossDialogStorage,
): Promise<Record<string, DialogRegistryEntry>> {
  try {
    const raw = await storage.getItem(DIALOG_REGISTRY_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Record<string, DialogRegistryEntry> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v !== "object" || v === null) continue;
      const e = v as { name?: unknown; personaId?: unknown };
      out[k] = {
        ...(typeof e.name === "string" && e.name ? { name: e.name } : {}),
        personaId:
          typeof e.personaId === "string" && e.personaId ? e.personaId : DEFAULT_PERSONA_ID,
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** Name a dialog (used by rename flows and tests). Persona-scoped. */
export async function setDialogName(
  storage: CrossDialogStorage,
  threadId: string,
  name: string,
  personaId: string = DEFAULT_PERSONA_ID,
): Promise<void> {
  const reg = await readRegistry(storage);
  const prev = reg[threadId];
  reg[threadId] = {
    ...(name.trim() ? { name: name.trim() } : {}),
    personaId: prev?.personaId ?? personaId,
  };
  await storage.setItem(DIALOG_REGISTRY_KEY, JSON.stringify(reg));
}

function isMessage(m: unknown): m is CrossDialogMessage {
  if (typeof m !== "object" || m === null) return false;
  const v = m as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    (v.role === "user" || v.role === "assistant" || v.role === "system" || v.role === "tool")
  );
}

async function loadMessages(
  storage: CrossDialogStorage,
  threadId: string,
): Promise<CrossDialogMessage[]> {
  try {
    const raw = await storage.getItem(`${CHAT_HISTORY_PREFIX}${threadId}${CHAT_HISTORY_SUFFIX}`);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMessage);
  } catch {
    return [];
  }
}

/** Fallback name when the registry has none: first user message, excerpted. */
function deriveName(messages: CrossDialogMessage[]): string | null {
  const first = messages.find(
    (m) => m.role === "user" && typeof m.content === "string" && m.content.trim(),
  );
  if (!first || typeof first.content !== "string") return null;
  const t = first.content.trim().replace(/\s+/g, " ");
  return t.length > 14 ? `${t.slice(0, 14)}…` : t;
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

/**
 * All dialogs visible to this persona. The current dialog is included
 * (reading your own history is pointless but harmless; sending to it is
 * refused by send_to_dialog with a plain error).
 */
export async function listDialogs(
  storage: CrossDialogStorage,
  personaId: string = DEFAULT_PERSONA_ID,
): Promise<DialogInfo[]> {
  const keys = await storage.getAllKeys().catch(() => [] as readonly string[]);
  const registry = await readRegistry(storage);
  const out: DialogInfo[] = [];
  for (const key of keys) {
    const id = threadIdFromKey(key);
    if (!id) continue;
    const reg = registry[id];
    const entryPersona = reg?.personaId ?? DEFAULT_PERSONA_ID;
    // 人设记忆隔离: a persona never even sees another persona's dialogs.
    if (entryPersona !== personaId) continue;
    const messages = await loadMessages(storage, id);
    const named = !!reg?.name;
    out.push({
      id,
      name: reg?.name ?? deriveName(messages) ?? `未命名对话 ${shortId(id)}`,
      personaId: entryPersona,
      messageCount: messages.length,
      lastActiveAt: 0,
      named,
    });
  }
  out.sort((a, b) => b.messageCount - a.messageCount);
  return out;
}

/**
 * Resolve a dialog by id or name. Honest failures: unknown ref, ambiguous
 * name, or persona mismatch all throw ToolError with a plain message —
 * never a guess.
 */
export async function resolveDialog(
  storage: CrossDialogStorage,
  ref: string,
  personaId: string = DEFAULT_PERSONA_ID,
): Promise<DialogInfo> {
  const needle = ref.trim();
  if (!needle) throw new ToolError("Tell me which dialog — by name or id.");
  const lower = needle.toLowerCase();
  // Persona isolation, explicit and first: the dialog exists but belongs to
  // a different persona — the AI must not touch it, and must say so plainly.
  // (Checked before the empty-list shortcut so the denial is never masked.)
  const allKeys = await storage.getAllKeys().catch(() => [] as readonly string[]);
  const registry = await readRegistry(storage);
  for (const key of allKeys) {
    const id = threadIdFromKey(key);
    if (!id) continue;
    if (id === needle || (registry[id]?.name ?? "").toLowerCase() === lower) {
      const entryPersona = registry[id]?.personaId ?? DEFAULT_PERSONA_ID;
      if (entryPersona !== personaId) {
        throw new ToolError(
          "That dialog belongs to a different persona — I can't read it or send to it. Persona data never crosses over.",
        );
      }
    }
  }
  const dialogs = await listDialogs(storage, personaId);
  if (dialogs.length === 0) throw new ToolError("There are no other dialogs yet.");
  const exactId = dialogs.find((d) => d.id === needle);
  if (exactId) return exactId;
  const exactName = dialogs.filter((d) => d.name.toLowerCase() === lower);
  if (exactName.length === 1) return exactName[0];
  const partial = dialogs.filter((d) => d.name.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new ToolError(
      `"${needle}" matches more than one dialog: ${partial.map((d) => `"${d.name}"`).join(", ")}. Which one?`,
    );
  }
  throw new ToolError(`No dialog matches "${needle}". Use list_dialogs to see what's there.`);
}

function textOf(content: unknown): string {
  if (typeof content === "string") {
    // Keep the read view honest but compact: media envelopes become labels.
    if (content.includes('"type":"voice_message"') || content.includes('"type": "voice_message"'))
      return "[语音消息]";
    if (content.includes('"type":"image_message"') || content.includes('"type": "image_message"'))
      return "[图片消息]";
    return content;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const b of content) {
      if (typeof b === "object" && b !== null && (b as { type?: unknown }).type === "text") {
        const t = (b as { text?: unknown }).text;
        if (typeof t === "string") parts.push(t);
      } else {
        parts.push("[非文本内容]");
      }
    }
    return parts.join("\n");
  }
  return "";
}

export interface ReadDialogResult {
  dialog: DialogInfo;
  messages: Array<{ role: "user" | "assistant"; text: string }>;
}

/** Last N user/assistant messages, oldest first. Tool chatter excluded. */
export async function readDialog(
  storage: CrossDialogStorage,
  threadId: string,
  limit = 20,
): Promise<ReadDialogResult["messages"]> {
  const all = await loadMessages(storage, threadId);
  const convo = all.filter((m) => m.role === "user" || m.role === "assistant");
  const slice = convo.slice(-Math.max(1, Math.min(50, limit)));
  return slice.map((m) => ({
    role: m.role as "user" | "assistant",
    text: textOf(m.content),
  }));
}

/**
 * Deliver a message into another dialog's history. The message carries a
 * crossDialog marker so the chat UI can show where it came from. Returns
 * whether the target dialog currently wants the visible source tag.
 */
export async function sendToDialog(
  storage: CrossDialogStorage,
  threadId: string,
  text: string,
  marker: CrossDialogMarker,
  isSendTagVisible: (threadId: string) => Promise<boolean>,
): Promise<{ tagVisible: boolean }> {
  const clean = text.trim();
  if (!clean) throw new ToolError("I can't send an empty message.");
  const messages = await loadMessages(storage, threadId);
  const tagVisible = await isSendTagVisible(threadId);
  messages.push({
    id: `cdm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    role: "assistant",
    content: clean,
    // The marker survives loadLocalHistory's filter (it only checks
    // id/role) and the agent persists messages as-is — so the tag renders
    // when she opens the dialog.
    ...(tagVisible ? { crossDialog: marker } : {}),
  });
  const capped = messages.slice(-HISTORY_CAP);
  await storage.setItem(
    `${CHAT_HISTORY_PREFIX}${threadId}${CHAT_HISTORY_SUFFIX}`,
    JSON.stringify(capped),
  );
  return { tagVisible };
}

export interface CrossDialogToolOpts {
  /** The dialog the AI is currently talking in. */
  threadId: string;
  personaId?: string;
  storage: CrossDialogStorage;
  trace: CrossDialogTraceStore;
  visibility: CrossDialogVisibilityStore;
  /** When true, the session promised no side effects: sends are refused. */
  isIncognito?: () => boolean;
}

function formatDialogList(dialogs: DialogInfo[], currentId: string): string {
  if (dialogs.length === 0) return "No dialogs yet.";
  const lines = dialogs.map((d) => {
    const here = d.id === currentId ? " (you're here)" : "";
    return `- ${d.name} — id ${d.id}, ${d.messageCount} messages${here}`;
  });
  return `Dialogs (${dialogs.length}):\n${lines.join("\n")}`;
}

/**
 * Build the three cross-dialog tools. Pass the current thread id so the
 * tools know which dialog the AI is talking in (for the trace + the
 * "don't send to yourself" guard).
 */
export function createCrossDialogTools(opts: CrossDialogToolOpts): LocalTool[] {
  const personaId = opts.personaId ?? DEFAULT_PERSONA_ID;
  const storage = opts.storage;
  const incognito = () => opts.isIncognito?.() === true;

  async function traceFromName(): Promise<string> {
    const dialogs = await listDialogs(storage, personaId);
    return dialogs.find((d) => d.id === opts.threadId)?.name ?? `对话 ${shortId(opts.threadId)}`;
  }

  return [
    {
      name: "list_dialogs",
      description:
        "List her chat dialogs (name, id, message count). Use when she says '有哪些对话框' / '看看其他聊天' / when you need a dialog id or name before reading or sending across dialogs.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "cross-dialog",
      run: async () => {
        const dialogs = await listDialogs(storage, personaId);
        const fromName = await traceFromName();
        await opts.trace.append({
          action: "list",
          fromThreadId: opts.threadId,
          fromName,
          summary: `viewed dialog list (${dialogs.length} dialogs)`,
          reason: "dialog discovery",
          personaId,
        });
        return formatDialogList(dialogs, opts.threadId);
      },
    },
    {
      name: "read_dialog",
      description:
        "Read recent messages from ANOTHER dialog, by name or id (see list_dialogs). Use when she asks '那个对话框里聊了什么' / '帮我看看那边的聊天'. Every read is recorded in the cross-dialog trace she can browse — never read around her back.",
      parameters: {
        type: "object",
        properties: {
          dialog: {
            type: "string",
            description: "Dialog name or id. Partial names work when unambiguous.",
          },
          limit: {
            type: "number",
            description: "How many recent messages to read (default 20, max 50).",
          },
          reason: {
            type: "string",
            description: "Optional: why you're reading (goes into her trace log).",
          },
        },
        required: ["dialog"],
        additionalProperties: false,
      },
      manualId: "cross-dialog",
      run: async (args) => {
        const ref = strArg(args, "dialog");
        const limit = numArg(args, "limit", 20);
        const dialog = await resolveDialog(storage, ref, personaId);
        const messages = await readDialog(storage, dialog.id, limit);
        const fromName = await traceFromName();
        await opts.trace.append({
          action: "read",
          fromThreadId: opts.threadId,
          fromName,
          toThreadId: dialog.id,
          toName: dialog.name,
          summary: `read ${messages.length} messages from "${dialog.name}"`,
          reason: strArg(args, "reason") || "her request",
          personaId,
        });
        if (messages.length === 0) return `Dialog "${dialog.name}" has no messages yet.`;
        const lines = messages.map((m) => `${m.role === "user" ? "她" : "嘟嘟"}：${m.text}`);
        return `Latest ${messages.length} messages in "${dialog.name}":\n${lines.join("\n")}`;
      },
    },
    {
      name: "send_to_dialog",
      description:
        "Deliver a message INTO another dialog (by name or id). The message appears there as your reply, tagged with which dialog it came from (tag visibility is her setting; the trace log always records the send either way). " +
        "RULES — follow them exactly: (1) Only send when SHE explicitly asked you to pass something along (e.g. '跟那个对话框说一声…'), OR when a coordination plan covering this send was proposed AND approved — never send on your own initiative without one of those. " +
        "(2) `reason` is required: say plainly why you're sending (her words, or the plan id). " +
        "(3) One message per call, keep it short, in your own voice. " +
        "(4) Refused in incognito sessions and when the target is the dialog you're already in.",
      parameters: {
        type: "object",
        properties: {
          dialog: {
            type: "string",
            description: "Target dialog name or id (see list_dialogs).",
          },
          message: { type: "string", description: "The message to deliver." },
          reason: {
            type: "string",
            description:
              "REQUIRED: why you're sending this — her explicit request (quote it briefly) or the approved plan id.",
          },
        },
        required: ["dialog", "message", "reason"],
        additionalProperties: false,
      },
      manualId: "cross-dialog",
      run: async (args) => {
        if (incognito()) {
          throw new ToolError(
            "This session is incognito — it promised no side effects, so I can't deliver messages into other dialogs from here.",
          );
        }
        const ref = strArg(args, "dialog");
        const message = strArg(args, "message");
        const reason = strArg(args, "reason").trim();
        if (!reason) {
          throw new ToolError(
            "send_to_dialog needs a reason — whose request or which approved plan is this send for?",
          );
        }
        if (!message.trim()) throw new ToolError("I can't send an empty message.");
        const dialog = await resolveDialog(storage, ref, personaId);
        if (dialog.id === opts.threadId) {
          throw new ToolError(
            "That's the dialog you're already talking in — just reply to her directly.",
          );
        }
        const fromName = await traceFromName();
        const summary =
          message.trim().length > 120 ? `${message.trim().slice(0, 120)}…` : message.trim();
        // Trace FIRST, then send: if trace storage fails, the send never
        // happens — there is no path where a message lands in another
        // dialog without a trace entry. (If the send itself fails after,
        // the entry stands as an auditable attempted send with its reason.)
        await opts.trace.append({
          action: "send",
          fromThreadId: opts.threadId,
          fromName,
          toThreadId: dialog.id,
          toName: dialog.name,
          summary,
          reason,
          personaId,
        });
        const { tagVisible } = await sendToDialog(
          storage,
          dialog.id,
          message,
          { fromThreadId: opts.threadId, fromName, at: Date.now() },
          (id) => opts.visibility.isSendTagVisible(id),
        );
        return tagVisible
          ? `Delivered to "${dialog.name}" — it shows there tagged as coming from "${fromName}", and the send is in her trace log.`
          : `Delivered to "${dialog.name}" — she turned off the in-dialog source tag for it, so it lands quietly, but the send is still recorded in her trace log.`;
      },
    },
  ];
}
