/**
 * Coding engine: the plan → execute → verify → report loop.
 *
 * The model drives the loop through the `coding_task` tool; this module
 * holds the enforcement:
 * - approval gate: write/run/verify/complete all refuse unless she approved
 * - bounded retries: verify → fix → re-verify at most MAX_VERIFY_ATTEMPTS
 * - honest completion: "done" requires the latest verify round green;
 *   "failed" is always allowed but must say what failed
 * - every write/run/verify lands in the task's audit log
 * - complete() commits the touched files on the task branch (local commit,
 *   never push — merging is her call)
 *
 * PURE module: FileRunner + workspace root are injected.
 */

import type { FileRunner } from "./executor";
import type { CodingStore } from "./store";
import { type CodingTask, type CodingVerifyResult, MAX_VERIFY_ATTEMPTS } from "./types";
import { runVerification, summarizeVerify, type VerifyOptions } from "./verify";
import {
  buildCommitMessage,
  buildEnsureCommands,
  checkCommand,
  DEFAULT_REPO_URL,
  DUDU_LAYOUT,
  isPathSafe,
  type ProjectLayout,
  parsePorcelain,
} from "./workspace";

export interface CodingEngineDeps {
  store: CodingStore;
  /** Resolve the runner + workspace root for a task (sandbox in prod). */
  getRunner: (task: CodingTask) => Promise<{ runner: FileRunner; root: string }>;
  /** Repo URL, resolved lazily so settings changes apply. Defaults to the public fork. */
  getRepoUrl?: () => Promise<string>;
  /** Project layout for verification (defaults to the real app layout). */
  layout?: ProjectLayout;
  now?: () => number;
}

export class CodingError extends Error {}

/** The task must exist and be approved (or already in progress). */
function requireRunnable(store: CodingStore, taskId: string): CodingTask {
  const t = store.getTask(taskId);
  if (!t) throw new CodingError(`找不到 coding 任务 ${taskId}。`);
  if (t.status === "proposed")
    throw new CodingError(
      `计划还在等她拍板（proposed）。在她点批准之前，一步都不许执行——先提醒她看计划卡片。`,
    );
  if (t.status === "rejected")
    throw new CodingError(`她叫停了这个计划（rejected）。不要执行；想别的办法或问她。`);
  if (t.status === "done" || t.status === "failed")
    throw new CodingError(`任务已结束（${t.status}）。想继续，新开一个任务重新提计划。`);
  return t;
}

function markActive(store: CodingStore, t: CodingTask): void {
  if (t.status === "approved") store.setStatus(t.id, "in_progress");
}

/** Ensure the repo checkout + task branch exist in the sandbox env. */
export async function ensureTaskWorkspace(
  deps: CodingEngineDeps,
  task: CodingTask,
): Promise<{ runner: FileRunner; root: string }> {
  const { runner, root } = await deps.getRunner(task);
  const repoUrl = (await deps.getRepoUrl?.()) ?? DEFAULT_REPO_URL;
  const cmds = buildEnsureCommands(root, repoUrl, task.branch);
  // Step 1: does the checkout exist?
  const probe = await runner.run(cmds[0]);
  if (probe.exitCode !== 0) {
    throw new CodingError(
      `沙箱连上了，但工作区检查失败：${(probe.stderr || probe.stdout).slice(0, 300)}`,
    );
  }
  const hasGit = probe.stdout.includes("HAS_GIT");
  if (!hasGit) {
    deps.store.appendLog(task.id, "run", `工作区不存在，正在克隆 ${repoUrl} …`);
    const clone = await runner.run(cmds[1]);
    if (clone.exitCode !== 0) {
      throw new CodingError(
        `克隆仓库失败：${(clone.stderr || clone.stdout).slice(0, 500)}。检查沙箱环境的网络和 git。`,
      );
    }
  }
  const co = await runner.run(cmds[2]);
  if (co.exitCode !== 0 || !co.stdout.includes(task.branch)) {
    throw new CodingError(`切分支 ${task.branch} 失败：${(co.stderr || co.stdout).slice(0, 500)}`);
  }
  return { runner, root };
}

