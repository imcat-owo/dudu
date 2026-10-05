/**
 * Backend A: cloud Docker — her cloud server's Docker, reached over SSH.
 *
 * Real and complete: connection config (SecureStore, user-filled, never
 * hardcoded), Docker protocol (list/start/stop/exec with output parsing),
 * streaming command execution. It talks to the SshTransport interface.
 *
 * The bundled transport is RelaySshTransport (transport-relay.ts): the app
 * talks HTTPS to the sandbox relay on her server, and the relay opens the
 * REAL SSH session (real handshake + key/password auth via the system ssh
 * client). Output is never faked. When no SSH config is saved, connect()
 * fails honestly with sandbox.cloud.noConfig instead of pretending.
 *
 * Docker commands use stable `--format` templates (documented Docker CLI).
 */

import { type SshShellHandle, type SshTransport, UnavailableSshTransport } from "./transport";
import type {
  SandboxBackend,
  SandboxCommandResult,
  SandboxConnectionState,
  SandboxEnvironment,
  SandboxOutputChunk,
  SshConfig,
} from "./types";

/** Parse one `docker ps --format '{{json .}}'` line into an environment. */
export function parseDockerPsLine(line: string): SandboxEnvironment | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const o = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof o.ID !== "string" || typeof o.Names !== "string") return null;
    return {
      id: o.ID,
      name: o.Names,
      status: typeof o.State === "string" ? o.State : "unknown",
      image: typeof o.Image === "string" ? o.Image : undefined,
    };
  } catch {
    return null;
  }
}

