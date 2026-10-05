/**
 * Proactive initiative （主动约定） — AI management tools.
 *
 * Permission iron rule (her decision, baked into every description): rules
 * are created BY HER or by the AI only WITH HER explicit permission — the
 * AI NEVER invents scheduled messages unprompted.
 *
 * manualId "initiative" pairs with src/manuals/initiative.ts (纸条机制).
 */

import type { LocalTool, ToolContext } from "../api-groups/local-tools";
import { ToolError } from "../api-groups/local-tools";
import type { Persona } from "../persona/types";
import type { FireOutcome } from "./executor";
import {
  describeSchedule,
  type InitiativeRule,
  type InitiativeSchedule,
  isInitiativeRuleType,
  nextFireAt,
  validateRuleInput,
} from "./rules";
import type { InitiativeStore } from "./store";

export interface InitiativeToolEnv {
  initiativeStore: InitiativeStore;
  getPersona(personaId: string): Promise<Persona | null>;
  listPersonas(): Promise<Array<{ id: string; name: string }>>;
  /** Called after create/update/restore: re-arm the rule's notification. */
  onMutated(rule: InitiativeRule): Promise<void>;
  /** Called after archive/delete: disarm the rule's notification. */
  onRetired(ruleId: string): Promise<void>;
  /** Manual fire — executor path (cap, isolation, ledger all enforced). */
  fireNow(ruleId: string): Promise<FireOutcome>;
  nowMs(): number;
}

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

