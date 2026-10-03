/**
 * Backend A: cloud Docker — her cloud server's Docker, reached over SSH.
 *
 * Real and complete: connection config (SecureStore, user-filled, never
 * hardcoded), Docker protocol (list/start/stop/exec with output parsing),
 * streaming command execution. It talks to the SshTransport interface;
 * until a real SSH socket implementation is bundled, connect() honestly
 * reports "unavailable" via the transport — never fake-connected.
 *
 * Docker commands use stable `--format` templates (documented Docker CLI).
 */
import type {
  SandboxBackend,
  SandboxCommandResult,
  SandboxConnectionState,
  SandboxEnvironment,
  SandboxOutputChunk,
  SshConfig,
} from "./types";
import { UnavailableSshTransport, type SshTransport } from "./transport";

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
  setConfig(config: SshConfig): void {
    this.config = config;
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
    const marker = `__OPENMUSE_EXIT_${Date.now()}__`;
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
    // accumulation for the final result.
    const handle = await this.transport.shell((chunk) => {
      onChunk?.(chunk);
      if (settled) return;
      if (chunk.stream === "stdout") stdout += chunk.data;
      else stderr += chunk.data;
      const idx = stdout.indexOf(marker);
      if (idx >= 0) {
        const tail = stdout.slice(idx + marker.length + 1).split("\n")[0].trim();
        const code = Number.parseInt(tail, 10);
        stdout = stdout.slice(0, idx);
        settleResult(Number.isNaN(code) ? -1 : code);
      }
    });
    try {
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
