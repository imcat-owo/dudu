/**
 * MCP transports — PURE module (no React Native imports).
 *
 * Implements the two remote MCP transports:
 * - Streamable HTTP (modern spec): POST JSON-RPC to the endpoint. The
 *   response may be a single JSON-RPC message or an SSE stream of messages.
 * - SSE (legacy): GET the endpoint for an event stream, then POST
 *   JSON-RPC messages to the URL delivered in the `endpoint` event.
 *
 * Both speak JSON-RPC 2.0. Notifications and request/response correlation
 * are handled by the client layer.
 */

import type { McpServerConfig } from "./types";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpTransport {
  /** Open the transport (SSE handshake / session init). */
  connect(): Promise<void>;
  /** Send a JSON-RPC request and resolve with the matching response. */
  request(req: Omit<JsonRpcRequest, "jsonrpc">, timeoutMs: number): Promise<unknown>;
  /** Fire-and-forget notification. */
  notify(method: string, params?: unknown): Promise<void>;
  close(): Promise<void>;
  /** Extra headers to attach (e.g. Authorization from OAuth). */
  setAuthHeader(value: string | null): void;
}

function expandEnvHeaders(
  headers: Record<string, string> | undefined,
  env: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    out[k] = v.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => env[name] ?? "");
  }
  return out;
}

async function readSseMessages(
  body: ReadableStream<Uint8Array>,
  onMessage: (data: string, event?: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let event: string | undefined;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal.aborted) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let data = "";
        for (const line of chunk.split("\n")) {
          if (line.startsWith(":")) continue; // comment / heartbeat
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (data) onMessage(data, event);
        event = undefined;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Streamable HTTP transport (MCP spec 2025). */
export function createHttpTransport(
  config: McpServerConfig,
  env: Record<string, string>,
): McpTransport {
  let authHeader: string | null = null;
  let sessionId: string | null = null;
  let nextId = 1;
  const pending = new Map<
    number | string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  function headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...expandEnvHeaders(config.headers, env),
    };
    if (authHeader) h["Authorization"] = authHeader;
    if (sessionId) h["Mcp-Session-Id"] = sessionId;
    return h;
  }

  function settle(id: number | string, value: unknown, isError: boolean) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    clearTimeout(p.timer);
    if (isError) {
      const e = value as { code?: number; message?: string };
      p.reject(new Error(`MCP error ${e?.code ?? "?"}: ${e?.message ?? "unknown"}`));
    } else {
      p.resolve(value);
    }
  }

  function handleMessage(msg: JsonRpcResponse) {
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      settle(msg.id, msg.error ?? msg.result, msg.error !== undefined);
    }
    // Notifications (no id) are ignored at transport level.
  }

  async function post(body: string, timeoutMs: number): Promise<void> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(config.url, {
        method: "POST",
        headers: headers(),
        body,
        signal: ctrl.signal,
      });
      const newSession = res.headers.get("Mcp-Session-Id");
      if (newSession) sessionId = newSession;
      if (res.status === 401) {
        throw new Error("MCP_UNAUTHORIZED");
      }
      if (!res.ok) {
        throw new Error(`MCP HTTP ${res.status}: ${await res.text().catch(() => "")}`);
      }
      const ctype = res.headers.get("content-type") ?? "";
      if (ctype.includes("text/event-stream")) {
        if (!res.body) throw new Error("MCP: empty SSE body");
        await readSseMessages(
          res.body,
          (data) => {
            try {
              handleMessage(JSON.parse(data) as JsonRpcResponse);
            } catch {
              // ignore malformed
            }
          },
          ctrl.signal,
        );
      } else {
        const msg = (await res.json()) as JsonRpcResponse;
        handleMessage(msg);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async connect(): Promise<void> {
      // Streamable HTTP is stateless until first request; nothing to do.
      // Session id is captured from the initialize response headers.
    },
    async request(req, timeoutMs): Promise<unknown> {
      const id = req.id ?? nextId++;
      const payload: JsonRpcRequest = { jsonrpc: "2.0", id, method: req.method, params: req.params };
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`MCP request timed out: ${req.method}`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        post(JSON.stringify(payload), timeoutMs).catch((e) => {
          pending.delete(id);
          clearTimeout(timer);
          reject(e instanceof Error ? e : new Error(String(e)));
        });
      });
    },
    async notify(method, params): Promise<void> {
      const payload = JSON.stringify({ jsonrpc: "2.0", method, params });
      await post(payload, config.timeoutMs ?? 15000);
    },
    async close(): Promise<void> {
      for (const [id, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new Error("MCP transport closed"));
        pending.delete(id);
      }
      // Best-effort session teardown.
      if (sessionId) {
        try {
          await fetch(config.url, {
            method: "DELETE",
            headers: headers(),
          });
        } catch {
          // ignore
        }
        sessionId = null;
      }
    },
    setAuthHeader(v) {
      authHeader = v;
    },
  };
}

