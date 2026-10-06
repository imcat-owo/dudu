/**
 * Together-days milestone celebrations （轻游戏化，克制版） — AI tools.
 *
 * The sweeper (./milestone-sweeper) schedules celebrations automatically;
 * these tools are HER controls, by dialog:
 * - milestone_celebration_set_enabled: master toggle. Turning off also
 *   archives pending (not yet fired) celebrations — off means silent.
 * - milestone_celebration_cancel: cancel one pending celebration (7/30/100/365).
 *   Cancelled milestones never come back.
 * - milestone_celebration_status: read-only — enabled, days together,
 *   celebrated / pending / skipped milestones.
 *
 * The write tools are in INCOGNITO_BLOCKED_TOOLS; _status stays readable.
 * manualId "romance" pairs with src/manuals/romance.ts (纸条机制), which
 * also carries the 克制清单 (restraint list).
 */

import type { LocalTool, ToolContext } from "../api-groups/local-tools";
import { ToolError } from "../api-groups/local-tools";
import type { InitiativeStore } from "../initiative/store";
import {
  type KeyValueStorage,
  loadMilestoneCelebrationsEnabled,
  loadMilestoneLedger,
  milestoneId,
  saveMilestoneCelebrationsEnabled,
  saveMilestoneLedger,
  TOGETHER_MILESTONE_DAYS,
} from "./milestones";

export interface MilestoneToolEnv {
  storage: KeyValueStorage;
  initiativeStore: InitiativeStore;
  getActivePersonaId(): Promise<string | null>;
  /** Archive a backing initiative rule + disarm its notification. */
  archiveRule(ruleId: string): Promise<void>;
  getDaysTogether(): Promise<{ since: string | null; days: number | null }>;
}

function boolArg(args: Record<string, unknown>, name: string, fallback: boolean): boolean {
  const v = args[name];
  return typeof v === "boolean" ? v : fallback;
}

function numArg(args: Record<string, unknown>, name: string): number {
  const v = args[name];
  return typeof v === "number" ? v : NaN;
}

export function createMilestoneTools(env: MilestoneToolEnv): LocalTool[] {
  const run = async (_ctx: ToolContext, fn: () => Promise<string>): Promise<string> => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ToolError) throw e;
      throw new ToolError(e instanceof Error ? e.message : "Milestone tool failed.");
    }
  };

  return [
    {
      name: "milestone_celebration_set_enabled",
      description:
        "Master toggle for together-days milestone celebrations （里程碑庆祝）: " +
        "at 7 / 30 / 100 / 365 days together he celebrates once, proactively, " +
        "in the active persona's voice, referencing real shared memories. " +
        "Use when she says to turn the celebrations off/on. Turning OFF also " +
        "cancels any pending (not yet fired) celebrations — off means silent. " +
        "This is celebration, not retention engineering: no streaks, no " +
        "punishment, no nagging — see the romance manual's restraint list.",
      parameters: {
        type: "object",
        properties: {
          enabled: { type: "boolean", description: "true to enable, false to disable." },
        },
        required: ["enabled"],
        additionalProperties: false,
      },
      manualId: "romance",
      run: (args, ctx) =>
        run(ctx, async () => {
          const enabled = boolArg(args, "enabled", true);
          await saveMilestoneCelebrationsEnabled(env.storage, enabled);
          if (!enabled) {
            const ledger = await loadMilestoneLedger(env.storage);
            const pendings = Object.entries(ledger.pending);
            for (const [, ruleId] of pendings) {
              await env.archiveRule(ruleId).catch(() => {});
            }
            await saveMilestoneLedger(env.storage, { ...ledger, pending: {} });
            const n = pendings.length;
            return (
              `Milestone celebrations turned off. ` +
              (n > 0
                ? `${n} pending celebration${n > 1 ? "s were" : " was"} cancelled — nothing will fire.`
                : `Nothing was pending — nothing will fire.`)
            );
          }
          return (
            "Milestone celebrations turned on. The next milestone " +
            "(7 / 30 / 100 / 365 days together) will be celebrated once, " +
            "in the active persona's voice."
          );
        }),
    },
    {
      name: "milestone_celebration_cancel",
      description:
        "Cancel one pending together-days milestone celebration （里程碑庆祝） " +
        "before it fires — e.g. she says the 100-day celebration feels like " +
        "too much. The cancelled milestone never comes back. Use " +
        "milestone_celebration_status to see what's pending.",
      parameters: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "Which milestone to cancel: one of 7, 30, 100, 365.",
          },
        },
        required: ["days"],
        additionalProperties: false,
      },
      manualId: "romance",
      run: (args, ctx) =>
        run(ctx, async () => {
          const d = numArg(args, "days");
          if (!TOGETHER_MILESTONE_DAYS.includes(d)) {
            throw new ToolError("days must be one of 7, 30, 100, 365.");
          }
          const id = milestoneId(d);
          const ledger = await loadMilestoneLedger(env.storage);
          const ruleId = ledger.pending[id];
          if (ruleId) {
            await env.archiveRule(ruleId).catch(() => {});
            delete ledger.pending[id];
          }
          if (!ledger.skipped.includes(id) && !ledger.celebrated.includes(id)) {
            ledger.skipped.push(id);
          }
          await saveMilestoneLedger(env.storage, ledger);
          return (
            `Celebration for ${d} days together cancelled — it will not fire, ` +
            `and it won't come back.`
          );
        }),
    },
    {
      name: "milestone_celebration_status",
      description:
        "Read-only: together-days milestone celebration status （里程碑庆祝） — " +
        "whether celebrations are enabled, how many days together, and which " +
        "milestones are celebrated / pending / skipped. Use when she asks " +
        "about the celebrations.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "romance",
      run: (_args, ctx) =>
        run(ctx, async () => {
          const { since, days } = await env.getDaysTogether();
          const enabled = await loadMilestoneCelebrationsEnabled(env.storage);
          const ledger = await loadMilestoneLedger(env.storage);
          const personaId = await env.getActivePersonaId().catch(() => null);
          const lines = [
            `Enabled: ${enabled ? "yes" : "no"}`,
            since && days !== null
              ? `Together since ${since} — ${days} days together.`
              : "No together-since date set yet (tell me the date and I'll count from there).",
            `Celebrating voice: ${personaId ? "the active persona" : "none (no active persona — celebrations stay silent)"}.`,
            `Celebrated: ${ledger.celebrated.length > 0 ? ledger.celebrated.join(", ") : "none yet"}`,
            `Pending: ${Object.keys(ledger.pending).length > 0 ? Object.keys(ledger.pending).join(", ") : "none"}`,
            `Skipped: ${ledger.skipped.length > 0 ? ledger.skipped.join(", ") : "none"}`,
          ];
          return lines.join("\n");
        }),
    },
  ];
}
