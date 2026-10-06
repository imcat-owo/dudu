/**
 * Real verification for the coding loop: tsc + biome + tests.
 *
 * Nothing here is faked — each check shells out to the actual tool inside
 * the workspace and reports its real exit code and output. When a check
 * cannot run (missing node_modules, missing binary), it reports `skipped`
 * with the reason instead of pretending to pass.
 *
 * PURE module: the command runner is injected (sandbox in prod, local in
 * tests). Command construction is exported for unit tests.
 */

import type { FileRunner } from "./executor";
import type { CodingCheckResult } from "./types";
import {
  biomeCommand,
  DUDU_LAYOUT,
  deriveTestFiles,
  isPathSafe,
  type ProjectLayout,
  testCommand,
  tscCommand,
} from "./workspace";

export interface VerifyOptions {
  /** Run tsc --noEmit on apps/mobile. Default true. */
  tsc?: boolean;
  /** Run biome check on touched files. Default true. */
  biome?: boolean;
  /** Explicit test files (repo-relative), or "auto" to derive from touched files. */
  tests?: string[] | "auto";
}

const MAX_OUTPUT = 6000;

function trimOut(s: string): string {
  const t = s.trim();
  return t.length > MAX_OUTPUT ? `${t.slice(0, MAX_OUTPUT)}\n…(truncated)` : t;
}

function skip(reason: string, blocked = false): CodingCheckResult {
  return { ok: !blocked, skipped: reason, blocked: blocked || undefined, output: "" };
}

function fail(output: string): CodingCheckResult {
  return { ok: false, output: trimOut(output) };
}

function pass(output: string): CodingCheckResult {
  return { ok: true, output: trimOut(output) };
}

async function hasDir(runner: FileRunner, rel: string): Promise<boolean> {
  const r = await runner.run(`[ -d '${rel}' ] && echo YES || echo NO`);
  return r.exitCode === 0 && r.stdout.trim() === "YES";
}

async function hasFile(runner: FileRunner, rel: string): Promise<boolean> {
  const r = await runner.run(`[ -f '${rel}' ] && echo YES || echo NO`);
  return r.exitCode === 0 && r.stdout.trim() === "YES";
}

export interface VerifyInput {
  runner: FileRunner;
  /** Repo-relative touched files (for biome scope + test derivation). */
  touchedFiles: string[];
  opts?: VerifyOptions;
  layout?: ProjectLayout;
}

/**
 * Run the full verification suite. Returns a structured result the model
 * uses for the fix round — and that complete() requires to be green.
 */
export async function runVerification(input: VerifyInput): Promise<{
  tsc: CodingCheckResult;
  biome: CodingCheckResult;
  tests: CodingCheckResult;
}> {
  const { runner, touchedFiles } = input;
  const opts = input.opts ?? {};
  const layout = input.layout ?? DUDU_LAYOUT;
  const wantTsc = opts.tsc !== false;
  const wantBiome = opts.biome !== false;

  // --- prerequisites (honest, never assumed) ---
  const node = await runner.run(`command -v node >/dev/null && echo YES || echo NO`);
  const hasNode = node.exitCode === 0 && node.stdout.trim() === "YES";
  if (!hasNode) {
    const reason = "node 不可用：沙箱环境里没有 node，先装好再验证";
    return { tsc: skip(reason, true), biome: skip(reason, true), tests: skip(reason, true) };
  }
  const rootDeps = await hasDir(runner, "node_modules");

  // --- tsc ---
  let tsc: CodingCheckResult;
  if (!wantTsc) {
    tsc = skip("tsc 已跳过（调用方指定）");
  } else if (!(await hasDir(runner, `${layout.appDir}/node_modules`))) {
    tsc = skip(
      `${layout.appDir}/node_modules 缺失：依赖没装，tsc 跑不了（先在计划里加一步安装依赖）`,
      true,
    );
  } else {
    const r = await runner.run(tscCommand(layout.appDir));
    tsc = r.exitCode === 0 ? pass(r.stdout || "tsc clean") : fail(`${r.stdout}\n${r.stderr}`);
  }

  // --- biome (only the touched files; repo-relative, must be path-safe) ---
  let biome: CodingCheckResult;
  const safeFiles = touchedFiles.filter(isPathSafe);
  if (!wantBiome) {
    biome = skip("biome 已跳过（调用方指定）");
  } else if (!rootDeps) {
    biome = skip("根目录 node_modules 缺失：biome 跑不了", true);
  } else if (safeFiles.length === 0) {
    biome = pass("没有改动文件，biome 无需运行");
  } else {
    const r = await runner.run(biomeCommand(safeFiles));
    biome = r.exitCode === 0 ? pass(r.stdout || "biome clean") : fail(`${r.stdout}\n${r.stderr}`);
  }

  // --- tests ---
  let tests: CodingCheckResult;
  let testFiles: string[] = [];
  if (opts.tests === undefined || opts.tests === "auto") {
    const candidates = deriveTestFiles(safeFiles, layout);
    for (const c of candidates) {
      if (await hasFile(runner, c)) testFiles.push(c);
    }
  } else {
    testFiles = opts.tests.filter(isPathSafe);
  }
  if (!rootDeps) {
    tests = skip("根目录 node_modules 缺失：tsx 跑不了", true);
  } else if (testFiles.length === 0) {
    tests = pass("没有关联的测试文件，tests 无需运行");
  } else {
    // tsx --test runs with cwd=appDir; strip the prefix for relative paths.
    const rel = testFiles.map((f) =>
      f.startsWith(`${layout.appDir}/`) ? f.slice(layout.appDir.length + 1) : f,
    );
    const r = await runner.run(`cd ${layout.appDir} && ${testCommand(rel)}`);
    tests = r.exitCode === 0 ? pass(`${r.stdout}\n${r.stderr}`) : fail(`${r.stdout}\n${r.stderr}`);
  }

  return { tsc, biome, tests };
}

/** Overall verdict + one-line summary for the log. */
export function summarizeVerify(r: {
  tsc: CodingCheckResult;
  biome: CodingCheckResult;
  tests: CodingCheckResult;
}): { ok: boolean; summary: string } {
  const parts: string[] = [];
  const push = (name: string, c: CodingCheckResult) => {
    parts.push(
      c.skipped ? `${name}: 跳过（${c.skipped}）` : `${name}: ${c.ok ? "通过" : "未通过"}`,
    );
  };
  push("tsc", r.tsc);
  push("biome", r.biome);
  push("tests", r.tests);
  // A blocked check (missing prerequisites) fails the round: nothing was
  // actually verified. "Nothing to check" skips (no touched files, no test
  // files) have ok=true and blocked unset, so they pass through.
  const ok = [r.tsc, r.biome, r.tests].every((c) => c.ok && !c.blocked);
  return { ok, summary: parts.join("；") };
}
