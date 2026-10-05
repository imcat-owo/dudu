/**
 * Direct transport: phone → model API, no backend in the middle.
 *
 * v1 wire format: OpenAI-compatible `POST {baseUrl}/chat/completions`
 * with `"stream": true` (SSE). This covers OpenAI, OpenAI-compatible
 * proxies/gateways, and most third-party providers the user will configure.
 *
 * Streaming on React Native: `fetch` body streaming is unreliable across
 * RN/Hermes versions, so SSE is read with XMLHttpRequest `onprogress`
 * (the battle-tested RN streaming path), parsing `data:` lines
 * incrementally. A non-streaming fetch fallback covers transports where
 * XHR progress events don't fire.
 *
 * Errors are always per-group: a dead group rejects with a labeled error,
 * it never takes the app down.
 */

import { type ApiGroup, normalizeBaseUrl } from "./types";
import { resolveKeySecret, selectKeyId, recordKeyResult } from "./api-keys";
import { oauthStore } from "./oauth";
import { logDiag, sanitizeHeaders, sanitizeBodyPreview } from "./diagnostics";
import { recordUsage } from "./pricing";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  /** Plain text, or OpenAI content blocks (for native vision image_url). */
  content: string | ChatContentBlock[];
  /** For role "tool": the id of the tool call this result answers. */
  tool_call_id?: string;
  /** For role "assistant": tool calls the model requested. */
  tool_calls?: WireToolCall[];
}

/** OpenAI wire shape for a requested tool call. */
export interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** A fully-accumulated tool call from streaming deltas. */
export interface CompletedToolCall {
  id: string;
  name: string;
  /** JSON-encoded arguments string. */
  arguments: string;
}

/** Tool definitions (OpenAI function-calling format) sent with the request. */
export interface WireToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
  };
}

export type ChatContentBlock =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export class GroupError extends Error {
  constructor(
    readonly groupName: string,
    message: string,
  ) {
    super(message);
    this.name = "GroupError";
  }
}

function endpointFor(group: ApiGroup): string {
  // B14: Azure OpenAI mode — full deployment URL + api-version.
  const azure = group.azure;
  if (azure?.enabled && azure.deploymentUrl.trim()) {
    const base = azure.deploymentUrl.trim().replace(/\/+$/, "");
    const ver = azure.apiVersion.trim() || "2024-10-01-preview";
    return `${base}/chat/completions?api-version=${encodeURIComponent(ver)}`;
  }
  return `${normalizeBaseUrl(group.baseUrl)}/chat/completions`;
}

/**
 * B1/B2: resolve the Authorization headers for a group.
 * OAuth account wins when bound; then the key pool (rotation); then the
 * legacy single key. Azure mode uses `api-key` instead of Bearer.
 * Exported for balance.ts / diagnostics / tests.
 */
export interface ResolvedAuth {
  headers: Record<string, string>;
  /** Selected key id (B2), or null for OAuth/legacy. */
  keyId: string | null;
  oauth: boolean;
}

// Per-group round-robin cursors (B2). Module-level: survives across calls,
// resets on reload (acceptable — rotation order isn't a promise).
const keyCursors = new Map<string, { index: number }>();

export async function resolveAuth(group: ApiGroup): Promise<ResolvedAuth> {
  const isAzure = !!group.azure?.enabled && !!group.azure.deploymentUrl.trim();
  // B1: OAuth account bound → fresh access token (auto-refreshes).
  if (group.oauthAccountId) {
    const token = await oauthStore.accessToken(group.oauthAccountId);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (isAzure) headers["api-key"] = token;
    else headers.Authorization = `Bearer ${token}`;
    return { headers: applyCustomHeaders(headers, group), keyId: null, oauth: true };
  }
  // B2: key pool with rotation.
  let cursor = keyCursors.get(group.id);
  if (!cursor) {
    cursor = { index: 0 };
    keyCursors.set(group.id, cursor);
  }
  const { keyId } = selectKeyId(group, cursor);
  const secret = resolveKeySecret(group, keyId);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret) {
    if (isAzure) headers["api-key"] = secret;
    else headers.Authorization = `Bearer ${secret}`;
  }
  return { headers: applyCustomHeaders(headers, group), keyId, oauth: false };
}

