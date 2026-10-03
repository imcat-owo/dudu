/**
 * Activity drawer data model — PURE, no React Native imports, unit-testable
 * in plain node.
 *
 * The drawer is a unified thinking + tool-call view (her v2 design,
 * 2026-10-03, verified against the real Claude app):
 * - thinking only (no tools) -> the full thinking text
 * - with tools -> an action list; tapping an action pushes a detail page
 *   (title centered, status below, named inputs, full output, never folded)
 *
 * Tool calls arrive from cloud mode (CopilotKit / AG-UI). Local direct mode
 * has no tool calls yet (MCP is a later phase) — the model is
 * source-agnostic, so local tool calls plug into the same shape later.
 * Never fakes data: a missing result message means "running".
 */

export type DrawerActionStatus = "running" | "done" | "error";

export interface DrawerToolAction {
  kind: "tool";
  /** Stable id (the tool call id). */
  id: string;
  /** Display title — the tool/function name. */
  title: string;
  status: DrawerActionStatus;
  /** Named inputs in argument order. Never throws on malformed args. */
  inputs: Array<{ name: string; value: string }>;
  /** Full result text; "" while still running. */
  output: string;
}

export interface DrawerThinkingBlock {
  kind: "thinking";
  text: string;
}

export type DrawerItem = DrawerThinkingBlock | DrawerToolAction;

interface LooseToolCall {
  id?: unknown;
  type?: unknown;
  function?: { name?: unknown; arguments?: unknown } | null;
  name?: unknown;
}

interface LooseToolMessage {
  content?: unknown;
  error?: unknown;
}

function asObject(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

/**
 * Map one AG-UI/CopilotKit tool call (+ its optional result message) to a
 * drawer action. Defensive: accepts unknown, never throws.
 */
export function toolCallToAction(toolCall: unknown, toolMessage: unknown): DrawerToolAction {
  const tc = asObject(toolCall) as LooseToolCall;
  const fn = asObject(tc.function) as { name?: unknown; arguments?: unknown };
  const id = typeof tc.id === "string" && tc.id ? tc.id : "tool";
  const title =
    typeof fn.name === "string" && fn.name
      ? fn.name
      : typeof tc.name === "string" && tc.name
        ? tc.name
        : "tool";

  const inputs = parseToolArguments(fn.arguments);

  const tm = asObject(toolMessage) as LooseToolMessage;
  const hasResult = typeof tm.content === "string";
  const status: DrawerActionStatus = !hasResult
    ? "running"
    : typeof tm.error === "string" && tm.error
      ? "error"
      : "done";

  return {
    kind: "tool",
    id,
    title,
    status,
    inputs,
    output: hasResult ? (tm.content as string) : "",
  };
}

/** Parse the (JSON-string) tool arguments into named inputs. Never throws. */
function parseToolArguments(raw: unknown): Array<{ name: string; value: string }> {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>).map(([name, value]) => ({
        name,
        value: stringifyArg(value),
      }));
    }
    // Non-object JSON (array / scalar): keep it as one named value.
    return [{ name: "value", value: stringifyArg(parsed) }];
  } catch {
    // Not JSON at all — show the raw string rather than dropping it.
    return [{ name: "arguments", value: raw }];
  }
}

function stringifyArg(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    const j = JSON.stringify(value);
    return j ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Collect the drawer actions for one chat message: pair each tool call with
 * its result message (matched by toolCallId), like chat.tsx does today.
 * Pure and defensive — never throws.
 */
export function messageToolActions(message: unknown, allMessages: unknown[]): DrawerToolAction[] {
  const m = asObject(message);
  const rawCalls = m.toolCalls;
  if (!Array.isArray(rawCalls)) return [];
  return rawCalls.map((toolCall) => {
    const callId = asObject(toolCall).id;
    const toolMessage = allMessages.find((candidate) => {
      const c = asObject(candidate);
      return c.role === "tool" && c.toolCallId === callId;
    });
    return toolCallToAction(toolCall, toolMessage);
  });
}
