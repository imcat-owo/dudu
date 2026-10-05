/**
 * One-shot model call for a persona group turn, with the shared tool pool.
 *
 * Mirrors chat/group-meeting-tools.ts generateOneShot (same endpoint shape,
 * same fail-closed semantics) but additionally records every tool call as
 * GroupToolUse[] so the transcript can fold them into one block (her spec
 * rule 7: 群聊工具调用折叠防刷屏).
 *
 * Not PURE: uses fetch. Tests inject fakes at the engine's `generate` seam
 * instead, so this module needs no test doubles of its own.
 */

import type { ApiGroup } from "../api-groups/types";
import type { GroupToolUse } from "./persona-group";
import type { GroupTurnResult, GroupTurnTool } from "./persona-group-engine";

export const GROUP_TURN_TIMEOUT_MS = 60000;
/** Small cap — group turns stay chatty, not agentic marathons. */
export const GROUP_TURN_MAX_TOOL_ITERATIONS = 3;
export const GROUP_TURN_MAX_TOKENS = 600;

function failed(e: unknown, timeoutMs: number): Error {
  const aborted =
    (e as { name?: string } | null)?.name === "AbortError" || String(e).includes("aborted");
  return new Error(
    aborted
      ? `model call timed out after ${timeoutMs}ms`
      : `model call failed: ${String(e).slice(0, 160)}`,
  );
}

interface OneShotResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
      tool_calls?: Array<{
        id?: unknown;
        type?: unknown;
        function?: { name?: unknown; arguments?: unknown };
      }>;
    };
  }>;
}

export async function generateGroupTurn(
  group: ApiGroup,
  system: string,
  user: string,
  tools: GroupTurnTool[],
  opts: { timeoutMs?: number; maxTokens?: number; maxToolIterations?: number } = {},
): Promise<GroupTurnResult> {
  const timeoutMs = opts.timeoutMs ?? GROUP_TURN_TIMEOUT_MS;
  const maxIter = opts.maxToolIterations ?? GROUP_TURN_MAX_TOOL_ITERATIONS;
  const endpoint = `${group.baseUrl.trim().replace(/\/+$/, "")}/chat/completions`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = group.apiKey?.trim();
  if (key) headers.Authorization = `Bearer ${key}`;

  const messages: Record<string, unknown>[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  const toolUses: GroupToolUse[] = [];

  async function postOnce(body: Record<string, unknown>): Promise<OneShotResponse | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let res: Response;
      try {
        res = await fetch(endpoint, {
          method: "POST",
          headers: { ...headers, ...group.headers },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (e) {
        throw failed(e, timeoutMs);
      }
      if (!res.ok) {
        const resBody = await res.text().catch(() => "");
        throw new Error(
          `model call failed: HTTP ${res.status}${resBody ? ` — ${resBody.slice(0, 120)}` : ""}`,
        );
      }
      return (await res.json().catch((e: unknown) => {
        if ((e as { name?: string } | null)?.name === "AbortError") throw failed(e, timeoutMs);
        return null;
      })) as OneShotResponse | null;
    } finally {
      clearTimeout(timer);
    }
  }

  let lastText = "";
  for (let iter = 0; ; iter++) {
    const body: Record<string, unknown> = {
      model: group.model,
      messages,
      stream: false,
      max_tokens: opts.maxTokens ?? GROUP_TURN_MAX_TOKENS,
    };
    if (tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body.tool_choice = "auto";
    }
    const data = await postOnce(body);
    const message = data?.choices?.[0]?.message;
    const toolCalls = message?.tool_calls ?? [];
    if (typeof message?.content === "string" && message.content.trim()) {
      lastText = message.content.trim();
    }
    if (toolCalls.length === 0 || iter >= maxIter) {
      if (!lastText) throw new Error("model call failed: empty reply");
      return { text: lastText, tools: toolUses };
    }
    messages.push({
      role: "assistant",
      content: typeof message?.content === "string" ? message.content : null,
      tool_calls: toolCalls.map((tc) => ({
        id: String(tc.id ?? ""),
        type: "function",
        function: {
          name: String(tc.function?.name ?? ""),
          arguments: String(tc.function?.arguments ?? "{}"),
        },
      })),
    });
    for (const tc of toolCalls) {
      const name = String(tc.function?.name ?? "");
      const tool = tools.find((t) => t.name === name);
      let result: string;
      let ok = true;
      try {
        if (!tool) {
          throw new Error(`Unknown tool: ${name}.`);
        }
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(String(tc.function?.arguments ?? "{}")) as Record<string, unknown>;
        } catch {
          throw new Error(`bad arguments JSON for tool "${name}"`);
        }
        result = await tool.run(parsed);
      } catch (e) {
        ok = false;
        result = `Tool error: ${e instanceof Error ? e.message : String(e)}`;
      }
      toolUses.push({ name: name || "(unknown)", ok });
      messages.push({ role: "tool", tool_call_id: String(tc.id ?? ""), content: result });
    }
  }
}