/** B15: custom User-Agent override, applied after the auth headers. */
function applyCustomHeaders(
  headers: Record<string, string>,
  group: ApiGroup,
): Record<string, string> {
  const out = { ...headers, ...group.headers };
  if (group.userAgent?.trim()) out["User-Agent"] = group.userAgent.trim();
  return out;
}

/** B2: report a request outcome back to the key pool (auto-disable/recover). */
export async function reportKeyOutcome(
  groupId: string,
  keyId: string | null,
  ok: boolean,
  error?: string,
): Promise<void> {
  if (!keyId) return;
  try {
    const { groupStore } = await import("./store");
    const snap = groupStore.getSnapshot();
    const group = snap.groups.find((g) => g.id === groupId);
    if (!group?.apiKeys) return;
    const key = group.apiKeys.find((k) => k.id === keyId);
    if (!key) return;
    const updated = recordKeyResult(key, ok, group, Date.now(), error);
    await groupStore.upsert({
      ...group,
      apiKeys: group.apiKeys.map((k) => (k.id === keyId ? updated : k)),
    });
  } catch {
    // Key stats must never break the app.
  }
}

function requestBody(
  group: ApiGroup,
  messages: ChatMessage[],
  stream: boolean,
  tools?: WireToolDef[],
  maxTokens?: number,
  opts?: { dialogId?: string },
): string {
  const body: Record<string, unknown> = { model: group.model, messages, stream };
  if (tools && tools.length > 0) {
    body.tools = tools;
    // Let the model decide when tools are useful; don't force it.
    body.tool_choice = "auto";
  }
  // A27: per-turn output cap — her key, her spend ceiling.
  if (maxTokens && maxTokens > 0) body.max_tokens = Math.floor(maxTokens);
  // B11: sampling parameters. Null = don't send, use the vendor default.
  const sampling = group.sampling;
  if (sampling?.temperature != null) body.temperature = sampling.temperature;
  if (sampling?.topP != null) body.top_p = sampling.topP;
  if (sampling?.maxTokens != null && !(maxTokens && maxTokens > 0)) {
    body.max_tokens = Math.floor(sampling.maxTokens);
  }
  // B7: prompt caching — opt-in. Kelivo sends prompt_cache_key for
  // OpenAI-compatible endpoints; servers that support it bill less.
  if (group.caching?.enabled && opts?.dialogId) {
    body.prompt_cache_key = `dudu:${opts.dialogId}`;
  }
  // B9: ask for usage in the final SSE chunk so we can record spend.
  if (stream) body.stream_options = { include_usage: true };
  // B6: custom body extras merged last (gateway-specific parameters win).
  if (group.bodyExtras && Object.keys(group.bodyExtras).length > 0) {
    Object.assign(body, group.bodyExtras);
  }
  return JSON.stringify(body);
}

interface SseCallbacks {
  onToken: (delta: string) => void;
  /** Reasoning/thinking deltas, when the model streams them separately. */
  onThinking?: (delta: string) => void;
  /** Accumulated tool calls, delivered once when the stream completes. */
  onToolCalls?: (calls: CompletedToolCall[]) => void;
  onDone: () => void;
  onError: (error: Error) => void;
  signal?: AbortSignal;
  /** Tool definitions to send (OpenAI function-calling). Enables tool_choice=auto. */
  tools?: WireToolDef[];
}

/**
 * Parse one SSE `data:` payload. Returns the text delta, null for
 * control frames ([DONE]), or throws GroupError on API error payloads.
 */
export function parseSseData(groupName: string, data: string): string | null {
  if (data === "[DONE]") return null;
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return null; // incomplete chunk — the incremental parser holds the tail
  }
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const err = (payload as { error: unknown }).error;
    const msg =
      typeof err === "object" && err !== null && "message" in err
        ? String((err as { message: unknown }).message)
        : JSON.stringify(err);
    throw new GroupError(groupName, msg);
  }
  const choice = (payload as { choices?: Array<{ delta?: { content?: unknown } }> }).choices?.[0];
  const content = choice?.delta?.content;
  return typeof content === "string" ? content : null;
}

