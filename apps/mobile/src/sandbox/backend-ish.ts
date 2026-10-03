/**
 * Backend B: local sandbox — in-app Linux via iSH, following OpenMinis's approach.
 *
 * OpenMinis runs a customized iSH fork (OpenMinis/ish-arm64: Alpine aarch64
 * guest, Asbestos emulator) inside the app process. Their stack:
 * - ISHKernel (ObjC singleton): boot sequence, executeCommand(_:),
 *   executeCommandAndWait(_:timeout:completion:), sendInput(_:),
 *   outputCallback, setTerminalSize, bind mounts, DNS refresh
 * - RootfsManager (Swift): Alpine rootfs lifecycle in ~/Documents/alpine-rootfs/
 * - ISHExecutionCoordinator (Swift): serialized, session-aware command dispatch
 *   (one command at a time, FIFO, 10-min preemption, 100KB buffer cap)
 * - Native offloads: guest execve() on registered paths routes to iOS handlers
 *
 * This adapter implements SandboxBackend against that native contract.
 * The iSH kernel + rootfs are native build artifacts NOT bundled in this
 * Expo JS build — so this backend honestly reports "unavailable" until the
 * native module is integrated. No fake Linux, no fake command results.
 *
 * What IS real here: the full JS adapter, the native module contract
 * (NativeISHModule), boot/environment semantics, and the UI/API wiring.
 * Dropping in the native module is the only remaining step.
 */
import type {
  SandboxBackend,
  SandboxCommandResult,
  SandboxConnectionState,
  SandboxEnvironment,
  SandboxOutputChunk,
} from "./types";

/**
 * Native module contract, derived from OpenMinis's ISHKernel / ISHShellExecutor.
 * An Expo native module (or TurboModule) implementing iSH must expose these.
 */
export interface NativeISHModule {
  /** Boot the kernel + mount rootfs. Resolves when the shell prompt is ready. */
  boot(): Promise<void>;
  /** Is the kernel booted? */
  isBooted(): boolean;
  /**
   * Run a command to completion. Streams output via onOutput.
   * Mirrors ISHShellExecutor: timeout, exit code, duration.
   */
  executeCommandAndWait(
    command: string,
    timeoutMs: number,
    onOutput: (stream: "stdout" | "stderr", data: string) => void,
  ): Promise<{ exitCode: number; durationMs: number }>;
  /** Shut the kernel down. */
  shutdown(): Promise<void>;
}

/** Resolve the native module if the host app bundled it. Null in Expo Go / web. */
export function resolveNativeISH(): NativeISHModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require("./native-ish-shim") as { default?: NativeISHModule };
    return m?.default ?? null;
  } catch {
    return null;
  }
}

export class IshSandboxBackend implements SandboxBackend {
  readonly id = "local" as const;
  readonly nameKey = "sandbox.backend.local";

  private native: NativeISHModule | null;
  private state: SandboxConnectionState;
  private detail: string | null;

  constructor(native?: NativeISHModule | null) {
    // Injectable for tests; otherwise resolve from the host app.
    this.native = native === undefined ? resolveNativeISH() : native;
    if (this.native) {
      this.state = "disconnected";
      this.detail = null;
    } else {
      this.state = "unavailable";
      this.detail = "sandbox.local.nativeRequired";
    }
  }

  connectionState(): SandboxConnectionState {
    return this.state;
  }

  stateDetail(): string | null {
    return this.detail;
  }

  async connect(): Promise<void> {
    if (!this.native) {
      this.state = "unavailable";
      this.detail = "sandbox.local.nativeRequired";
      throw new Error("sandbox.local.nativeRequired");
    }
    this.state = "connecting";
    try {
      await this.native.boot();
      this.state = "connected";
      this.detail = null;
    } catch (e) {
      this.state = "error";
      this.detail = e instanceof Error ? e.message : String(e);
      throw e;
    }
  }

  async disconnect(): Promise<void> {
    if (this.native && this.state === "connected") {
      await this.native.shutdown();
    }
    this.state = this.native ? "disconnected" : "unavailable";
  }

  /** iSH is a single environment: the Alpine guest. */
  async listEnvironments(): Promise<SandboxEnvironment[]> {
    this.requireConnected();
    return [
      { id: "alpine", name: "Alpine Linux (iSH)", status: "booted", image: "alpine/aarch64" },
    ];
  }

  async startEnvironment(id: string): Promise<void> {
    this.requireConnected();
    if (id !== "alpine") throw new Error("sandbox.local.unknownEnv");
    // The guest is the kernel itself; boot == start.
  }

  async stopEnvironment(_id: string): Promise<void> {
    await this.disconnect();
  }

  async runCommand(
    _envId: string,
    command: string,
    onChunk?: (chunk: SandboxOutputChunk) => void,
  ): Promise<SandboxCommandResult> {
    this.requireConnected();
    const native = this.native;
    if (!native) throw new Error("sandbox.local.nativeRequired");
    let stdout = "";
    let stderr = "";
    const { exitCode, durationMs } = await native.executeCommandAndWait(
      command,
      120_000,
      (stream, data) => {
        if (stream === "stdout") stdout += data;
        else stderr += data;
        onChunk?.({ stream, data });
      },
    );
    return { stdout, stderr, exitCode, durationMs };
  }

  private requireConnected(): void {
    if (this.state !== "connected" || !this.native?.isBooted()) {
      throw new Error("sandbox.notConnected");
    }
  }
}
