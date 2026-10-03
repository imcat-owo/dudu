/**
 * Dual-backend sandbox: the AI's code/command execution environment.
 *
 * Two backends, switchable in-app (her requirement 2026-10-03):
 * - Backend A ("cloud"): Docker containers on her cloud server, reached over SSH.
 * - Backend B ("local"): in-app Linux via iSH, following OpenMinis's approach
 *   (OpenMinis/ish-arm64 fork: Alpine aarch64 guest in the app process).
 *
 * Both implement SandboxBackend. The UI and the AI tools talk only to the
 * interface — never to a concrete backend.
 */

/** Which sandbox backend is active. Persisted; user-switchable in-app. */
export type SandboxBackendId = "cloud" | "local";

/** Connection state of a backend. Honest — never claims connected when it isn't. */
export type SandboxConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "unavailable" // backend cannot run in this build (e.g. native module missing)
  | "error";

/** A Docker container (Backend A) or sandbox environment (Backend B). */
export interface SandboxEnvironment {
  id: string;
  name: string;
  /** e.g. "running" | "exited" | "paused" (docker) or "booted" (ish). */
  status: string;
  image?: string;
}

/** Result of a run-to-completion command. */
export interface SandboxCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

/** Chunk of streaming output from a running command / terminal session. */
export interface SandboxOutputChunk {
  stream: "stdout" | "stderr";
  data: string;
}

/** SSH connection config for Backend A. All fields user-filled; never hardcoded. */
export interface SshConfig {
  host: string;
  port: number;
  username: string;
  /** "key" | "password" */
  authType: "key" | "password";
  /** Private key PEM text (SecureStore) or null when using password auth. */
  privateKey: string | null;
  /** Password (SecureStore) or null when using key auth. */
  password: string | null;
}

/**
 * The contract every sandbox backend implements.
 *
 * Backend A talks to Docker over SSH; Backend B talks to the in-app iSH
 * kernel. Callers never know which.
 */
export interface SandboxBackend {
  readonly id: SandboxBackendId;
  /** Human name for UI (i18n key, not a literal). */
  readonly nameKey: string;
  /** Current connection state. */
  connectionState(): SandboxConnectionState;
  /** Human-readable reason when state is "unavailable" or "error" (i18n key or literal). */
  stateDetail(): string | null;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** List runnable environments (containers / VMs). */
  listEnvironments(): Promise<SandboxEnvironment[]>;
  startEnvironment(id: string): Promise<void>;
  stopEnvironment(id: string): Promise<void>;
  /**
   * Run a command to completion inside an environment.
   * onChunk receives streaming output; returns the final result.
   */
  runCommand(
    envId: string,
    command: string,
    onChunk?: (chunk: SandboxOutputChunk) => void,
  ): Promise<SandboxCommandResult>;
}
