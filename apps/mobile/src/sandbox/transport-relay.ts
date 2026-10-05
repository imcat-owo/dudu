/**
 * Relay SSH transport for Backend A (cloud Docker).
 *
 * Why a relay: React Native / Expo has no TCP sockets and no production SSH
 * client library (ssh2 is Node-only; react-native-ssh is archived), so the
 * app cannot open an SSH session by itself. Instead this transport talks
 * HTTPS to the dudu sandbox relay (see sandbox-relay/relay.mjs) running on
 * her server; the relay opens the REAL SSH session (real handshake, real
 * key/password auth via the system ssh client) and streams real output back.
 * Nothing is simulated: every byte of stdout/stderr and every exit code is
 * the genuine result of the remote command.
 *
 * URL: https://{host}/dudu-sandbox — her Caddy on 443 terminates TLS and
 * reverse-proxies to the relay on 127.0.0.1:18731 (see relay README).
 *
 * Security: the SSH credentials ARE the auth (no separate relay token can
 * exist without a second secret field she doesn't have). They travel only in
 * POST bodies over TLS, never in URLs, and are never logged. The secret is
 * kept in memory only while connected and wiped on disconnect().
 *
 * PURE module: no React Native imports — safe for node tests (fetch is
 * stubbed there). `baseUrlForTest` lets tests point at a local relay.
 */
import type { SshShellHandle, SshTransport } from "./transport";
import type { SandboxCommandResult, SandboxOutputChunk, SshConfig } from "./types";

const RELAY_PATH = "/dudu-sandbox";
const CONNECT_PROBE_TIMEOUT_MS = 15_000;
const POLL_TIMEOUT_MS = 30_000;
const POLL_MAX_FAILURES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface RelayResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

interface RelayChunk {
  seq: number;
  stream: string;
  data: string;
}

function isSshConfig(v: unknown): v is SshConfig {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.host === "string" &&
    typeof o.port === "number" &&
    typeof o.username === "string" &&
    (o.authType === "key" || o.authType === "password")
  );
}

export class RelaySshTransport implements SshTransport {
  private config: SshConfig | null = null;
  private connected = false;
  private baseOverride: string | null;
  private remoteShells = new Set<{ stop: () => void; closeRemote: () => void }>();

  /** baseUrlForTest: e.g. "http://127.0.0.1:18731/dudu-sandbox" for local tests. */
  constructor(baseUrlForTest?: string) {
    this.baseOverride = baseUrlForTest ?? null;
  }

  private base(): string {
    if (this.baseOverride) return this.baseOverride;
    if (!this.config) throw new Error("sandbox.notConnected");
    const host = this.config.host;
    // Host allowlist: plain hostname/IP only — no scheme, port, or path.
    // The relay is always reached via https://{host}/dudu-sandbox (Caddy, 443).
    if (!/^[A-Za-z0-9.-]{1,253}$/.test(host)) {
      throw new Error("sandbox.relay.badHost");
    }
    return `https://${host}${RELAY_PATH}`;
  }

  /** Credentials for the relay body. Never put these in a URL or a log. */
  private creds(): Record<string, unknown> {
    const c = this.config;
    if (!c || !isSshConfig(c)) throw new Error("sandbox.notConnected");
    return {
      host: c.host,
      port: c.port,
      username: c.username,
      authType: c.authType,
      privateKey: c.privateKey,
      password: c.password,
    };
  }

