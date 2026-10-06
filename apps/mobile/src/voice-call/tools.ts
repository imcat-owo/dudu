/**
 * Voice call (realtime duplex) — AI tools.
 *
 * Permission iron rule (her authorization model — a call is the most
 * intrusive proactive act): the AI may only PROPOSE a call. The phone rings
 * with WHO and WHY; SHE accepts or declines. The AI can never start audio
 * or auto-answer. A declined/missed proposal is NEVER silently retried.
 *
 * manualId "voice-call" pairs with src/manuals/voice-call.ts (纸条机制).
 */
import type { LocalTool, ToolContext } from "../api-groups/local-tools";
import { ToolError } from "../api-groups/local-tools";
import type { Persona } from "../persona/types";
import { listProposals, type ProposalStore, proposeCall, type RingNotifier } from "./propose";
import type { CallProposal } from "./types";

export interface VoiceCallToolEnv {
  proposalStore: ProposalStore;
  notifier: RingNotifier;
  getPersona(personaId: string): Promise<Persona | null>;
  listPersonas(): Promise<Array<{ id: string; name: string }>>;
  nowMs(): number;
}

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

const PERMISSION_LINE =
  "PERMISSION RULE (hard): a call is the most intrusive thing you can do — " +
  "it rings HER phone. Only propose a call when SHE explicitly asked for one " +
  "in THIS conversation ('给我打个电话'), or when you have her explicit " +
  "permission for this specific call. NEVER surprise-call her. The proposal " +
  "must carry a real reason — 'call me' with no why is refused.";

function formatProposal(p: CallProposal): string {
  return (
    `- ${p.personaName} [${p.id}] status=${p.status} ` +
    `at=${new Date(p.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}\n` +
    `  reason: ${p.reason}${p.topic ? `\n  topic: ${p.topic}` : ""}`
  );
}

export function createVoiceCallTools(env: VoiceCallToolEnv): LocalTool[] {
  return [
    {
      name: "propose_voice_call",
      description:
        "Propose a realtime voice call to HER (AI-initiated call). This RINGS her phone " +
        "with your persona name and reason — she accepts or declines. " +
        PERMISSION_LINE +
        " A declined or missed proposal is terminal: never re-propose without a new explicit reason. " +
        "Use list_voice_calls first to avoid duplicate ringing.",
      parameters: {
        type: "object",
        properties: {
          personaId: {
            type: "string",
            description: "Persona id placing the call (must be YOUR persona).",
          },
          reason: {
            type: "string",
            description:
              "WHY you want to call — shown to her as the ring reason. Required, be specific.",
          },
          topic: {
            type: "string",
            description: "Optional: what the call is about.",
          },
        },
        required: ["personaId", "reason"],
        additionalProperties: false,
      },
      manualId: "voice-call",
      run: async (args, _ctx: ToolContext) => {
        const personaId = strArg(args, "personaId");
        const reason = strArg(args, "reason");
        const topic = strArg(args, "topic");
        if (!personaId) throw new ToolError("personaId is required.");
        const persona = await env.getPersona(personaId).catch(() => null);
        if (!persona) throw new ToolError(`Persona not found: ${personaId}.`);
        try {
          const p = await proposeCall(env.proposalStore, env.notifier, {
            personaId,
            personaName: persona.name?.trim() || "嘟嘟",
            reason,
            topic: topic || undefined,
            nowMs: env.nowMs,
          });
          return (
            `Call proposed — her phone is ringing with your reason. ` +
            `Proposal [${p.id}] status=ringing. ` +
            `If she declines or misses it, do NOT re-propose without asking her first.`
          );
        } catch (e) {
          throw new ToolError(e instanceof Error ? e.message : "Call proposal failed.");
        }
      },
    },
    {
      name: "list_voice_calls",
      description:
        "List voice call proposals (ringing / accepted / declined / missed) with reasons. " +
        "Use before proposing to avoid duplicate ringing, or when she asks about calls.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      manualId: "voice-call",
      run: async (_args, _ctx: ToolContext) => {
        try {
          const list = await listProposals(env.proposalStore);
          if (list.length === 0) return "No call proposals yet.";
          return list.map(formatProposal).join("\n");
        } catch (e) {
          throw new ToolError(e instanceof Error ? e.message : "list_voice_calls failed.");
        }
      },
    },
  ];
}