/**
 * Parse one SSE `data:` payload for reasoning/thinking content.
 * Covers the two wire shapes seen in the wild on OpenAI-compatible
 * endpoints: `delta.reasoning_content` (DeepSeek-R1 via OpenRouter and
 * friends) and `delta.thinking` (proxies that map Anthropic thinking
 * blocks onto the chat-completions shape). Returns the thinking delta,
 * or null when the frame carries none. Never throws on shape issues —
 * thinking is best-effort; the reply must not die because a proxy sent
 * a weird delta.
 */
export function parseSseThinking(data: string): string | null {
  if (data === "[DONE]") return null;
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return null; // incomplete chunk — the incremental parser holds the tail
  }
  const delta = (payload as { choices?: Array<{ delta?: Record<string, unknown> }> }).choices?.[0]
    ?.delta;
  if (!delta || typeof delta !== "object") return null;
  const reasoning = delta.reasoning_content;
  if (typeof reasoning === "string" && reasoning) return reasoning;
  const thinking = delta.thinking;
  if (typeof thinking === "string" && thinking) return thinking;
  return null;
}

/**
 * Parse `usage` from an SSE data payload (sent when stream_options.
 * include_usage is true). Returns null when absent. Never throws.
 */
export function parseSseUsage(
  data: string,
): { inputTokens: number; outputTokens: number } | null {
  if (data === "[DONE]") return null;
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return null;
  }
  const usage = (payload as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return null;
  const u = usage as Record<string, unknown>;
  const inputTokens = typeof u.prompt_tokens === "number" ? u.prompt_tokens : 0;
  const outputTokens = typeof u.completion_tokens === "number" ? u.completion_tokens : 0;
  if (inputTokens === 0 && outputTokens === 0) return null;
  return { inputTokens, outputTokens };
}

/** Incremental SSE line parser — feed it text chunks, it emits deltas. */
export function createSseParser(
  groupName: string,
  onToken: (delta: string) => void,
  onThinking?: (delta: string) => void,
  onToolCallDelta?: (delta: WireToolCallDelta) => void,
): { push(chunk: string): void } {
  let buffer = "";
  return {
    push(chunk: string) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data) continue;
        const delta = parseSseData(groupName, data);
        if (delta) onToken(delta);
        if (onThinking) {
          const thinking = parseSseThinking(data);
          if (thinking) onThinking(thinking);
        }
        if (onToolCallDelta) {
          for (const tc of parseSseToolCallDeltas(data)) onToolCallDelta(tc);
        }
      }
    },
  };
}

/**
 * One streaming tool-call delta frame. The model streams the call in pieces:
 * first the index/id/name, then the arguments string in chunks.
 */
export interface WireToolCallDelta {
  index: number;
  id?: string;
  name?: string;
  argumentsChunk?: string;
}

/**
 * Parse `delta.tool_calls` from one SSE data payload. Returns the deltas
 * (usually one per frame). Never throws — malformed frames are skipped.
 */
export function parseSseToolCallDeltas(data: string): WireToolCallDelta[] {
  if (data === "[DONE]") return [];
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return [];
  }
  const delta = (payload as { choices?: Array<{ delta?: Record<string, unknown> }> }).choices?.[0]
    ?.delta;
  if (!delta || typeof delta !== "object") return [];
  const raw = delta.tool_calls;
  if (!Array.isArray(raw)) return [];
  const out: WireToolCallDelta[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const index = typeof rec.index === "number" ? rec.index : 0;
    const fn = (rec.function ?? {}) as Record<string, unknown>;
    out.push({
      index,
      id: typeof rec.id === "string" ? rec.id : undefined,
      name: typeof fn.name === "string" ? fn.name : undefined,
      argumentsChunk: typeof fn.arguments === "string" ? fn.arguments : undefined,
    });
  }
  return out;
}

/**
 * Accumulate streaming tool-call deltas (keyed by index) into complete
 * calls. Pure and defensive — never throws.
 */