function numArg(args: Record<string, unknown>, name: string): number | undefined {
  const v = args[name];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function boolArg(args: Record<string, unknown>, name: string, fallback: boolean): boolean {
  const v = args[name];
  return typeof v === "boolean" ? v : fallback;
}

const PERMISSION_LINE =
  "PERMISSION RULE (hard): only create a rule when SHE explicitly asks for it " +
  "or gave explicit permission in THIS conversation. NEVER invent scheduled " +
  "messages unprompted, never surprise her with new rules.";

function formatRule(rule: InitiativeRule, nowMs: number): string {
  const next = nextFireAt(rule, nowMs);
  const nextStr =
    next === null
      ? "无（已过期）"
      : new Date(next).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  return (
    `- ${rule.title} [${rule.id}] persona=${rule.personaId} ` +
    `${describeSchedule(rule)} status=${rule.status} target=${rule.target.mode} ` +
    `next=${nextStr}\n  topic: ${rule.topic}`
  );
}

function buildSchedule(args: Record<string, unknown>, type: string): InitiativeSchedule | null {
  if (type === "one_time") {
    const atMs = numArg(args, "atMs");
    return atMs !== undefined ? { kind: "one_time", atMs } : null;
  }
  if (type === "daily") {
    const hour = numArg(args, "hour");
    const minute = numArg(args, "minute");
    return hour !== undefined && minute !== undefined ? { kind: "daily", hour, minute } : null;
  }
  const everyMs = numArg(args, "everyMs");
  return everyMs !== undefined ? { kind: "interval", everyMs } : null;
}

export function createInitiativeTools(env: InitiativeToolEnv): LocalTool[] {
  const run = async (
    _ctx: ToolContext,
    fn: (store: InitiativeStore) => Promise<string>,
  ): Promise<string> => {
    try {
      return await fn(env.initiativeStore);
    } catch (e) {
      throw new ToolError(e instanceof Error ? e.message : "Initiative tool failed.");
    }
  };

  return [
    {
      name: "initiative_rule_create",
      description:
        "Create a proactive initiative rule （主动约定）: a scheduled promise for the AI to message HER first about a topic, in one persona's voice. " +
        PERMISSION_LINE +
        " One rule belongs to ONE persona — its message only ever lands in that persona's own dialogs. " +
        "Types: one_time (needs atMs, epoch ms), daily (needs hour 0-23 + minute 0-59, Shanghai time — her explicit choice, no sleep-window clamping), " +
        "interval (needs everyMs, ms, min 60000). targetThreadId pins the message to one dialog; omit for the persona's latest dialog. " +
        "Daily cap (default 3 per persona per day, shared with the proactive outreach channel): over-cap rules stay silent. " +
        "Use initiative_rule_list first to see existing rules and persona ids.",
      parameters: {
        type: "object",
        properties: {
          personaId: { type: "string", description: "Persona id the rule belongs to." },
          title: { type: "string", description: "Display title, e.g. 早安." },
          topic: {
            type: "string",
            description: "What the message is about (generation prompt input).",
          },
          type: { type: "string", description: "one_time | daily | interval" },
          atMs: { type: "number", description: "one_time: fire time (epoch ms)." },
          hour: { type: "number", description: "daily: Shanghai hour 0-23." },
          minute: { type: "number", description: "daily: Shanghai minute 0-59." },
          everyMs: { type: "number", description: "interval: repeat period in ms (>= 60000)." },
          targetThreadId: { type: "string", description: "Optional: pin to this dialog." },
        },
        required: ["personaId", "title", "topic", "type"],
        additionalProperties: false,
      },
      manualId: "initiative",
      run: async (args, ctx) =>
        run(ctx, async (store) => {
          const type = strArg(args, "type");
          const schedule = isInitiativeRuleType(type) ? buildSchedule(args, type) : null;
          const errs = validateRuleInput({
            personaId: strArg(args, "personaId"),
            title: strArg(args, "title"),
            topic: strArg(args, "topic"),
            type,
            schedule,
            target: strArg(args, "targetThreadId")
              ? { mode: "pinned", threadId: strArg(args, "targetThreadId") }
              : { mode: "latest" },
          });
          if (errs.length > 0) {
            throw new ToolError(
              `Invalid rule: ${errs.map((e) => `${e.field}: ${e.message}`).join("; ")}`,
            );
          }
          const personaId = strArg(args, "personaId");
          const persona = await env.getPersona(personaId).catch(() => null);
          if (!persona) throw new ToolError(`Persona not found: ${personaId}.`);
          if (!isInitiativeRuleType(type) || !schedule) {
            throw new ToolError("Invalid rule type or schedule.");
          }
          const rule = await store.create({
            personaId,
            title: strArg(args, "title"),
            topic: strArg(args, "topic"),
            type,
            schedule,
            target: strArg(args, "targetThreadId")
              ? { mode: "pinned", threadId: strArg(args, "targetThreadId") }
              : { mode: "latest" },
          });
          await env.onMutated(rule).catch(() => {});
          return `Rule created: ${rule.title} [${rule.id}] — ${describeSchedule(rule)}.`;
        }),
    },
    {
      name: "initiative_rule_list",
      description:
        "List proactive initiative rules （主动约定） with their schedules and next fire times. " +
        "Use before creating a rule (to see persona ids and avoid duplicates) or when she asks what promises are scheduled.",
      parameters: {
        type: "object",
        properties: {
          includeArchived: {
            type: "boolean",
            description: "Include archived (paused) rules. Default true.",
          },
        },
        additionalProperties: false,
      },
      manualId: "initiative",
      run: async (args, ctx) =>
        run(ctx, async (store) => {
          const includeArchived = boolArg(args, "includeArchived", true);
          const rules = await store.list(includeArchived);
          if (rules.length === 0) return "No initiative rules yet.";
          const now = env.nowMs();
          return rules.map((r) => formatRule(r, now)).join("\n");
        }),
    },
    {
      name: "initiative_rule_archive",
      description:
        "Archive (pause) a proactive initiative rule — it stops firing but is kept. " +
        "Use when she says to pause/stop a scheduled message. Restorable with initiative_rule_restore.",
      parameters: {
        type: "object",
        properties: {
          ruleId: { type: "string", description: "Rule id (see initiative_rule_list)." },
        },
        required: ["ruleId"],
        additionalProperties: false,
      },
      manualId: "initiative",
      run: async (args, ctx) =>
        run(ctx, async (store) => {
          const ok = await store.setStatus(strArg(args, "ruleId"), "archived");
          if (!ok) throw new ToolError("Rule not found.");
          await env.onRetired(strArg(args, "ruleId")).catch(() => {});
          return "Rule archived (paused).";
        }),
    },
    {
      name: "initiative_rule_restore",
      description:
        "Restore an archived proactive initiative rule — it resumes firing on its schedule.",
      parameters: {
        type: "object",
        properties: {
          ruleId: { type: "string", description: "Rule id (see initiative_rule_list)." },
        },
        required: ["ruleId"],
        additionalProperties: false,
      },
      manualId: "initiative",
      run: async (args, ctx) =>
        run(ctx, async (store) => {
          const ruleId = strArg(args, "ruleId");
          const ok = await store.setStatus(ruleId, "active");
          if (!ok) throw new ToolError("Rule not found.");
          const rule = await store.get(ruleId);
          if (rule) await env.onMutated(rule).catch(() => {});
          return "Rule restored (active again).";
        }),
    },
    {
      name: "initiative_rule_delete",
      description:
        "Permanently delete a proactive initiative rule. Use only when she explicitly says to delete it — otherwise prefer initiative_rule_archive.",
      parameters: {
        type: "object",
        properties: {
          ruleId: { type: "string", description: "Rule id (see initiative_rule_list)." },
        },
        required: ["ruleId"],
        additionalProperties: false,
      },
      manualId: "initiative",
      run: async (args, ctx) =>
        run(ctx, async (store) => {
          const ruleId = strArg(args, "ruleId");
          const ok = await store.remove(ruleId);
          if (!ok) throw new ToolError("Rule not found.");
          await env.onRetired(ruleId).catch(() => {});
          return "Rule deleted.";
        }),
    },
    {
      name: "initiative_rule_run_now",
      description:
        "Manually fire a proactive initiative rule RIGHT NOW (manual execution). " +
        "Still respects the daily cap, persona isolation, and one-fire-per-slot — " +
        "it reports honestly when it cannot fire (capped, no dialog, no API group). " +
        "Use when she says '现在就发' or to test a rule.",
      parameters: {
        type: "object",
        properties: {
          ruleId: { type: "string", description: "Rule id (see initiative_rule_list)." },
        },
        required: ["ruleId"],
        additionalProperties: false,
      },
      manualId: "initiative",
      run: async (args, ctx) =>
        run(ctx, async () => {
          const outcome: FireOutcome = await env.fireNow(strArg(args, "ruleId"));
          if (outcome.fired) return `Sent to dialog ${outcome.threadId}: ${outcome.text}`;
          return `Could not fire (reason: ${outcome.reason}). The slot is consumed — no auto-retry.`;
        }),
    },
  ];
}
