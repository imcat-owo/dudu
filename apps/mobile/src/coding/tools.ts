/**
 * coding_task — the coding-agent loop's single entry point (E3).
 *
 * Protocol for the AI (this is the loop; follow it exactly):
 * 1. 她让你改代码/加功能/修 bug → action=propose，写出具体计划
 *    （标题、她原话的需求、每一步、每步碰哪些文件、改完长什么样、
 *    什么叫"做完"）。计划卡片会出现在对话框里。
 * 2. 等她点卡片上的"批准"或"不用了"。批准前一步都不许执行——
 *    用 action=status 查状态，只有 approved 才能动手。
 * 3. 开工：action=write 写文件、action=run 跑命令（都记入任务日志，
 *    路径锁在仓库里，危险命令会被拦）。
 * 4. action=verify 跑真实验证（tsc + biome + 相关测试，都在沙箱的
 *    仓库 checkout 里真跑）。没通过就修、再 verify，最多 3 轮——
 *    工具会数轮次，第 4 轮直接拒绝。
 * 5. action=complete 收尾："done" 要求最近一轮验证全绿（工具会查，
 *    编不了）；"failed" 随时可以，但必须说清哪一步没过去。
 *    收尾时改动会提交到任务分支（只提交、不 push）。
 *
 * 授权：计划卡片的批准就是她的授权（删改先经她同意），执行中不再
 * 逐条弹窗。无痕模式下整个工具不可用。
 */

import { type LocalTool, ToolError } from "../api-groups/local-tools";
import {
  type CodingEngineDeps,
  completeTask,
  describeTask,
  ensureTaskWorkspace,
  runTaskCommand,
  verifyTask,
  writeTaskFile,
} from "./engine";
import type { CodingStore } from "./store";
import type { CodingTask } from "./types";
import type { VerifyOptions } from "./verify";

export interface CodingToolDeps {
  store: CodingStore;
  /** Resolve sandbox runner + workspace root. Throws honestly when unavailable. */
  getRunner: CodingEngineDeps["getRunner"];
  getRepoUrl?: CodingEngineDeps["getRepoUrl"];
  layout?: CodingEngineDeps["layout"];
  isIncognito?: () => boolean;
}

const ACTIONS = ["propose", "status", "write", "run", "verify", "complete"] as const;
type Action = (typeof ACTIONS)[number];

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

