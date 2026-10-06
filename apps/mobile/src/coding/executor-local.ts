/**
 * Node-local FileRunner — for unit tests and the honest e2e demo only.
 *
 * Runs commands with cwd locked to a scratch workspace root via
 * child_process, reads/writes with node:fs. NEVER imported by app code
 * (Metro cannot resolve node: builtins); tests import this file directly.
 */

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { FileRunner, RunResult } from "./executor";
import { isPathSafe } from "./workspace";

const DEFAULT_TIMEOUT_MS = 180_000;

function resolveSafe(root: string, p: string): string {
  if (!isPathSafe(p)) throw new Error(`unsafe path: ${p}`);
  const abs = path.resolve(root, p);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`path escapes root: ${p}`);
  return abs;
}

export function createLocalRunner(root: string, timeoutMs = DEFAULT_TIMEOUT_MS): FileRunner {
  async function run(cmd: string): Promise<RunResult> {
    return new Promise((resolve) => {
      execFile(
        "sh",
        ["-c", cmd],
        { cwd: root, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
        (error, stdout, stderr) => {
          resolve({
            stdout: String(stdout ?? ""),
            stderr: String(stderr ?? ""),
            exitCode: typeof error?.code === "number" ? error.code : error ? 1 : 0,
          });
        },
      );
    });
  }
  return {
    run,
    async writeFile(p: string, content: string): Promise<void> {
      const abs = resolveSafe(root, p);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, "utf8");
    },
    async readFile(p: string): Promise<string | null> {
      const abs = resolveSafe(root, p);
      try {
        return await fs.readFile(abs, "utf8");
      } catch {
        return null;
      }
    },
    async exists(p: string): Promise<boolean> {
      const abs = resolveSafe(root, p);
      try {
        await fs.access(abs);
        return true;
      } catch {
        return false;
      }
    },
  };
}
