/**
 * Capability probing — find out what a model ACTUALLY supports.
 *
 * Her principle: default tools+thinking ON for everything; only downgrade
 * when PROVEN impossible. So probing is optimistic: we try the full
 * feature set and only mark something unsupported when the model says no.
 *
 * Probing is cheap: one minimal non-streaming request per capability,
 * run when she tests/saves a group — never in the hot chat path.
 *
 * Pure module: fetch is injected so tests don't hit the network.
 */

import { classifyError } from "./error-classifier";
import type { ApiGroup } from "./types";

export type CapabilityState = "supported" | "unsupported" | "unknown";

export interface ModelCapabilities {
  tools: CapabilityState;
  thinking: CapabilityState;
  vision: CapabilityState;
  /** Rough max context in tokens, when the endpoint tells us. */
  maxContextTokens: number | null;
}

export const UNKNOWN_CAPABILITIES: ModelCapabilities = {
  tools: "unknown",
  thinking: "unknown",
  vision: "unknown",
  maxContextTokens: null,
};

export type ProbeFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

function headersFor(group: ApiGroup): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = group.apiKey?.trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  return { ...headers, ...group.headers };
}

function endpointFor(group: ApiGroup): string {
  return `${group.baseUrl.trim().replace(/\/+$/, "")}/chat/completions`;
}

/**
 * Probe tool-call support with a single minimal request carrying one
 * dummy tool definition. A 200 (with or without actual tool calls in the
 * reply) means supported; a tools_unsupported-classified failure means
 * the model/proxy can't do function calling.
 */
export async function probeTools(group: ApiGroup, fetchImpl: ProbeFetch): Promise<CapabilityState> {
  const body = JSON.stringify({
    model: group.model,
    messages: [{ role: "user", content: "ping" }],
    stream: false,
    tools: [
      {
        type: "function",
        function: {
          name: "probe_ping",
          description: "Capability probe, never called for real.",
          parameters: { type: "object", properties: {} },
        },
      },
    ],
    tool_choice: "auto",
    max_tokens: 8,
  });
  try {
    const res = await fetchImpl(endpointFor(group), {
      method: "POST",
      headers: headersFor(group),
      body,
    });
    if (res.ok) return "supported";
    const text = await res.text().catch(() => "");
    const cls = classifyError(new Error(`HTTP ${res.status}: ${text}`));
    return cls === "tools_unsupported" ? "unsupported" : "unknown";
  } catch (e) {
    const cls = classifyError(e);
    return cls === "tools_unsupported" ? "unsupported" : "unknown";
  }
}

/**
 * Probe thinking support. We don't send thinking params (the app parses
 * thinking from deltas); instead we check whether the model streams
 * reasoning deltas at all. A model that never emits reasoning_content /
 * thinking deltas simply has nothing to show — that's "supported but
 * silent", NOT unsupported. Only a thinking_unsupported-classified
 * failure marks it unsupported.
 */
export async function probeThinking(
  group: ApiGroup,
  fetchImpl: ProbeFetch,
): Promise<CapabilityState> {
  const body = JSON.stringify({
    model: group.model,
    messages: [{ role: "user", content: "ping" }],
    stream: false,
    max_tokens: 8,
  });
  try {
    const res = await fetchImpl(endpointFor(group), {
      method: "POST",
      headers: headersFor(group),
      body,
    });
    if (res.ok) return "supported";
    const text = await res.text().catch(() => "");
    const cls = classifyError(new Error(`HTTP ${res.status}: ${text}`));
    return cls === "thinking_unsupported" ? "unsupported" : "unknown";
  } catch (e) {
    const cls = classifyError(e);
    return cls === "thinking_unsupported" ? "unsupported" : "unknown";
  }
}

/**
 * Run all probes. Each probe is independent — one failing never blocks
 * the others. Returns "unknown" for anything inconclusive (optimistic:
 * we keep the feature ON until proven otherwise).
 */
export async function probeCapabilities(
  group: ApiGroup,
  fetchImpl: ProbeFetch,
): Promise<ModelCapabilities> {
  const [tools, thinking] = await Promise.all([
    probeTools(group, fetchImpl),
    probeThinking(group, fetchImpl),
  ]);
  return { tools, thinking, vision: "unknown", maxContextTokens: null };
}
