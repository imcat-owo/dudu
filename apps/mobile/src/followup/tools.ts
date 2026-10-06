/**
 * Memory-driven next-day follow-up （次日跟进） — AI tools.
 *
 * When SHE mentions a future-dated commitment/event ("我明天有个面试"),
 * the model calls followup_add: he remembers it, and the day after the
 * event he asks how it went — in his own voice, through the real
 * initiative delivery path (daily cap, persona isolation, no retry).
 *
 * This is her telling him about it — like writing it down, not an
 * unprompted surprise. The model MUST tell her it's tracking it, and
 * every item is visible (and deletable) in Our Space → 次日跟进.
 *
 * manualId "initiative" pairs with src/manuals/initiative.ts (纸条机制).
 */

import type { LocalTool, ToolContext } from "../api-groups/local-tools";
import { ToolError } from "../api-groups/local-tools";
import { type CrossDialogStorage, listDialogs } from "../chat/cross-dialog";
import type { InitiativeRule } from "../initiative/rules";
import type { InitiativeStore } from "../initiative/store";
import { detectFollowup } from "./detect";
import { buildFollowupTitle, buildFollowupTopic } from "./engine";
import type { FollowupStore } from "./store";

export interface FollowupToolEnv {
  followupStore: FollowupStore;
  initiativeStore: InitiativeStore;
  storage: CrossDialogStorage;
  getPersona(personaId: string): Promise<{ id: string; name: string } | null>;
  listPersonas(): Promise<Array<{ id: string; name: string }>>;
  /** Called after create: re-arm the backing rule's notification. */
  onMutated(rule: InitiativeRule): Promise<void>;
  /** Called after delete/disable: disarm the backing rule's notification. */
  onRetired(ruleId: string): Promise<void>;
  nowMs(): number;
}

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

