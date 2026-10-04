/**
 * Plan-gate tools (开启原则): propose_coordination_plan + check_plan_status.
 *
 * These are the ONLY legitimate on-ramp to multi-model coordination.
 * The tool descriptions encode the principle for the AI: single model
 * handles what it can; propose only when genuinely necessary; after
 * proposing, WAIT for her card decision and never execute early.
 *
 * PURE module: no React Native / expo imports.
 */

import { type LocalTool, ToolError } from "./local-tools.js";
import { planGateStore } from "./plan-gate-instance.js";
import { validatePlanInput } from "./plan-gate.js";

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

export function createPlanTools(
  threadId: string,
  deps?: { isCoordinationEnabled?: () => boolean },
): LocalTool[] {
  // P3-9: the coordination master switch is real now. Default-open when no
  // dep is injected (tests); local-agent always injects the real one.
  const coordinationOn = () => deps?.isCoordinationEnabled?.() ?? true;
  return [
    {
      name: "propose_coordination_plan",
      description:
        "多模型协作的唯一入口（开启原则）：当你判断单模型确实搞不定、必须多个模型分工时，先用这个工具把计划摆出来给她看。调用后她会在对话框里看到一张计划卡片，可以批准或叫停。在她拍板之前，绝对不要执行计划里的任何步骤——这是死规矩。计划要具体：标题、为什么必须多模型（单模型为什么不行）、每一步谁来做、做什么。等她决定期间，你可以先说句话告诉她计划已发出。前提：能力分组设置里的「多模型协作」总开关必须开着，否则工具直接拒绝。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "计划标题，一句话" },
          reason: {
            type: "string",
            description: "为什么必须多模型协作：单模型为什么搞不定，具体说",
          },
          steps: {
            type: "array",
            description: "计划步骤，每步说明哪个模型/分组做什么",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                detail: { type: "string" },
              },
              required: ["title"],
              additionalProperties: false,
            },
          },
        },
        required: ["title", "reason", "steps"],
        additionalProperties: false,
      },
      manualId: "coordination",
      run: async (args) => {
        if (!coordinationOn()) {
          throw new ToolError(
            "多模型协作的总开关没开（能力分组设置 → 多模型协作）。想用这个功能，先跟她说一声，让她打开开关——不要绕过。",
          );
        }
        const rawSteps = args.steps;
        const steps: Array<{ title: string; detail?: string }> = Array.isArray(rawSteps)
          ? rawSteps.map((s) => ({
              title:
                typeof (s as { title?: unknown }).title === "string"
                  ? (s as { title: string }).title
                  : "",
              detail:
                typeof (s as { detail?: unknown }).detail === "string"
                  ? (s as { detail: string }).detail
                  : undefined,
            }))
          : [];
        const problem = validatePlanInput({
          title: args.title,
          reason: args.reason,
          steps: rawSteps,
        });
        if (problem) {
          throw new ToolError(
            problem === "titleRequired"
              ? "计划标题不能为空。"
              : problem === "reasonRequired"
                ? "必须写清楚为什么单模型搞不定（reason）。"
                : "计划至少要有一个有效的步骤（steps[].title）。",
          );
        }
        const plan = planGateStore.propose(threadId, {
          title: strArg(args, "title"),
          reason: strArg(args, "reason"),
          steps,
        });
        return (
          `计划已发出（id: ${plan.id}），她现在能在对话框里看到计划卡片。\n` +
          `接下来：等她点"批准"或"不用了"。在她决定之前，不要执行任何步骤。\n` +
          `她回复后，用 check_plan_status 确认状态再行动——只有 approved 才能执行。`
        );
      },
    },
    {
      name: "check_plan_status",
      description:
        "查询协作计划的状态：proposed（她还没决定，继续等，不要执行）、approved（她批准了，可以按计划执行）、rejected（她叫停了，放弃计划，用单模型想别的办法）。在执行任何多模型步骤之前必须先查这个。",
      parameters: {
        type: "object",
        properties: {
          plan_id: { type: "string", description: "propose_coordination_plan 返回的计划 id" },
        },
        required: ["plan_id"],
        additionalProperties: false,
      },
      manualId: "coordination",
      run: async (args) => {
        const planId = strArg(args, "plan_id").trim();
        if (!planId) throw new ToolError("plan_id is required.");
        const plan = planGateStore.getPlan(planId);
        if (!plan) throw new ToolError(`找不到计划 ${planId}。`);
        if (plan.status === "approved") {
          return `计划"${plan.title}"已批准（approved）。可以按计划执行了。`;
        }
        if (plan.status === "rejected") {
          return (
            `计划"${plan.title}"被她叫停了（rejected）。放弃这个计划，` +
            `不要执行其中的步骤；用单模型想别的办法，或问她想怎么做。`
          );
        }
        if (plan.status === "superseded") {
          return (
            `计划"${plan.title}"已被同一对话里的新计划取代（superseded）——` +
            `不是她叫停的，是你后来又提了个新计划。看最新的计划卡片，` +
            `用 check_plan_status 查新计划的 id。不要执行这个旧计划。`
          );
        }
        if (plan.status === "consumed") {
          return (
            `计划"${plan.title}"已经用过一次、开过一个会了（consumed）——` +
            `一次批准只够开一次会。想再开会，重新提计划等她批准。`
          );
        }
        if (plan.status === "revoked") {
          return (
            `计划"${plan.title}"的批准被她收回了（revoked）。` +
            `不要执行这个计划；用单模型想别的办法，或问她想怎么做。`
          );
        }
        return (
          `计划"${plan.title}"她还没决定（proposed）。继续等，不要执行任何步骤。` +
          `她可能还没看到卡片——可以提醒她看一眼计划卡片。`
        );
      },
    },
  ];
}