export function accumulateToolCalls(): {
  push: (delta: WireToolCallDelta) => void;
  complete: () => CompletedToolCall[];
} {
  const byIndex = new Map<number, { id: string; name: string; args: string }>();
  return {
    push(delta) {
      let acc = byIndex.get(delta.index);
      if (!acc) {
        acc = { id: "", name: "", args: "" };
        byIndex.set(delta.index, acc);
      }
      if (delta.id) acc.id = delta.id;
      if (delta.name) acc.name = delta.name;
      if (delta.argumentsChunk) acc.args += delta.argumentsChunk;
    },
    complete() {
      return (
        [...byIndex.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, acc], i) => ({
            // Some proxies omit ids; synthesize a stable one so pairing works.
            id: acc.id || `tool_${i}`,
            name: acc.name,
            arguments: acc.args,
          }))
          // Drop empty frames (no name = not a real call).
          .filter((c) => c.name)
      );
    },
  };
}

function statusError(group: ApiGroup, status: number, body: string): GroupError {
  let detail = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string };
    if (typeof parsed.error === "string") detail = parsed.error;
    else if (parsed.error?.message) detail = parsed.error.message;
  } catch {
    // keep the raw slice
  }
  return new GroupError(group.name, `HTTP ${status}: ${detail}`);
}

/**
 * Stream a chat completion. Resolves when the stream ends ([DONE] or
 * connection close). Rejects with GroupError on transport/API failures.
 * The AbortSignal cancels the request mid-stream.
 */