function boolArg(args: Record<string, unknown>, name: string, fallback: boolean): boolean {
  const v = args[name];
  return typeof v === "boolean" ? v : fallback;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function createFollowupTools(env: FollowupToolEnv): LocalTool[] {
  const run = async (_ctx: ToolContext, fn: () => Promise<string>): Promise<string> => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ToolError) throw e;
      throw new ToolError(e instanceof Error ? e.message : "Follow-up tool failed.");
    }
  };

  /** threadId -> message count, for the auto-cancel baseline. */
  async function captureBaseline(personaId: string): Promise<Record<string, number>> {
    try {
      const dialogs = await listDialogs(env.storage, personaId);
      const out: Record<string, number> = {};
      for (const d of dialogs) {
        if (typeof d.messageCount === "number") out[d.id] = d.messageCount;
      }
      return out;
    } catch {
      return {};
    }
  }

  return [
    {
      name: "followup_add",
      description:
        "Track a future-dated commitment SHE just mentioned （次日跟进）: e.g. she says " +
        "「我明天有个面试」→ the day after the interview, he naturally asks how it went. " +
        "Use when SHE mentions a dated event/commitment in conversation — this is her " +
        "telling you about it, like writing it down. ALWAYS tell her you're tracking it " +
        "(e.g. 「记下了，后天问你结果怎么样」) so nothing fires secretly. " +
        "The follow-up fires ONCE through the proactive delivery path (shared daily cap, " +
        "persona-isolated, never retried). If she already talked about the event before " +
        "the fire time, it auto-cancels. She can see and delete every item in " +
        "Our Space → 次日跟进. Text must contain a recognizable future date " +
        "(明天/后天/下周三/5月20日…). Returns an error when no dated commitment is found — " +
        "do NOT invent one.",
      parameters: {
        type: "object",
        properties: {
          personaId: { type: "string", description: "Persona id (the voice that follows up)." },
          text: {
            type: "string",
            description: "Her words containing the dated commitment, e.g. 「我明天有个面试」.",
          },
        },
        required: ["personaId", "text"],
        additionalProperties: false,
      },
      manualId: "initiative",
      run: (args, ctx) =>
        run(ctx, async () => {
          const personaId = strArg(args, "personaId");
          const text = strArg(args, "text");
          if (!personaId) throw new ToolError("personaId is required.");
          if (!text.trim()) throw new ToolError("text is required.");
          const persona = await env.getPersona(personaId).catch(() => null);
          if (!persona) throw new ToolError(`Persona not found: ${personaId}.`);
          const now = env.nowMs();
          const detected = detectFollowup(text, now);
          if (!detected) {
            throw new ToolError(
              "No future-dated commitment found in the text. Only track real dated events she mentioned — never invent one.",
            );
          }
          const dup = await env.followupStore.findActive(personaId, detected.what);
          if (dup) {
            return `Already tracking 「${dup.what}」 (fires ${formatDate(dup.followUpAtMs)}). No duplicate created.`;
          }
          const baseline = await captureBaseline(personaId);
          const rule = await env.initiativeStore.create({
            personaId,
            title: buildFollowupTitle(detected.what),
            topic: buildFollowupTopic(detected.what, detected.eventLabel),
            type: "one_time",
            schedule: { kind: "one_time", atMs: detected.followUpAtMs },
            target: { mode: "latest" },
          });
          const item = await env.followupStore.create({
            ruleId: rule.id,
            personaId,
            what: detected.what,
            eventLabel: detected.eventLabel,
            eventDateMs: detected.eventDateMs,
            followUpAtMs: detected.followUpAtMs,
            keywords: detected.keywords,
            baselineCounts: baseline,
          });
          await env.onMutated(rule).catch(() => {});
          return (
            `Tracking 「${item.what}」 (${item.eventLabel}) — I'll ask how it went on ` +
            `${formatDate(item.followUpAtMs)}. She can see or delete it in Our Space → 次日跟进. ` +
            `Tell her you're tracking it.`
          );
        }),
    },
    {
      name: "followup_list",
      description:
        "List memory-driven follow-ups （次日跟进）: what is being tracked, the event date, " +
        "and when the follow-up fires. Use when she asks what you're keeping track of.",
      parameters: {
        type: "object",
        properties: {
          includeDone: {
            type: "boolean",
            description: "Include finished/cancelled items. Default false.",
          },
        },
        additionalProperties: false,
      },
      manualId: "initiative",
      run: (args, ctx) =>
        run(ctx, async () => {
          const includeDone = boolArg(args, "includeDone", false);
          const items = await env.followupStore.list(includeDone);
          if (items.length === 0) return "No follow-ups tracked yet.";
          return items
            .map(
              (i) =>
                `- ${i.what} [${i.id}] event: ${i.eventLabel}, follow-up: ${formatDate(i.followUpAtMs)}, status: ${i.status}`,
            )
            .join("\n");
        }),
    },
    {
      name: "followup_delete",
      description:
        "Delete a tracked follow-up （次日跟进） — it will never fire. " +
        "Use when she says to forget / cancel / stop tracking something.",
      parameters: {
        type: "object",
        properties: {
          itemId: { type: "string", description: "Follow-up id (see followup_list)." },
        },
        required: ["itemId"],
        additionalProperties: false,
      },
      manualId: "initiative",
      run: (args, ctx) =>
        run(ctx, async () => {
          const itemId = strArg(args, "itemId");
          const item = await env.followupStore.get(itemId);
          if (!item) throw new ToolError("Follow-up not found.");
          await env.onRetired(item.ruleId).catch(() => {});
          await env.initiativeStore.setStatus(item.ruleId, "archived").catch(() => {});
          await env.followupStore.remove(itemId);
          return `Stopped tracking 「${item.what}」.`;
        }),
    },
    {
      name: "followup_set_enabled",
      description:
        "Master toggle for memory-driven next-day follow-ups （次日跟进）. " +
        "Disabling stops all pending follow-ups from firing (their scheduled " +
        "notifications are cancelled too). Use when she says to turn the " +
        "feature off/on.",
      parameters: {
        type: "object",
        properties: {
          enabled: { type: "boolean", description: "true to enable, false to disable." },
        },
        required: ["enabled"],
        additionalProperties: false,
      },
      manualId: "initiative",
      run: (args, ctx) =>
        run(ctx, async () => {
          const enabled = boolArg(args, "enabled", true);
          await env.followupStore.setEnabled(enabled);
          const actives = await env.followupStore.list(false).catch(() => []);
          for (const item of actives) {
            if (enabled) {
              await env.initiativeStore.setStatus(item.ruleId, "active").catch(() => {});
              const rule = await env.initiativeStore.get(item.ruleId).catch(() => null);
              if (rule) await env.onMutated(rule).catch(() => {});
            } else {
              await env.onRetired(item.ruleId).catch(() => {});
              await env.initiativeStore.setStatus(item.ruleId, "archived").catch(() => {});
            }
          }
          return enabled
            ? "Next-day follow-ups enabled — pending items resumed."
            : "Next-day follow-ups disabled — pending items paused (kept, not deleted).";
        }),
    },
  ];
}
