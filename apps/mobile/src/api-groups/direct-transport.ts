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

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  /** Plain text, or OpenAI content blocks (for native vision image_url). */
  content: string | ChatContentBlock[];
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
  return `${normalizeBaseUrl(group.baseUrl)}/chat/completions`;
}

function requestHeaders(group: ApiGroup): Record<string, string> {
  // Keyless local endpoints (Ollama-style) get no Authorization header —
  // don't send `Bearer undefined`/empty. Custom headers keep their override
  // precedence (spread last, as before).
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = group.apiKey?.trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  return { ...headers, ...group.headers };
}

function requestBody(group: ApiGroup, messages: ChatMessage[], stream: boolean): string {
  return JSON.stringify({ model: group.model, messages, stream });
}

interface SseCallbacks {
  onToken: (delta: string) => void;
  onDone: () => void;
  onError: (error: Error) => void;
  signal?: AbortSignal;
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

/** Incremental SSE line parser — feed it text chunks, it emits deltas. */
export function createSseParser(
  groupName: string,
  onToken: (delta: string) => void,
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
      }
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
export function streamChat(
  group: ApiGroup,
  messages: ChatMessage[],
  callbacks: SseCallbacks,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const parser = createSseParser(group.name, callbacks.onToken);
    const xhr = new XMLHttpRequest();
    let settled = false;
    let seen = 0;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    // Set once the 8s fallback takes over: XHR events after this are stale.
    let shelved = false;
    // Mid-stream stall watchdog (P2-1 companion to xhr.timeout below).
    let stallTimer: ReturnType<typeof setTimeout> | null = null;

    const succeed = () => {
      if (settled) return;
      settled = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      clearStallTimer();
      try {
        xhr.abort();
      } catch {
        // already gone
      }
      callbacks.onDone();
      resolve();
    };

    const fail = (e: Error) => {
      if (settled) return;
      settled = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      clearStallTimer();
      try {
        xhr.abort();
      } catch {
        // already gone
      }
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

    callbacks.signal?.addEventListener("abort", () => fail(new GroupError(group.name, "aborted")));

    xhr.open("POST", endpointFor(group));
    for (const [k, v] of Object.entries(requestHeaders(group))) xhr.setRequestHeader(k, v);
    // Absolute cap for the whole request (the ontimeout handler below was
    // previously dead code — timeout was never assigned). The 45s stall
    // watchdog above handles mid-stream hangs; this is the backstop.
    xhr.timeout = 120000;

    xhr.onprogress = () => {
      if (shelved) return;
      try {
        const text: string = xhr.responseText ?? "";
        if (text.length > seen) {
          parser.push(text.slice(seen));
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
        if (text.length > seen) parser.push(text.slice(seen));
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
      xhr.send(requestBody(group, messages, true));
    } catch (e) {
      fail(e instanceof Error ? e : new Error(String(e)));
    }

    // Safety net: if the server never streams (no progress events), fall
    // back to a plain non-streaming fetch after 8s of silence.
    fallbackTimer = setTimeout(() => {
      if (settled || seen > 0) return;
      shelve();
      void fetch(endpointFor(group), {
        method: "POST",
        headers: requestHeaders(group),
        body: requestBody(group, messages, false),
        signal: callbacks.signal,
      })
        .then(async (res) => {
          const text = await res.text();
          if (!res.ok) throw statusError(group, res.status, text);
          const parsed = JSON.parse(text) as {
            choices?: Array<{ message?: { content?: unknown } }>;
            error?: { message?: string } | string;
          };
          if (parsed.error)
            throw new GroupError(
              group.name,
              typeof parsed.error === "string"
                ? parsed.error
                : (parsed.error.message ?? "unknown error"),
            );
          const content = parsed.choices?.[0]?.message?.content;
          if (typeof content === "string" && content) callbacks.onToken(content);
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
 */
export async function testConnection(group: ApiGroup): Promise<{ ok: true; models: string[] }> {
  // 1. Try the models endpoint (lets the user pick a model, Kelivo-style).
  let models: string[] = [];
  try {
    const res = await fetch(`${normalizeBaseUrl(group.baseUrl)}/models`, {
      headers: requestHeaders(group),
    });
    if (res.ok) {
      const payload = (await res.json()) as { data?: Array<{ id?: string }> };
      models = (payload.data ?? []).map((m) => m.id ?? "").filter(Boolean);
    }
  } catch {
    // /models is optional — the chat probe below is the real test.
  }
  // 2. Minimal chat probe.
  const res = await fetch(endpointFor(group), {
    method: "POST",
    headers: requestHeaders(group),
    body: requestBody(group, [{ role: "user", content: "ping" }], false),
  });
  const text = await res.text();
  if (!res.ok) throw statusError(group, res.status, text);
  return { ok: true, models };
}