export async function streamChat(
  group: ApiGroup,
  messages: ChatMessage[],
  callbacks: SseCallbacks,
  opts?: { maxTokens?: number; dialogId?: string },
): Promise<void> {
  const startedAt = Date.now();
  // B1/B2: resolve auth (OAuth token or rotated key) before opening the stream.
  const auth = await resolveAuth(group);
  const body = requestBody(group, messages, true, callbacks.tools, opts?.maxTokens, {
    dialogId: opts?.dialogId,
  });
  return new Promise((resolve, reject) => {
    const toolAcc = accumulateToolCalls();
    let usage: { inputTokens: number; outputTokens: number } | null = null;
    const parser = createSseParser(group.name, callbacks.onToken, callbacks.onThinking, (d) =>
      toolAcc.push(d),
    );
    // B9: capture usage frames (stream_options.include_usage).
    const usageParser = {
      push(chunk: string) {
        for (const line of chunk.split("\n")) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          const u = parseSseUsage(t.slice(5).trim());
          if (u) usage = u;
        }
      },
    };
    const xhr = new XMLHttpRequest();
    let settled = false;
    let seen = 0;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    // Set once the 8s fallback takes over: XHR events after this are stale.
    let shelved = false;
    // Mid-stream stall watchdog (P2-1 companion to xhr.timeout below).
    let stallTimer: ReturnType<typeof setTimeout> | null = null;

    // P3-9: named abort handler, removed on settle — the old anonymous
    // listener was never detached and pinned this whole closure (xhr,
    // parser, callbacks) to the AbortSignal.
    const onAbort = () => fail(new GroupError(group.name, "aborted"));
    callbacks.signal?.addEventListener("abort", onAbort);
    const detachAbort = () => callbacks.signal?.removeEventListener("abort", onAbort);

    const succeed = () => {
      if (settled) return;
      settled = true;
      detachAbort();
      if (fallbackTimer) clearTimeout(fallbackTimer);
      clearStallTimer();
      try {
        xhr.abort();
      } catch {
        // already gone
      }
      // Deliver any tool calls the model requested (empty when none).
      try {
        callbacks.onToolCalls?.(toolAcc.complete());
      } catch {
        // tool delivery is informational; the reply itself succeeded.
      }
      // B2/B8/B9: bookkeeping — never breaks the reply.
      void reportKeyOutcome(group.id, auth.keyId, true);
      if (usage) {
        void recordUsage({
          at: Date.now(),
          groupId: group.id,
          groupName: group.name,
          model: group.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        });
      }
      void logDiag({
        at: Date.now(),
        kind: "chat",
        groupId: group.id,
        groupName: group.name,
        request: {
          url: endpointFor(group),
          model: group.model,
          messageCount: messages.length,
          bodyBytes: body.length,
          bodyPreview: sanitizeBodyPreview(body),
        },
        response: {
          ok: true,
          ms: Date.now() - startedAt,
        },
      });
      callbacks.onDone();
      resolve();
    };

    const fail = (e: Error) => {
      if (settled) return;
      settled = true;
      detachAbort();
      if (fallbackTimer) clearTimeout(fallbackTimer);
      clearStallTimer();
      try {
        xhr.abort();
      } catch {
        // already gone
      }
      // B2/B8: bookkeeping — never breaks error reporting.
      void reportKeyOutcome(group.id, auth.keyId, false, e.message);
      void logDiag({
        at: Date.now(),
        kind: "chat",
        groupId: group.id,
        groupName: group.name,
        request: {
          url: endpointFor(group),
          model: group.model,
          messageCount: messages.length,
          bodyBytes: body.length,
          bodyPreview: sanitizeBodyPreview(body),
        },
        response: {
          ok: false,
          ms: Date.now() - startedAt,
          error: e.message.slice(0, 300),
        },
      });
      callbacks.onError(e);
      reject(e);
    };

    // Hands the request off to the non-streaming fallback below. Aborts the
    // XHR and marks it shelved so late XHR events are ignored — but does NOT
    // settle the outer promise: the fallback fetch chain settles it via
    // succeed()/fail() below. (Marking settled here used to hang runTurn()
    // forever: succeed()/fail() both early-return on settled.)
    const shelve = () => {
      if (settled || shelved) return;
      shelved = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (stallTimer) clearTimeout(stallTimer);
      try {
        xhr.abort();
      } catch {
        // already gone
      }
    };

    // Mid-stream stall watchdog: no progress for 45s after the first byte
    // means the server hung mid-stream — fail loudly so runTurn() can
    // report it instead of spinning forever.
    const pokeStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        if (!settled && !shelved)
          fail(new GroupError(group.name, "stream stalled (no data for 45s)"));
      }, 45000);
    };
    const clearStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = null;
    };

    xhr.open("POST", endpointFor(group));
    for (const [k, v] of Object.entries(auth.headers)) xhr.setRequestHeader(k, v);
    // Absolute cap for the whole request (the ontimeout handler below was
    // previously dead code — timeout was never assigned). The 45s stall
    // watchdog above handles mid-stream hangs; this is the backstop.
    xhr.timeout = 120000;

    xhr.onprogress = () => {
      if (shelved) return;
      try {
        const text: string = xhr.responseText ?? "";
        if (text.length > seen) {
          const chunk = text.slice(seen);
          parser.push(chunk);
          usageParser.push(chunk);
          seen = text.length;
          pokeStallTimer();
        }
      } catch (e) {
        fail(e instanceof Error ? e : new Error(String(e)));
      }
    };

    xhr.onload = () => {
      if (shelved) return;
      clearStallTimer();
      if (xhr.status < 200 || xhr.status >= 300) {
        fail(statusError(group, xhr.status, xhr.responseText ?? ""));
        return;
      }
      // Flush any trailing buffered text (some servers close without [DONE]).
      try {
        const text: string = xhr.responseText ?? "";
        if (text.length > seen) {
          const chunk = text.slice(seen);
          parser.push(chunk);
          usageParser.push(chunk);
        }
      } catch {
        // ignore — deltas already delivered
      }
      succeed();
    };

    xhr.onerror = () => {
      if (shelved) return;
      fail(new GroupError(group.name, "network error"));
    };
    xhr.ontimeout = () => {
      if (shelved) return;
      fail(new GroupError(group.name, "timed out"));
    };

    try {
      xhr.send(body);
    } catch (e) {
      fail(e instanceof Error ? e : new Error(String(e)));
    }

    // Safety net: if the server never streams (no progress events), fall
    // back to a plain non-streaming fetch after 8s of silence.
    fallbackTimer = setTimeout(() => {
      if (settled || seen > 0) return;
      shelve();
      const fallbackBody = requestBody(group, messages, false, callbacks.tools);
      void fetch(endpointFor(group), {
        method: "POST",
        headers: auth.headers,
        body: fallbackBody,
        signal: callbacks.signal,
      })
        .then(async (res) => {
          const text = await res.text();
          if (!res.ok) throw statusError(group, res.status, text);
          const parsed = JSON.parse(text) as {
            choices?: Array<{
              message?: {
                content?: unknown;
                reasoning_content?: unknown;
                thinking?: unknown;
                tool_calls?: Array<{
                  id?: unknown;
                  function?: { name?: unknown; arguments?: unknown };
                }>;
              };
            }>;
            error?: { message?: string } | string;
          };
          if (parsed.error)
            throw new GroupError(
              group.name,
              typeof parsed.error === "string"
                ? parsed.error
                : (parsed.error.message ?? "unknown error"),
            );
          const msg = parsed.choices?.[0]?.message;
          const content = msg?.content;
          if (typeof content === "string" && content) callbacks.onToken(content);
          // Non-streaming responses carry thinking on the message, not the delta.
          if (callbacks.onThinking) {
            const thinking =
              (typeof msg?.reasoning_content === "string" && msg.reasoning_content) ||
              (typeof msg?.thinking === "string" && msg.thinking) ||
              null;
            if (thinking) callbacks.onThinking(thinking);
          }
          // Non-streaming tool calls arrive whole on the message.
          if (callbacks.onToolCalls && Array.isArray(msg?.tool_calls)) {
            const calls: CompletedToolCall[] = [];
            for (const tc of msg.tool_calls) {
              const fn = (tc.function ?? {}) as { name?: unknown; arguments?: unknown };
              if (typeof fn.name === "string" && fn.name) {
                calls.push({
                  id: typeof tc.id === "string" && tc.id ? tc.id : `tool_${calls.length}`,
                  name: fn.name,
                  arguments: typeof fn.arguments === "string" ? fn.arguments : "",
                });
              }
            }
            try {
              callbacks.onToolCalls(calls);
            } catch {
              // informational only
            }
          }
          succeed();
        })
        .catch((e: unknown) => {
          fail(e instanceof Error ? e : new Error(String(e)));
        });
    }, 8000);
  });
}