/** Write a file inside the workspace (approved tasks only). */
export async function writeTaskFile(
  deps: CodingEngineDeps,
  taskId: string,
  path: string,
  content: string,
): Promise<string> {
  const t = requireRunnable(deps.store, taskId);
  if (!isPathSafe(path)) throw new CodingError(`路径不合法（必须写在仓库里，不能含 ..）：${path}`);
  markActive(deps.store, t);
  const ensured = await ensureTaskWorkspace(deps, t).catch((e) => {
    throw e instanceof CodingError ? e : new CodingError(`工作区准备失败：${(e as Error).message}`);
  });
  await ensured.runner.writeFile(path, content);
  deps.store.touchFile(t.id, path);
  deps.store.appendLog(t.id, "write", `写文件 ${path}（${content.length} 字节）`);
  return `已写入 ${path}。`;
}

/** Run a shell command inside the workspace (approved tasks only). */
export async function runTaskCommand(
  deps: CodingEngineDeps,
  taskId: string,
  command: string,
): Promise<string> {
  const t = requireRunnable(deps.store, taskId);
  const denied = checkCommand(command);
  if (denied) throw new CodingError(`这个命令被安全规则拦下了（${denied.reason}），换个写法。`);
  markActive(deps.store, t);
  const { runner } = await ensureTaskWorkspace(deps, t);
  const r = await runner.run(command);
  const out = `${r.stdout}${r.stderr ? `\n[stderr]\n${r.stderr}` : ""}`.slice(0, 4000);
  deps.store.appendLog(
    t.id,
    "run",
    `$ ${command.slice(0, 200)}\nexit=${r.exitCode}\n${out.slice(0, 1200)}`,
  );
  return `exit=${r.exitCode}\n${out}`;
}

/** Run real verification (approved tasks only). Bounded by MAX_VERIFY_ATTEMPTS. */
export async function verifyTask(
  deps: CodingEngineDeps,
  taskId: string,
  opts?: VerifyOptions,
): Promise<CodingVerifyResult> {
  const t = requireRunnable(deps.store, taskId);
  if (t.attempts >= MAX_VERIFY_ATTEMPTS) {
    throw new CodingError(
      `验证已经用了 ${MAX_VERIFY_ATTEMPTS} 轮，没有通过。不要再修了——` +
        `用 complete 如实告诉她哪一步没过去、现在是什么状态。`,
    );
  }
  markActive(deps.store, t);
  const { runner } = await ensureTaskWorkspace(deps, t);
  const layout: ProjectLayout = deps.layout ?? DUDU_LAYOUT;
  const checks = await runVerification({ runner, touchedFiles: t.touchedFiles, opts, layout });
  const { ok, summary } = summarizeVerify(checks);
  const result: CodingVerifyResult = {
    ok,
    ...checks,
    attempt: 0, // filled by store.recordVerify
    summary,
  };
  const recorded = deps.store.recordVerify(t.id, result);
  if (!recorded) {
    throw new CodingError(`验证轮次已用完（${MAX_VERIFY_ATTEMPTS} 轮），用 complete 如实汇报。`);
  }
  const left = MAX_VERIFY_ATTEMPTS - t.attempts;
  deps.store.appendLog(
    t.id,
    ok ? "verify" : "fix",
    ok
      ? "验证通过，可以收尾了。"
      : `验证没通过${left > 0 ? `，还剩 ${left} 轮修复机会` : "，没有修复机会了"}。下面是真实报错，照着修：\n${[
          checks.tsc,
          checks.biome,
          checks.tests,
        ]
          .filter((c) => !c.ok)
          .map((c) => c.output)
          .join("\n---\n")
          .slice(0, 3000)}`,
  );
  return result;
}

/**
 * Finish a task. "done" requires the latest verify round green — the engine
 * checks, the model can't fake it. "failed" is always allowed but must say
 * what failed. Either way the touched files are committed on the task
 * branch (local commit only, never push).
 */
