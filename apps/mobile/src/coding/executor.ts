/**
 * FileRunner: the coding loop's hands inside the sandbox backend.
 *
 * Prod implementation wraps the existing SandboxBackend.runCommand —
 * no new transport, no parallel file system. Writes go through base64
 * (never heredocs: content passes byte-identical, no quoting pitfalls).
 * Every path is validated by workspace.isPathSafe before it touches a
 * command line; every command is scoped to the workspace root.
 *
 * The node-local implementation (for tests / the honest e2e demo) lives
 * in executor-local.ts — importing node: builtins here would break the
 * Metro bundle.
 */

import type { SandboxBackend } from "../sandbox/types";
import { isPathSafe, scopeCommand } from "./workspace";

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CommandRunner {
  run(cmd: string): Promise<RunResult>;
}

export interface FileRunner extends CommandRunner {
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string | null>;
  exists(path: string): Promise<boolean>;
}

/** Base64 of content, safe to embed in a single-quoted shell string. */
export function toBase64(text: string): string {
  // btoa is unavailable for non-latin1; do the encoding manually.
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  // eslint-disable-next-line no-restricted-globals
  return typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
}

function shPath(path: string): string {
  if (!isPathSafe(path)) throw new Error(`unsafe path: ${path}`);
  return `'${path}'`;
}

/**
 * Prod runner: everything through the active SandboxBackend, scoped to
 * the workspace root. The backend must already be connected; the engine
 * checks that before the first command.
 */
export function createSandboxRunner(
  backend: SandboxBackend,
  envId: string,
  root: string,
): FileRunner {
  async function run(cmd: string): Promise<RunResult> {
    const r = await backend.runCommand(envId, scopeCommand(root, cmd));
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode };
  }
  return {
    run,
    async writeFile(path: string, content: string): Promise<void> {
      const p = shPath(path);
      const dir = path.split("/").slice(0, -1).join("/");
      const b64 = toBase64(content);
      const mk = dir ? `mkdir -p ${shPath(dir)} && ` : "";
      // printf %s avoids echo's backslash/newline mangling.
      const r = await run(`${mk}printf '%s' '${b64}' | base64 -d > ${p}`);
      if (r.exitCode !== 0) {
        throw new Error(`write failed for ${path}: ${(r.stderr || r.stdout).slice(0, 500)}`);
      }
    },
    async readFile(path: string): Promise<string | null> {
      const p = shPath(path);
      const r = await run(`if [ -f ${p} ]; then cat ${p}; else echo __CODING_MISSING__; fi`);
      if (r.exitCode !== 0) throw new Error(`read failed for ${path}`);
      const out = r.stdout.replace(/\n$/, "");
      return out === "__CODING_MISSING__" ? null : r.stdout;
    },
    async exists(path: string): Promise<boolean> {
      const p = shPath(path);
      const r = await run(`[ -e ${p} ] && echo YES || echo NO`);
      return r.stdout.trim() === "YES";
    },
  };
}