  private async fetchJson(
    path: string,
    init: { method: string; body?: unknown },
    timeoutMs: number,
  ): Promise<{ status: number; body: unknown }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.base()}${path}`, {
        method: init.method,
        headers: { "content-type": "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      let body: unknown = null;
      try {
        body = text ? (JSON.parse(text) as unknown) : null;
      } catch {
        body = { raw: text.slice(0, 300) };
      }
      return { status: res.status, body };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Extract a relay error string without ever touching secrets. */
  private static relayError(body: unknown, status: number): string {
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as Record<string, unknown>).error === "string"
    ) {
      return ((body as Record<string, unknown>).error as string).slice(0, 300);
    }
    return `http ${status}`;
  }

  private async post(
    path: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    let r: { status: number; body: unknown };
    try {
      r = await this.fetchJson(path, { method: "POST", body }, timeoutMs);
    } catch (e) {
      // Network failure: never leak which host (fine) — but never the secret.
      // this.base() contains only the host, safe to mention.
      throw new Error(`sandbox.relay.unreachable: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (r.status !== 200) {
      throw new Error(
        `sandbox.relay.requestFailed: ${RelaySshTransport.relayError(r.body, r.status)}`,
      );
    }
    return r.body as Record<string, unknown>;
  }

  private async getJson(path: string, timeoutMs: number): Promise<Record<string, unknown>> {
    let r: { status: number; body: unknown };
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(`${this.base()}${path}`, { signal: ctrl.signal });
        const text = await res.text();
        r = { status: res.status, body: text ? (JSON.parse(text) as unknown) : null };
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      throw new Error(`sandbox.relay.unreachable: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (r.status !== 200) {
      throw new Error(
        `sandbox.relay.requestFailed: ${RelaySshTransport.relayError(r.body, r.status)}`,
      );
    }
    return r.body as Record<string, unknown>;
  }

  private async execRaw(command: string, timeoutMs: number): Promise<RelayResult> {
    const body = await this.post(
      "/exec",
      { ...this.creds(), command, timeoutMs },
      timeoutMs + 10_000,
    );
    return {
      stdout: typeof body.stdout === "string" ? body.stdout : "",
      stderr: typeof body.stderr === "string" ? body.stderr : "",
      exitCode: typeof body.exitCode === "number" ? body.exitCode : -1,
      durationMs: typeof body.durationMs === "number" ? body.durationMs : 0,
    };
  }

  async connect(config: SshConfig): Promise<void> {
    if (!isSshConfig(config)) throw new Error("sandbox.cloud.noConfig");
    this.config = config;
    this.connected = false;
    // Probe: a real SSH session must open before we claim anything.
    const r = await this.execRaw("true", CONNECT_PROBE_TIMEOUT_MS);
    if (r.exitCode !== 0) {
      throw new Error(
        `sandbox.relay.probeFailed: ${(r.stderr || "ssh probe failed").slice(0, 300)}`,
      );
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    for (const s of Array.from(this.remoteShells)) {
      try {
        s.stop();
        s.closeRemote();
      } catch {
        /* best effort */
      }
    }
    this.remoteShells.clear();
    this.connected = false;
    // Wipe the secret from memory; reconnect() re-supplies it via connect().
    this.config = null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private requireConnected(): void {
    if (!this.connected || !this.config) throw new Error("sandbox.notConnected");
  }

  async exec(command: string): Promise<SandboxCommandResult> {
    this.requireConnected();
    return this.execRaw(command, 120_000);
  }

  async shell(onChunk: (chunk: SandboxOutputChunk) => void): Promise<SshShellHandle> {
    this.requireConnected();
    const creds = this.creds();
    const open = await this.post("/shell/open", { ...creds, cols: 80, rows: 24 }, 20_000);
    const shellId = String(open.shellId || "");
    if (!shellId) throw new Error("sandbox.relay.requestFailed: no shellId");
    const encId = encodeURIComponent(shellId);

    let closed = false;
    let cursor = 0;
    const entry = {
      stop: () => {
        closed = true;
      },
      closeRemote: () => {
        void this.post(`/shell/${encId}/close`, {}, 8_000).catch(() => {});
      },
    };
    this.remoteShells.add(entry);

    const pollLoop = async (): Promise<void> => {
      let failures = 0;
      while (!closed) {
        try {
          const r = await this.getJson(`/shell/${encId}/poll?cursor=${cursor}`, POLL_TIMEOUT_MS);
          failures = 0;
          if (closed) break;
          const chunks: RelayChunk[] = Array.isArray(r.chunks) ? r.chunks : [];
          for (const c of chunks) {
            cursor = c.seq;
            onChunk({
              stream: c.stream === "stderr" ? "stderr" : "stdout",
              data: String(c.data ?? ""),
            });
          }
          if (r.closed) break;
          // Yield to the event loop between empty polls: without this, a
          // fast-responding relay turns the loop into a microtask busy-spin
          // that starves timers (and burns CPU/battery on device).
          if (chunks.length === 0) await sleep(1000);
        } catch {
          failures += 1;
          if (failures >= POLL_MAX_FAILURES || closed) break;
          await sleep(1000 * failures);
        }
      }
      this.remoteShells.delete(entry);
    };
    void pollLoop();

    return {
      write: (data: string) => {
        if (!closed && data) {
          void this.post(`/shell/${encId}/write`, { data }, 10_000).catch(() => {});
        }
      },
      resize: (cols: number, rows: number) => {
        if (!closed) {
          void this.post(`/shell/${encId}/resize`, { cols, rows }, 10_000).catch(() => {});
        }
      },
      close: () => {
        if (closed) return;
        closed = true;
        entry.closeRemote();
        this.remoteShells.delete(entry);
      },
    };
  }
}