export async function completeTask(
  deps: CodingEngineDeps,
  taskId: string,
  outcome: "done" | "failed",
  summary: string,
): Promise<string> {
  const t = requireRunnable(deps.store, taskId);
  if (!summary.trim()) throw new CodingError("收尾必须写清楚做了什么、验证结果如何，不能空着。");
  if (outcome === "done") {
    const v = t.verify;
    if (!v?.ok) {
      throw new CodingError(
        `不能报"完成"：最近一轮验证没有通过（${v?.summary ?? "还没验证过"}）。` +
          `先修到验证通过，或者诚实地报"失败"并说清哪一步没过去。`,
      );
    }
  }
  // Commit touched files on the task branch (local only — merging is her call).
  let commitInfo = "无文件改动，未提交。";
  try {
    const { runner } = await ensureTaskWorkspace(deps, t);
    const st = await runner.run("git status --porcelain");
    const changed = parsePorcelain(st.stdout).filter((f) =>
      t.touchedFiles.some((tf) => f === tf || f.startsWith(tf.replace(/[^/]+$/, ""))),
    );
    const files = changed.length > 0 ? changed : t.touchedFiles.filter(isPathSafe);
    if (files.length > 0) {
      const add = await runner.run(`git add -- ${files.map((f) => `'${f}'`).join(" ")}`);
      if (add.exitCode === 0) {
        const msg = buildCommitMessage(t.id, t.title, files);
        // Message via stdin avoids quoting issues entirely.
        const b64 = Buffer.from(msg, "utf8").toString("base64");
        const cm = await runner.run(
          `printf '%s' '${b64}' | base64 -d | git commit -F - --author='dudu <dudu@localhost>'`,
        );
        if (cm.exitCode === 0) {
          const hash = await runner.run("git rev-parse --short HEAD");
          commitInfo = `已提交到分支 ${t.branch}（${hash.stdout.trim()}），${files.length} 个文件。没有 push，合并不合由她定。`;
        } else {
          commitInfo = `提交失败（可能没有实际改动）：${(cm.stderr || cm.stdout).slice(0, 300)}`;
        }
      }
    }
  } catch (e) {
    commitInfo = `提交步骤出错：${(e as Error).message}`;
  }
  deps.store.appendLog(t.id, "report", commitInfo);
  deps.store.complete(t.id, outcome, `${summary}\n${commitInfo}`);
  return outcome === "done"
    ? `任务完成。${summary}\n${commitInfo}`
    : `任务按"失败"如实收尾。${summary}\n${commitInfo}`;
}

/** Human-readable status for the model (the `status` action). */
export function describeTask(store: CodingStore, taskId: string): string {
  const t = store.getTask(taskId);
  if (!t) return `找不到任务 ${taskId}。`;
  const lines = [
    `任务「${t.title}」(${t.id})：${t.status}`,
    `分支：${t.branch}；验证轮次：${t.attempts}/${MAX_VERIFY_ATTEMPTS}；改动文件：${t.touchedFiles.length} 个`,
  ];
  if (t.verify) lines.push(`最近验证：${t.verify.ok ? "通过" : "未通过"} — ${t.verify.summary}`);
  const tail = t.log.slice(-5);
  if (tail.length > 0) {
    lines.push("最近日志：");
    for (const e of tail) lines.push(`- [${e.kind}] ${e.text.slice(0, 200)}`);
  }
  if (t.status === "proposed")
    lines.push("下一步：等她点计划卡片上的批准/不用了。批准前不许执行任何步骤。");
  else if (t.status === "approved" || t.status === "in_progress")
    lines.push(
      "下一步：用 write/run 执行计划步骤，每步都会记入日志；然后 verify 跑真实验证；通过后 complete 收尾。",
    );
  if (t.report) lines.push(`最终汇报：${t.report.slice(0, 500)}`);
  return lines.join("\n");
}

export type { CodingStore };
export { MAX_VERIFY_ATTEMPTS };