/**
 * Test a group: minimal non-streaming request. Resolves with the list of
 * model ids the endpoint reports (may be empty — some endpoints don't
 * serve /models), or rejects with GroupError.
 *
 * Round-3 code P2-4 / user P1: both probes carry a 15s budget — the
 * settings "test" button can never stick in "testing" forever. A timeout
 * says "timed out" so classifyError() maps it to network_error.
 */
const TEST_CONNECTION_TIMEOUT_MS = 15_000;

export async function testConnection(
  group: ApiGroup,
  opts: { timeoutMs?: number } = {},
): Promise<{ ok: true; models: string[] }> {
  const timeoutMs = opts.timeoutMs ?? TEST_CONNECTION_TIMEOUT_MS;
  // B1/B2: test with the same auth the real requests use (OAuth/rotated key).
  const auth = await resolveAuth(group);
  function testSignal(): { signal: AbortSignal; done: () => void } {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeoutMs);
    return { signal: c.signal, done: () => clearTimeout(t) };
  }
  // 1. Try the models endpoint (lets the user pick a model, Kelivo-style).
  let models: string[] = [];
  {
    const t = testSignal();
    try {
      const res = await fetch(`${normalizeBaseUrl(group.baseUrl)}/models`, {
        headers: auth.headers,
        signal: t.signal,
      });
      if (res.ok) {
        const payload = (await res.json()) as { data?: Array<{ id?: string }> };
        models = (payload.data ?? []).map((m) => m.id ?? "").filter(Boolean);
      }
    } catch {
      // /models is optional — the chat probe below is the real test.
    } finally {
      t.done();
    }
  }
  // 2. Minimal chat probe.
  const t = testSignal();
  let res: Response;
  try {
    res = await fetch(endpointFor(group), {
      method: "POST",
      headers: auth.headers,
      body: requestBody(group, [{ role: "user", content: "ping" }], false),
      signal: t.signal,
    });
  } catch (e) {
    t.done();
    if ((e as { name?: string } | null)?.name === "AbortError") {
      throw new GroupError(
        group.name,
        `test probe timed out after ${timeoutMs / 1000}s — the server accepted the connection but never answered`,
      );
    }
    throw e;
  }
  t.done();
  const text = await res.text();
  if (!res.ok) throw statusError(group, res.status, text);
  return { ok: true, models };
}
