/**
 * AI self-organized group chat tools (AI 自建群, vision feature 3).
 *
 * The main AI is the moderator (ai-debate pattern): it creates the meeting,
 * picks member models from her API groups, drives rounds with
 * run_meeting_round, writes the four-part conclusion with end_meeting, and
 * reports back to her in her own words. It does NOT debate — members do.
 *
 * Hard constraints (死线), enforced here:
 * - 人设记忆隔离: members are invoked via buildMemberPrompt(), which only
 * ever sees the meeting topic + shared transcript. No persona memories,
 * no other dialogs — structurally impossible to leak, pinned by test.
 * - 留痕: start / every round / end are appended to the cross-dialog trace
 * (reused from feature 2). There is no silent meeting.
 * - 开启原则: start requires an APPROVED plan (plan gate) or her explicit
 * "你们讨论一下" (quoted). run_meeting_round re-checks the plan before
 * every round — if she stopped it, the round is refused.
 * - Incognito: refused (a session that promised no side effects can't
 * spend her API budget behind her back).
 * - Honest failures: unknown model / member model down / empty conclusion
 * are plain ToolErrors, never silent, never faked.
 *
 * Not PURE: needs fetch for one-shot member calls (injected as `generate`
 * so tests can fake it) and her API groups (injected as `listApiGroups`).
 */

import { type LocalTool, ToolError } from "../api-groups/local-tools.js";
import { planGateStore } from "../api-groups/plan-gate-instance.js";
import type { ApiGroup } from "../api-groups/types.js";
import { type CrossDialogStorage, DEFAULT_PERSONA_ID, listDialogs } from "./cross-dialog.js";
import type { CrossDialogTraceStore } from "./cross-dialog-trace.js";
import { createWriteChain, type ExclusiveRunner } from "../util/write-chain.js";
import {
  buildMemberPrompt,
  DEFAULT_MAX_ROUNDS,
  describeMeeting,
  formatTranscript,
  isStrategy,
  MAX_ROUNDS_CAP,
  type MeetingMember,
  meetingProgressLabel,
  parseMembers,
  selectSpeakers,
  shouldEndMeeting,
  validateStartMeetingInput,
} from "./group-meeting.js";
import type { GroupMeetingStore } from "./group-meeting-store.js";

export interface GroupMeetingToolDeps {
  /** The dialog the moderator AI is talking in. */
  threadId: string;
  personaId?: string;
  storage: CrossDialogStorage;
  meetings: GroupMeetingStore;
  trace: CrossDialogTraceStore;
  /** Her configured API groups (with keys) — member resolution + generation. */
  listApiGroups: () => ApiGroup[];
  /**
   * One-shot model call for a member turn. Throws on failure; the tool
   * reports that member's failure plainly (挂了只报自己的错).
   */
  generate: (group: ApiGroup, system: string, user: string) => Promise<string>;
  /** When true, the session promised no side effects: meetings refused. */
  isIncognito?: () => boolean;
  /**
   * P3-9: multi-model coordination master switch. When false, starting a
   * meeting is refused — she flips it in capability settings. Defaults to
   * true when not injected (tests); local-agent always injects the real one.
   */
  isCoordinationEnabled?: () => boolean;
  /**
   * Recent user message texts in this thread (newest last), for
   * mechanically verifying her_request (P2-8). The AI must quote her
   * actual words — a fabricated "she said" is refused.
   */
  recentUserTexts?: () => string[];
}

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

function numArg(args: Record<string, unknown>, name: string, fallback: number): number {
  const v = args[name];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * Resolve a member ref (group id or name) to her actual API group.
 * Honest failures: unknown / ambiguous refs throw, never guess.
 */
function resolveApiGroup(groups: ApiGroup[], ref: string): ApiGroup {
  const needle = ref.trim();
  if (!needle) throw new ToolError("成员的 api_group 不能为空。");
  const lower = needle.toLowerCase();
  const byId = groups.find((g) => g.id === needle);
  if (byId) return byId;
  const exactName = groups.filter((g) => g.name.toLowerCase() === lower);
  if (exactName.length === 1) return exactName[0];
  const partial = groups.filter(
    (g) => g.name.toLowerCase().includes(lower) || g.model.toLowerCase().includes(lower),
  );
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new ToolError(
      `「${needle}」匹配到多个模型：${partial.map((g) => `「${g.name}」`).join("、")}。用 list_models 看清 id 再指定。`,
    );
  }
  const available = groups.map((g) => `「${g.name}」(${g.model})`).join("、");
  throw new ToolError(
    `找不到模型「${needle}」。她配好的模型有：${available || "（还没有配置任何模型）"}。用 list_models 查看。`,
  );
}