/** Shell-escape a single argument for safe inclusion in a remote command. */
export function shellEscape(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

export class SshDockerBackend implements SandboxBackend {
  readonly id = "cloud" as const;
  readonly nameKey = "sandbox.backend.cloud";

  private transport: SshTransport;
  private config: SshConfig | null = null;
  private state: SandboxConnectionState = "disconnected";
  private detail: string | null = null;

  constructor(transport?: SshTransport) {
    this.transport = transport ?? new UnavailableSshTransport();
  }

  connectionState(): SandboxConnectionState {
    return this.state;
  }

  stateDetail(): string | null {
    return this.detail;
  }

  /** Set (or replace) the connection config. Stored by the manager in SecureStore. */
  setConfig(config: SshConfig | null): void {
    this.config = config;
  }

  /** Swap the transport (used by the manager to inject the relay transport). */
  setTransport(transport: SshTransport): void {
    this.transport = transport;
  }

  /**
   * Open an interactive shell. When `container` is given, the shell attaches
   * into that container (`docker exec -i`); otherwise it's the host shell.
   * Used by the sandbox_shell_* AI tools via interactive-terminal.ts.
   */
  async openShell(
    container?: string,
    onData?: (chunk: string) => void,
  ): Promise<SshShellHandle> {
    this.requireConnected();
    const handle = await this.transport.shell((chunk) =>
      onData?.(chunk.data),
    );
    if (container) {
      handle.write(`docker exec -i ${shellEscape(container)} sh\n`);
    }
    return handle;
  }

  async connect(): Promise<void> {
    if (!this.config) {
      this.state = "error";
      this.detail = "sandbox.cloud.noConfig";
      throw new Error("sandbox.cloud.noConfig");
    }
    this.state = "connecting";
    this.detail = null;
    try {
      await this.transport.connect(this.config);
      // Verify Docker is actually there before claiming connected.
      await this.transport.exec("docker info --format '{{json .ServerVersion}}'");
      this.state = "connected";
    } catch (e) {
      this.state = this.transport instanceof UnavailableSshTransport ? "unavailable" : "error";
      this.detail = e instanceof Error ? e.message : String(e);
      throw e;
    }
  }

  async disconnect(): Promise<void> {
    await this.transport.disconnect();
    this.state = "disconnected";
    this.detail = null;
  }

  /**
   * Recover from "error"/"unavailable" without an app restart.
   * Re-detects availability: still "unavailable" when no real SSH transport
   * is bundled, otherwise back to "disconnected" so she can retry.
   */
  reset(): void {
    if (this.transport instanceof UnavailableSshTransport) {
      this.state = "unavailable";
      this.detail = "sandbox.transportUnavailable";
    } else {
      this.state = "disconnected";
      this.detail = null;
    }
  }

  private requireConnected(): void {
    if (this.state !== "connected" || !this.transport.isConnected()) {
      throw new Error("sandbox.notConnected");
    }
  }

  async listEnvironments(): Promise<SandboxEnvironment[]> {
    this.requireConnected();
    const r = await this.transport.exec(`docker ps -a --format '{{json .}}'`);
    if (r.exitCode !== 0) throw new Error(r.stderr || "sandbox.docker.listFailed");
    return r.stdout
      .split("\n")
      .map(parseDockerPsLine)
      .filter((e): e is SandboxEnvironment => e !== null);
  }

  async startEnvironment(id: string): Promise<void> {
    this.requireConnected();
    const r = await this.transport.exec(`docker start ${shellEscape(id)}`);
    if (r.exitCode !== 0) throw new Error(r.stderr || "sandbox.docker.startFailed");
  }

  async stopEnvironment(id: string): Promise<void> {
    this.requireConnected();
    const r = await this.transport.exec(`docker stop ${shellEscape(id)}`);
    if (r.exitCode !== 0) throw new Error(r.stderr || "sandbox.docker.stopFailed");
  }

  async runCommand(
    envId: string,
    command: string,
    onChunk?: (chunk: SandboxOutputChunk) => void,
  ): Promise<SandboxCommandResult> {
    this.requireConnected();
    const startedAt = Date.now();
    const marker = `__DUDU_EXIT_${Date.now()}__`;
    let stdout = "";
    let stderr = "";
    let settled = false;
    let resolveDone!: (r: SandboxCommandResult) => void;
    let rejectDone!: (e: Error) => void;
    const done = new Promise<SandboxCommandResult>((res, rej) => {
      resolveDone = res;
      rejectDone = rej;
    });
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        rejectDone(new Error("sandbox.command.timeout"));
      }
    }, 120_000);
    const settleResult = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveDone({
        stdout,
        stderr,
        exitCode: code,
        durationMs: Date.now() - startedAt,
      });
    };
    // One stream callback serves both: live chunks to the caller and
    // accumulation for the final result. \r\n from the pty is normalized so
    // the exit marker scan and the returned text stay clean.
    //
    // Marker scan is line-based and anchored: with a pty the typed command
    // is echoed, and the echo literally contains the marker text (inside
    // `echo "<marker>:$?"`). A substring search would match the echo first
    // and parse `$?"` as the exit code. Only a full line shaped exactly
    // `<marker>:<digits>` counts — the echo line never has that shape.
    const markerLineRe = new RegExp(`^${marker}:(\\d+)\\s*$`, "gm");
    const handle = await this.transport.shell((chunk) => {
      onChunk?.(chunk);
      if (settled) return;
      const text = chunk.data.replace(/\r\n?/g, "\n");
      if (chunk.stream === "stdout") stdout += text;
      else stderr += text;
      markerLineRe.lastIndex = 0;
      let last: RegExpExecArray | null = null;
      for (;;) {
        const m = markerLineRe.exec(stdout);
        if (!m) break;
        last = m;
      }
      if (last) {
        const code = Number.parseInt(last[1], 10);
        stdout = stdout.slice(0, last.index);
        settleResult(Number.isNaN(code) ? -1 : code);
      }
    });
    try {
      // Disable input echo first: otherwise the wrapped command (which
      // literally contains the marker text) is echoed back and pollutes
      // the output. Each runCommand gets a fresh shell, so this is safe.
      // lastIndexOf above is the belt-and-suspenders fallback.
      handle.write("stty -echo\n");
      // Wrap the command so completion + exit code are detectable on the stream.
      handle.write(
        `docker exec -i ${shellEscape(envId)} sh -c ${shellEscape(command)}; echo "${marker}:$?"\n`,
      );
      return await done;
    } finally {
      handle.close();
    }
  }
}
