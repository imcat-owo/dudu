/**
 * SSH transport interface for Backend A (cloud Docker).
 *
 * Why an interface: React Native / Expo has no TCP sockets and no production
 * SSH client library (ssh2 is Node-only; react-native-ssh is archived), so
 * the app cannot open an SSH session by itself. The bundled implementation
 * is RelaySshTransport (transport-relay.ts): the app talks HTTPS to the
 * sandbox relay (sandbox-relay/relay.mjs) on her server, and the relay opens
 * the REAL SSH session (real handshake + key/password auth via the system
 * ssh client). UnavailableSshTransport remains as the honest fallback for
 * tests / builds without the relay.
 *
 * A transport implements:
 * - connect(config): open the SSH session (key or password auth)
 * - exec(command): run to completion, capture stdout/stderr/exit code
 * - shell(onData): open an interactive shell channel with streaming output
 * - close(): tear down
 */
import type { SandboxCommandResult, SandboxOutputChunk, SshConfig } from "./types";

export interface SshTransport {
  connect(config: SshConfig): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  exec(command: string): Promise<SandboxCommandResult>;
  /**
   * Open an interactive shell. Returns a handle; onChunk streams output.
   * write() sends input; close() ends the session.
   */
  shell(onChunk: (chunk: SandboxOutputChunk) => void): Promise<SshShellHandle>;
}

export interface SshShellHandle {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

/**
 * Placeholder transport: honestly reports that no SSH implementation is
 * bundled. Every method throws a typed error — never fake success.
 */
export class UnavailableSshTransport implements SshTransport {
  private reason: string;
  constructor(reason = "sandbox.transportUnavailable") {
    this.reason = reason;
  }
  connect(): Promise<void> {
    return Promise.reject(new Error(this.reason));
  }
  disconnect(): Promise<void> {
    return Promise.resolve();
  }
  isConnected(): boolean {
    return false;
  }
  exec(): Promise<SandboxCommandResult> {
    return Promise.reject(new Error(this.reason));
  }
  shell(): Promise<SshShellHandle> {
    return Promise.reject(new Error(this.reason));
  }
}