/** Legacy SSE transport: GET the endpoint, read the `endpoint` event, POST there. */
export function createSseTransport(
  config: McpServerConfig,
  env: Record<string, string>,
): McpTransport {
  let authHeader: string | null = null;
  let messageUrl: string | null = null;
  let sseCtrl: AbortController | null = null;
  let nextId = 1;
  const pending = new Map<
    number | string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  function headers(): Record<string, string> {
    const h: Record<string, string> = {
      ...expandEnvHeaders(config.headers, env),
    };
    if (authHeader) h["Authorization"] = authHeader;
    return h;
  }

  function handleMessage(msg: JsonRpcResponse) {
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
      else p.resolve(msg.result);
    }
  }

  async function postMessage(payload: string, timeoutMs: number): Promise<void> {
    if (!messageUrl) throw new Error("MCP SSE: not connected");
    const res = await fetch(messageUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers() },
      body: payload,
    });
    if (res.status === 401) throw new Error("MCP_UNAUTHORIZED");
    if (!res.ok) throw new Error(`MCP HTTP ${res.status}`);
    // Legacy SSE: response is 202 Accepted, result arrives on the event stream.
  }

  return {
    async connect(): Promise<void> {
      sseCtrl = new AbortController();
      const endpointReady = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("MCP SSE: no endpoint event")), 15000);
        (async () => {
          try {
            const res = await fetch(config.url, {
              headers: { Accept: "text/event-stream", ...headers() },
              signal: sseCtrl!.signal,
            });
            if (res.status === 401) throw new Error("MCP_UNAUTHORIZED");
            if (!res.ok || !res.body) throw new Error(`MCP SSE HTTP ${res.status}`);
            await readSseMessages(
              res.body,
              (data, event) => {
                if (event === "endpoint" || (!event && data.startsWith("/"))) {
                  const raw = data.trim();
                  try {
                    messageUrl = new URL(raw, config.url).toString();
                  } catch {
                    messageUrl = raw;
                  }
                  clearTimeout(timer);
                  resolve();
                } else if (data.startsWith("{")) {
                  try {
                    handleMessage(JSON.parse(data) as JsonRpcResponse);
                  } catch {
                    // ignore
                  }
                }
              },
              sseCtrl!.signal,
            );
          } catch (e) {
            clearTimeout(timer);
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        })();
      });
      await endpointReady;
    },
    async request(req, timeoutMs): Promise<unknown> {
      const id = req.id ?? nextId++;
      const payload: JsonRpcRequest = { jsonrpc: "2.0", id, method: req.method, params: req.params };
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`MCP request timed out: ${req.method}`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        postMessage(JSON.stringify(payload), timeoutMs).catch((e) => {
          pending.delete(id);
          clearTimeout(timer);
          reject(e instanceof Error ? e : new Error(String(e)));
        });
      });
    },
    async notify(method, params): Promise<void> {
      await postMessage(
        JSON.stringify({ jsonrpc: "2.0", method, params }),
        config.timeoutMs ?? 15000,
      );
    },
    async close(): Promise<void> {
      sseCtrl?.abort();
      sseCtrl = null;
      messageUrl = null;
      for (const [id, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new Error("MCP transport closed"));
        pending.delete(id);
      }
    },
    setAuthHeader(v) {
      authHeader = v;
    },
  };
}

export function createTransport(
  config: McpServerConfig,
  env: Record<string, string>,
): McpTransport {
  return config.transport === "sse"
    ? createSseTransport(config, env)
    : createHttpTransport(config, env);
}