export function createCodingTools(threadId: string, deps: CodingToolDeps): LocalTool[] {
  const engineDeps: CodingEngineDeps = {
    store: deps.store,
    getRunner: deps.getRunner,
    getRepoUrl: deps.getRepoUrl,
    layout: deps.layout,
  };

  return [
    {
      name: "coding_task",
      description:
        "改代码/加功能/修 bug 的闭环（计划→执行→验证→汇报）。她让你动代码时走这个，不要直接用 sandbox_run 瞎改。流程：①action=propose 写具体计划（标题、她原话的需求、每一步做什么+碰哪些文件、改完长什么样、什么叫'做完'），计划卡片发给她看；②等她点批准——批准前一步不许执行，用 action=status 查；③批准后用 action=write 写文件、action=run 跑命令；④action=verify 跑真实验证（tsc+biome+测试），不过就修再验，最多3轮；⑤action=complete 收尾，'done'必须验证全绿（工具会查），'failed'要说清哪步没过。验证都是真跑的，失败不许瞒。无痕模式不可用。",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [...ACTIONS],
            description:
              "propose=提计划，status=查状态，write=写文件，run=跑命令，verify=真实验证，complete=收尾汇报",
          },
          task_id: {
            type: "string",
            description: "任务 id（propose 会返回；status/write/run/verify/complete 必填）",
          },
          title: { type: "string", description: "propose: 计划标题，一句话" },
          request: { type: "string", description: "propose: 她的原话需求" },
          steps: {
            type: "array",
            description: "propose: 计划步骤，每步写清做什么、碰哪些文件",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                detail: { type: "string" },
                files: {
                  type: "string",
                  description: "逗号分隔的仓库相对路径，如 apps/mobile/src/foo.ts",
                },
              },
              required: ["title"],
              additionalProperties: false,
            },
          },
          expected_outcome: { type: "string", description: "propose: 改完长什么样" },
          done_criteria: { type: "string", description: "propose: 什么叫'做完'，怎么算验证通过" },
          path: { type: "string", description: "write: 仓库相对路径，如 apps/mobile/src/foo.ts" },
          content: { type: "string", description: "write: 文件完整内容" },
          command: { type: "string", description: "run: 在仓库根执行的 shell 命令" },
          tests: {
            type: "array",
            description: "verify: 指定跑哪些测试文件（仓库相对路径）；不填则按改动文件自动找",
            items: { type: "string" },
          },
          outcome: {
            type: "string",
            enum: ["done", "failed"],
            description: "complete: done=做完（需验证全绿），failed=没做完（如实说哪步没过）",
          },
          summary: {
            type: "string",
            description: "complete: 给她的汇报，大白话：做了什么、验证结果、还差什么",
          },
        },
        required: ["action"],
        additionalProperties: false,
      },
      manualId: "coding",
      run: async (args, _ctx) => {
        if (deps.isIncognito?.()) {
          throw new ToolError("无痕模式下不能用 coding_task（会写沙箱、会留记录）。");
        }
        const action = strArg(args, "action") as Action;
        if (!ACTIONS.includes(action)) {
          throw new ToolError(`action 必须是 ${ACTIONS.join("/")} 之一。`);
        }
        const store = deps.store;
        switch (action) {
          case "propose": {
            const rawSteps = args.steps;
            const steps = Array.isArray(rawSteps)
              ? rawSteps.map((s) => {
                  const o = s as { title?: unknown; detail?: unknown; files?: unknown };
                  const filesRaw = typeof o.files === "string" ? o.files : "";
                  return {
                    title: typeof o.title === "string" ? o.title : "",
                    detail: typeof o.detail === "string" ? o.detail : undefined,
                    files: filesRaw
                      .split(",")
                      .map((f) => f.trim())
                      .filter(Boolean),
                  };
                })
              : [];
            let task: CodingTask;
            try {
              task = store.propose(threadId, {
                title: args.title,
                request: args.request,
                steps,
                expectedOutcome: args.expected_outcome,
                doneCriteria: args.done_criteria,
              });
            } catch (e) {
              const key = String((e as Error).message).replace("invalid-coding-input:", "");
              throw new ToolError(
                key === "titleRequired"
                  ? "计划标题（title）不能为空。"
                  : key === "requestRequired"
                    ? "她的原话需求（request）不能为空。"
                    : key === "outcomeRequired"
                      ? "改完长什么样（expected_outcome）不能为空。"
                      : key === "criteriaRequired"
                        ? "什么叫'做完'（done_criteria）不能为空。"
                        : key === "stepsTooMany"
                          ? "步骤太多了（最多 20 步），拆小一点。"
                          : "计划至少要有一个有效的步骤（steps[].title）。",
              );
            }
            return (
              `计划已发出（任务 id: ${task.id}），她现在能在对话框里看到计划卡片。\n` +
              `接下来：等她点"批准"或"不用了"。批准前不要动任何文件、不要跑任何命令。\n` +
              `她回复后，用 action=status 查任务状态——只有 approved 才能开工。`
            );
          }
          case "status": {
            const taskId = strArg(args, "task_id").trim();
            if (!taskId) throw new ToolError("task_id 必填。");
            return describeTask(store, taskId);
          }
          case "write": {
            const taskId = strArg(args, "task_id").trim();
            const path = strArg(args, "path").trim();
            const content = strArg(args, "content");
            if (!taskId) throw new ToolError("task_id 必填。");
            if (!path) throw new ToolError("path 必填（仓库相对路径）。");
            if (!content) throw new ToolError("content 不能为空——写文件必须给完整内容。");
            try {
              return await writeTaskFile(engineDeps, taskId, path, content);
            } catch (e) {
              throw new ToolError((e as Error).message);
            }
          }
          case "run": {
            const taskId = strArg(args, "task_id").trim();
            const command = strArg(args, "command").trim();
            if (!taskId) throw new ToolError("task_id 必填。");
            if (!command) throw new ToolError("command 不能为空。");
            try {
              return await runTaskCommand(engineDeps, taskId, command);
            } catch (e) {
              throw new ToolError((e as Error).message);
            }
          }
          case "verify": {
            const taskId = strArg(args, "task_id").trim();
            if (!taskId) throw new ToolError("task_id 必填。");
            const tests = Array.isArray(args.tests)
              ? (args.tests.filter((x) => typeof x === "string") as string[])
              : undefined;
            const opts: VerifyOptions = tests ? { tests } : {};
            try {
              const r = await verifyTask(engineDeps, taskId, opts);
              const lines = [
                `验证第 ${r.attempt} 轮：${r.ok ? "通过" : "未通过"}`,
                `tsc: ${r.tsc.skipped ? `跳过（${r.tsc.skipped}）` : r.tsc.ok ? "通过" : "未通过"}`,
                `biome: ${r.biome.skipped ? `跳过（${r.biome.skipped}）` : r.biome.ok ? "通过" : "未通过"}`,
                `tests: ${r.tests.skipped ? `跳过（${r.tests.skipped}）` : r.tests.ok ? "通过" : "未通过"}`,
              ];
              if (!r.ok) {
                lines.push("真实报错（照着修）：");
                for (const c of [r.tsc, r.biome, r.tests]) {
                  if (!c.ok && c.output) lines.push(c.output.slice(0, 2000));
                }
              }
              return lines.join("\n");
            } catch (e) {
              throw new ToolError((e as Error).message);
            }
          }
          case "complete": {
            const taskId = strArg(args, "task_id").trim();
            const outcome = strArg(args, "outcome") as "done" | "failed";
            const summary = strArg(args, "summary").trim();
            if (!taskId) throw new ToolError("task_id 必填。");
            if (outcome !== "done" && outcome !== "failed")
              throw new ToolError(`outcome 必须是 done 或 failed。`);
            if (!summary)
              throw new ToolError("summary 不能为空：大白话说清做了什么、验证结果、还差什么。");
            try {
              return await completeTask(engineDeps, taskId, outcome, summary);
            } catch (e) {
              throw new ToolError((e as Error).message);
            }
          }
        }
      },
    },
  ];
}

/** Warm the workspace for a task (used by status cards / preflight). */
export async function ensureCodingWorkspace(deps: CodingToolDeps, taskId: string): Promise<string> {
  const t = deps.store.getTask(taskId);
  if (!t) throw new ToolError(`找不到任务 ${taskId}。`);
  const { root } = await ensureTaskWorkspace(
    { store: deps.store, getRunner: deps.getRunner, getRepoUrl: deps.getRepoUrl },
    t,
  );
  return root;
}