function formatModelList(groups: ApiGroup[]): string {
  if (groups.length === 0) return "她还没有配置任何 API 分组（模型）。先让她去设置里配好再开会。";
  const lines = groups.map((g) => `- ${g.name} — id ${g.id}, 模型 ${g.model}`);
  return `她配好的模型（${groups.length} 个），开会时用 id 或名字指定成员：\n${lines.join("\n")}`;
}

async function traceFromName(
  storage: CrossDialogStorage,
  threadId: string,
  personaId: string,
): Promise<string> {
  const dialogs = await listDialogs(storage, personaId || DEFAULT_PERSONA_ID);
  return dialogs.find((d) => d.id === threadId)?.name ?? "当前对话";
}

// P2-11: per-meeting round serialization. Two concurrent run_meeting_round
// calls used to read the same roundsCompleted, both compute round N+1 and
// garble the transcript. Each meeting gets its own write chain (a SEPARATE
// chain from the store's — nesting the store's exclusive chain would
// deadlock, since the round body itself calls exclusive store methods).
// Entries are dropped when the meeting ends; meetings are capped, so the
// map stays tiny.
const roundChains = new Map<string, ExclusiveRunner>();
function roundChain(meetingId: string): ExclusiveRunner {
  let c = roundChains.get(meetingId);
  if (!c) {
    c = createWriteChain();
    roundChains.set(meetingId, c);
  }
  return c;
}

function checkPlanGate(planId: string | null): void {
  if (!planId) return;
  const plan = planGateStore.getPlan(planId);
  if (!plan) {
    // Approved plans are persisted, but storage can still be wiped or fail.
    // Don't brick: tell the AI how to recover honestly.
    throw new ToolError(
      `找不到计划 ${planId}——可能是 App 重启后计划记录没能恢复。不要编造批准：重新用 propose_coordination_plan 提一个计划，等她点了批准再继续这个会。`,
    );
  }
  if (plan.status === "approved") return;
  if (plan.status === "rejected") {
    throw new ToolError(
      `计划「${plan.title}」被她叫停了（rejected）——会议不能继续。用单模型想别的办法，或问她想怎么做。`,
    );
  }
  if (plan.status === "superseded") {
    throw new ToolError(
      `计划「${plan.title}」已被新计划取代（superseded）——不是她叫停的。用 check_plan_status 查最新计划的状态。`,
    );
  }
  if (plan.status === "consumed") {
    throw new ToolError(
      `计划「${plan.title}」已经用过一次、开过一个会了（consumed）——一次批准只够开一次会。想再开会，重新用 propose_coordination_plan 提计划，等她批准。`,
    );
  }
  if (plan.status === "revoked") {
    throw new ToolError(
      `计划「${plan.title}」的批准被她收回了（revoked）。不要再用这个计划开会。`,
    );
  }
  throw new ToolError(
    `计划「${plan.title}」她还没决定（proposed）。等她点了批准再开会，不要先斩后奏。`,
  );
}

/**
 * Mechanical her_request check (code P2-8): the "she said discuss it"
 * basis must be her actual words. The quoted text must appear in (or
 * contain) a recent user message in this thread — a fabricated
 * her_request is refused, and the AI is pointed at plan approval instead.
 */
function verifyHerRequest(herRequest: string, recentUserTexts: string[]): void {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const req = norm(herRequest);
  if (req.length < 2) {
    throw new ToolError(
      "her_request 太短了，填她说「你们讨论一下」这类话的原话——要能在最近的消息里找到。",
    );
  }
  const hit = recentUserTexts.some((t) => {
    const u = norm(t);
    return u.length > 0 && (u.includes(req) || req.includes(u));
  });
  if (!hit) {
    throw new ToolError(
      "her_request 里的话在她最近的消息里找不到——不要编造她说过的话。要么把她的原话准确填进来，要么走计划门：propose_coordination_plan 提计划、等她批准后再开会。",
    );
  }
}

export function createGroupMeetingTools(deps: GroupMeetingToolDeps): LocalTool[] {
  const personaId = deps.personaId ?? "default";
  const incognito = () => deps.isIncognito?.() === true;

  async function fromName(): Promise<string> {
    return traceFromName(deps.storage, deps.threadId, personaId);
  }

  return [
    {
      name: "list_models",
      description:
        "列出她配好的 API 分组（模型）：名字、id、模型名。开会前先用这个看有哪些模型可选，再用 start_group_meeting 指定成员。",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "group-meeting",
      run: async () => formatModelList(deps.listApiGroups()),
    },
    {
      name: "start_group_meeting",
      description:
        "AI 自建群（vision feature 3）：你当主持人，拉几个模型开会讨论，吵出结果再汇报给她。\n" +
        "前提：能力分组设置里的「多模型协作」总开关必须开着（默认关着，她的规矩），关着时工具直接拒绝——先请她打开。\n" +
        "开启原则（死规矩）：默认不开。只有两种情况能开——(1) 她明确说了「你们讨论一下」这类话，把她的原话填进 her_request；(2) 你走计划门：propose_coordination_plan 提出开会计划、她点了批准，把 plan_id 填进来。两种都没有就绝对不许开。\n" +
        "成员：2-4 个为宜，用 list_models 看到的 id 或名字指定；每人可设 talkativeness（0-1，0=除非被点名否则不开口，默认 0.5）。\n" +
        "strategy：pooled（默认，每人每轮都发言，适合开会）、natural（像真实聊天，有人插话有人沉默）、list（固定顺序挨个表态）。\n" +
        "max_rounds：默认 4，轮数别贪多（每轮每个成员都是一次模型调用，花的是她的 API 钱）。\n" +
        "开完会用 run_meeting_round 一轮一轮推进，结束条件到了用 end_meeting 写四段式结论（主题/各方观点/共识/未解决分歧），然后用你自己的话向她汇报。",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string", description: "讨论主题，一句话说清" },
          reason: {
            type: "string",
            description: "为什么开这个会（她的话，或计划里的理由）",
          },
          members: {
            type: "array",
            description: "参会成员（2-4 个），每人一个模型",
            items: {
              type: "object",
              properties: {
                api_group: { type: "string", description: "模型的 id 或名字（见 list_models）" },
                talkativeness: { type: "number", description: "发言欲 0-1，默认 0.5" },
              },
              required: ["api_group"],
              additionalProperties: false,
            },
          },
          strategy: {
            type: "string",
            description: "pooled（默认）/ natural / list",
          },
          max_rounds: { type: "number", description: "最多几轮，默认 4，上限 10" },
          plan_id: { type: "string", description: "已批准的协作计划 id（两种开会依据之一）" },
          her_request: {
            type: "string",
            description:
              "她让你们讨论的原话（两种开会依据之一，如「你们讨论一下」）。必须是她最近消息里的原话——系统会机械核验，编造会被拒绝；拿不准就走计划门。",
          },
        },
        required: ["topic", "reason", "members"],
        additionalProperties: false,
      },
      manualId: "group-meeting",
      run: async (args) => {
        if (incognito()) {
          throw new ToolError(
            "隐身会话承诺了无副作用，开会要花她的 API 钱、还要留痕——这里不许开。",
          );
        }
        // P3-9: master switch. Off by default (her 开启原则) — she flips it
        // in capability settings before any of this can happen.
        if (deps.isCoordinationEnabled && !deps.isCoordinationEnabled()) {
          throw new ToolError(
            "多模型协作的总开关没开（能力分组设置 → 多模型协作）。想开会，先跟她说一声，让她打开开关——不要绕过。",
          );
        }
        const planId = strArg(args, "plan_id").trim() || null;
        const herRequest = strArg(args, "her_request").trim();
        if (!planId && !herRequest) {
          throw new ToolError(
            "开会需要依据：要么填 plan_id（她已批准的开会计划），要么填 her_request（她说「你们讨论一下」的原话）。两个都没有就不能开——这是开启原则。",
          );
        }
        if (planId) checkPlanGate(planId);
        if (!planId) {
          // P2-8: her_request must be her actual words — mechanically
          // verified against recent user messages, never taken on trust.
          verifyHerRequest(herRequest, deps.recentUserTexts?.() ?? []);
        }

        // Normalize the wire format (api_group) to the internal shape
        // (apiGroupRef) before validation.
        const wireMembers = Array.isArray(args.members) ? args.members : [];
        const normalizedMembers = wireMembers.map((m) => {
          const o = (typeof m === "object" && m !== null ? m : {}) as Record<string, unknown>;
          return { apiGroupRef: o.api_group, talkativeness: o.talkativeness };
        });
        const problem = validateStartMeetingInput({
          topic: args.topic,
          reason: args.reason,
          members: normalizedMembers,
          strategy: args.strategy,
          maxRounds: args.max_rounds,
        });
        if (problem) {
          throw new ToolError(
            problem === "topicRequired"
              ? "讨论主题（topic）不能为空。"
              : problem === "reasonRequired"
                ? "开会理由（reason）不能为空。"
                : problem === "membersRequired"
                  ? "至少要 2 个成员才叫开会。"
                  : problem === "tooManyMembers"
                    ? "成员最多 5 个，人多了吵不出结果。"
                    : problem === "membersInvalid"
                      ? "成员格式不对：每人都要有 api_group（模型的 id 或名字）。"
                      : problem === "talkativenessInvalid"
                        ? "talkativeness 必须是 0-1 之间的数字。"
                        : problem === "strategyInvalid"
                          ? "strategy 只能是 pooled / natural / list。"
                          : "max_rounds 必须是 1-10 的整数。",
          );
        }

        const groups = deps.listApiGroups();
        const parsed = parseMembers({ members: normalizedMembers });
        const seen = new Set<string>();
        const members: MeetingMember[] = parsed.map((p, i) => {
          const g = resolveApiGroup(groups, p.apiGroupRef);
          if (seen.has(g.id)) {
            throw new ToolError(`「${g.name}」重复了——一个模型只能参会一次。`);
          }
          seen.add(g.id);
          return {
            id: `m${i + 1}`,
            displayName: `${g.name} (${g.model})`,
            apiGroupId: g.id,
            model: g.model,
            talkativeness: p.talkativeness,
          };
        });

        const strategy = isStrategy(args.strategy) ? args.strategy : "pooled";
        const maxRounds = Math.min(
          MAX_ROUNDS_CAP,
          Math.max(1, numArg(args, "max_rounds", DEFAULT_MAX_ROUNDS)),
        );
        const topic = strArg(args, "topic").trim();
        const name = `开会：${members.map((m) => m.displayName.split(" (")[0]).join("、")}`;

        const meeting = await deps.meetings.create({
          name,
          topic,
          reason: strArg(args, "reason").trim(),
          members,
          strategy,
          maxRounds,
          createdByThreadId: deps.threadId,
          ...(planId ? { planId } : {}),
        });
        if (planId) {
          // P2-9: one approval authorizes ONE meeting. Consume it now that
          // the meeting exists — a second meeting needs a fresh approval.
          planGateStore.consumePlan(planId);
        }

        const name0 = await fromName();
        await deps.trace.append({
          action: "meeting_create",
          fromThreadId: deps.threadId,
          fromName: name0,
          toThreadId: meeting.id,
          toName: meeting.name,
          summary: `发起了 AI 开会「${meeting.name}」：${topic}`,
          reason: planId ? `approved plan ${planId}` : `her words: ${herRequest}`,
          personaId,
        });

        return (
          `会议已创建（id: ${meeting.id}）。\n` +
          `${describeMeeting(meeting)}\n\n` +
          `接下来用 run_meeting_round 一轮一轮推进。` +
          `她随时能叫停——每轮开始前我都会重查计划状态。`
        );
      },
    },
    {
      name: "run_meeting_round",
      description:
        "推进一轮会议：按策略选出发言人，逐个调他们的模型拿发言，记入会议记录。每次调用前我会重查计划状态——她叫停了就拒绝执行。\n" +
        "返回本轮发言摘要。如果达到结束条件（轮数用完，或有人说了「会议结束」），我会告诉你——这时用 end_meeting 写四段式结论，不要再开新轮。\n" +
        "某个成员的模型挂了：我只报他自己的错，不影响其他人继续；你如实转告她就行，不许编发言顶上。",
      parameters: {
        type: "object",
        properties: {
          meeting_id: { type: "string", description: "start_group_meeting 返回的会议 id" },
        },
        required: ["meeting_id"],
        additionalProperties: false,
      },
      manualId: "group-meeting",
      run: async (args) => {
        if (incognito()) {
          throw new ToolError(
            "隐身会话承诺了无副作用——开会要花她的 API 钱，这里不许推进轮次。",
          );
        }
        const meetingId = strArg(args, "meeting_id").trim();
        if (!meetingId) throw new ToolError("meeting_id is required.");
        // P2-11: the whole round runs inside this meeting's exclusive
        // chain — get → compute roundNo → append → completeRound is one
        // atomic step, so concurrent rounds can't duplicate round numbers.
        return roundChain(meetingId)(async () => {
          const meeting = await deps.meetings.get(meetingId);
          if (!meeting) throw new ToolError(`找不到会议 ${meetingId}。`);
          if (meeting.status === "done") {
            throw new ToolError(
              `会议「${meeting.name}」已经结束了${meeting.conclusion ? "，结论已写" : ""}。想再聊就开个新会。`,
            );
          }
          // 开启原则：每轮重查计划——她随时能叫停。
        checkPlanGate(meeting.planId ?? null);

        const groups = deps.listApiGroups();
        const speakers = selectSpeakers(meeting);
        const roundNo = meeting.roundsCompleted + 1;
        const lines: string[] = [];
        const failures: string[] = [];

        for (const speaker of speakers) {
          const group = groups.find((g) => g.id === speaker.apiGroupId);
          if (!group) {
            failures.push(`${speaker.displayName} 的模型找不到了（分组可能被她删了），跳过。`);
            continue;
          }
          const { system, user } = buildMemberPrompt(speaker, meeting);
          try {
            const text = await deps.generate(group, system, user);
            const saved = await deps.meetings.appendMessage(meeting.id, {
              memberId: speaker.id,
              memberName: speaker.displayName,
              text,
              round: roundNo,
            });
            // In-round visibility: the next speaker sees this one (ST-style serial
            // generation). The persisted message carries the real id.
            if (saved) meeting.transcript.push(saved);
            lines.push(`${speaker.displayName}：${text}`);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            failures.push(`${speaker.displayName} 的模型出错了（${msg}），本轮跳过他。`);
          }
        }

        const updated = await deps.meetings.completeRound(meeting.id);
        const done = updated ? shouldEndMeeting(updated) : false;

        const name0 = await fromName();
        const summaryParts = [
          `第 ${roundNo} 轮：${speakers.length} 位发言`,
          ...failures.map((f) => `${f}`),
        ];
        await deps.trace.append({
          action: "meeting_round",
          fromThreadId: deps.threadId,
          fromName: name0,
          toThreadId: meeting.id,
          toName: meeting.name,
          summary: summaryParts.join("；"),
          reason: meeting.planId ? `approved plan ${meeting.planId}` : "her request",
          personaId,
        });

        let out = `第 ${roundNo} 轮结束（${meetingProgressLabel(updated ?? meeting)}）：\n${lines.join("\n")}`;
        if (failures.length > 0) out += `\n\n本轮故障：\n${failures.join("\n")}`;
        if (done) {
          out +=
            `\n\n会议达到结束条件了——用 end_meeting 写四段式结论` +
            `（主题/各方观点/共识/未解决分歧），然后用你自己的话向她汇报。不要再开新轮。`;
        }
          return out;
        });
      },
    },
    {
      name: "meeting_status",
      description: "查看会议状态：进度、成员、会议记录、结论（如果有）。只读，不留痕也不打扰。",
      parameters: {
        type: "object",
        properties: {
          meeting_id: { type: "string", description: "会议 id" },
        },
        required: ["meeting_id"],
        additionalProperties: false,
      },
      manualId: "group-meeting",
      run: async (args) => {
        if (incognito()) {
          throw new ToolError(
            "隐身会话承诺了无副作用——开会要花她的 API 钱，这里不许推进轮次。",
          );
        }
        const meetingId = strArg(args, "meeting_id").trim();
        if (!meetingId) throw new ToolError("meeting_id is required.");
        const meeting = await deps.meetings.get(meetingId);
        if (!meeting) throw new ToolError(`找不到会议 ${meetingId}。`);
        let out = describeMeeting(meeting);
        if (meeting.transcript.length > 0) {
          out += `\n\n\n${formatTranscript(meeting)}`;
        }
        return out;
      },
    },
    {
      name: "end_meeting",
      description:
        "结束会议并写结论。结论用四段式（照着写，别让参会人的原话污染结构）：\n" +
        "1. 主题：一句话；2. 各方观点：每人一到两句；3. 共识：大家一致认同的；4. 未解决分歧：没吵出结果的，如实写，别编。\n" +
        "写完后，用你自己的话向她汇报结论——汇报是你当主持人的收尾工作。",
      parameters: {
        type: "object",
        properties: {
          meeting_id: { type: "string", description: "会议 id" },
          conclusion: { type: "string", description: "四段式结论" },
        },
        required: ["meeting_id", "conclusion"],
        additionalProperties: false,
      },
      manualId: "group-meeting",
      run: async (args) => {
        if (incognito()) {
          throw new ToolError(
            "隐身会话承诺了无副作用——开会要花她的 API 钱，这里不许推进轮次。",
          );
        }
        const meetingId = strArg(args, "meeting_id").trim();
        if (!meetingId) throw new ToolError("meeting_id is required.");
        const conclusion = strArg(args, "conclusion").trim();
        if (!conclusion) throw new ToolError("结论（conclusion）不能为空——没吵出结果也要如实写。");
        const meeting = await deps.meetings.get(meetingId);
        if (!meeting) throw new ToolError(`找不到会议 ${meetingId}。`);
        if (meeting.status === "done") throw new ToolError(`会议「${meeting.name}」已经结束了。`);

        await deps.meetings.end(meeting.id, conclusion);
        // P2-11: drop the round chain — the meeting is over, no more rounds.
        roundChains.delete(meeting.id);
        const name0 = await fromName();
        await deps.trace.append({
          action: "meeting_end",
          fromThreadId: deps.threadId,
          fromName: name0,
          toThreadId: meeting.id,
          toName: meeting.name,
          summary: `会议「${meeting.name}」结束，共 ${meeting.roundsCompleted} 轮，结论已写`,
          reason: meeting.planId ? `approved plan ${meeting.planId}` : "her request",
          personaId,
        });
        return (
          `会议「${meeting.name}」已结束，结论已记录。` +
          `现在用你自己的话向她汇报结论——这是你当主持人的收尾。`
        );
      },
    },
  ];
}

/**
 * One-shot model call for a member turn. Non-streaming POST, same wire
 * shape as capability-probe (OpenAI-compatible /chat/completions).
 * Throws GroupError-labeled errors on failure — the tool reports them.
 */
export async function generateOneShot(
  group: ApiGroup,
  system: string,
  user: string,
): Promise<string> {
  const endpoint = `${group.baseUrl.trim().replace(/\/+$/, "")}/chat/completions`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = group.apiKey?.trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { ...headers, ...group.headers },
      body: JSON.stringify({
        model: group.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        stream: false,
        // Meeting turns stay short: bounded cost, legible transcript.
        max_tokens: 600,
      }),
    });
  } catch (e) {
    throw new Error(`model call failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `model call failed: HTTP ${res.status}${body ? ` — ${body.slice(0, 120)}` : ""}`,
    );
  }
  const data = (await res.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  } | null;
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("model call failed: empty reply");
  }
  return text.trim();
}
