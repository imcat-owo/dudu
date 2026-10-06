/**
 * AI self-post trigger （自发帖触发器） — AI management tools.
 *
 * Permission iron rule (her decision): the trigger's config changes only
 * when SHE explicitly asks or gave explicit permission in THIS
 * conversation. The AI NEVER enables it, raises the cap, or adds slots
 * unprompted. Read tools (status/log) are always available.
 *
 * manualId "selfpost" pairs with src/manuals/selfpost.ts (纸条机制).
 */

import type { LocalTool, ToolContext } from "../api-groups/local-tools";
import { ToolError } from "../api-groups/local-tools";
import type { SelfpostFireOutcome } from "./executor";
import { fireSelfpostSlot } from "./executor";
import { SELFPOST_TICK_MS } from "./scheduler";
import { selfpostSlotsToday } from "./slots";
import type { SelfpostConfig, SelfpostStore } from "./store";

export interface SelfpostToolEnv {
  selfpostStore: SelfpostStore;
  /** Build executor deps for a manual "post now" (slot = now). */
  buildExecutorDeps(): Promise<
    import("./executor").SelfpostExecutorDeps & { isIncognito(): boolean }
  >;
  isIncognito(): boolean;
  nowMs(): number;
}

const PERMISSION_LINE =
  "PERMISSION RULE (hard): only change this config when SHE explicitly asks for it " +
  "or gave explicit permission in THIS conversation. NEVER enable it, raise the " +
  "cap, or add slots unprompted, never surprise her with AI posts she didn't ask for.";

function numArg(args: Record<string, unknown>, name: string): number | undefined {
  const v = args[name];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function boolArg(args: Record<string, unknown>, name: string): boolean | undefined {
  const v = args[name];
  return typeof v === "boolean" ? v : undefined;
}

function fmtTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(ms);
  }
}

function describeOutcome(o: SelfpostFireOutcome): string {
  if (o.fired && o.outcome === "posted") return `Posted to the feed (id: ${o.postId}).`;
  if (o.fired) return "The model chose not to post this time (SKIP) — silence is fine.";
  return `Not posted (vetoed: ${o.reason}).`;
}

export function createSelfpostTools(env: SelfpostToolEnv): LocalTool[] {
  const tools: LocalTool[] = [
    {
      name: "selfpost_config",
      description:
        "Get or change the AI self-post trigger (AI 自发帖触发器): at a few quiet moments each day the app asks the model once whether it has something worth posting to the Our Space feed, and the model decides. " +
        "Args: enabled (bool), slotCount (1-5 quiet moments/day), dailyCap (0-3 AI posts/day). " +
        "Call with no args to read the current config. " +
        PERMISSION_LINE,
      parameters: {
        type: "object",
        properties: {
          enabled: { type: "boolean", description: "Master switch for the trigger." },
          slotCount: {
            type: "number",
            description: "Quiet moments per day (1-5, default 3).",
          },
          dailyCap: {
            type: "number",
            description: "Max AI self-posts per day (0-3, default 1).",
          },
        },
        additionalProperties: false,
      },
      manualId: "selfpost",
      run: async (args, ctx?: ToolContext) => {
        if (env.isIncognito()) {
          throw new ToolError("Incognito: the self-post trigger config cannot be changed here.");
        }
        const store = env.selfpostStore;
        const enabled = boolArg(args, "enabled");
        const slotCount = numArg(args, "slotCount");
        const dailyCap = numArg(args, "dailyCap");
        if (enabled === undefined && slotCount === undefined && dailyCap === undefined) {
          const c = await store.getConfig();
          return (
            `AI self-post trigger: ${c.enabled ? "ON" : "OFF"}, ` +
            `${c.slotCount} quiet slots/day, cap ${c.dailyCap}/day. ` +
            `(tick every ${SELFPOST_TICK_MS / 1000}s on foreground)`
          );
        }
        const next = await store.setConfig({
          ...(enabled !== undefined ? { enabled } : {}),
          ...(slotCount !== undefined ? { slotCount } : {}),
          ...(dailyCap !== undefined ? { dailyCap } : {}),
        });
        return (
          `Updated: ${next.enabled ? "ON" : "OFF"}, ` +
          `${next.slotCount} quiet slots/day, cap ${next.dailyCap}/day.`
        );
      },
    },
    {
      name: "selfpost_status",
      description:
        "Read the AI self-post trigger status: today's quiet slots (times), which fired, and how many AI posts went out today vs the cap. Read-only.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "selfpost",
      run: async () => {
        const store = env.selfpostStore;
        const now = env.nowMs();
        const config: SelfpostConfig = await store.getConfig();
        const slots = selfpostSlotsToday(config.slotCount, now);
        const fired = await store.firedSlotIds().catch(() => new Set<string>());
        const { shanghaiDayStart } = await import("../initiative/rules");
        const dayStart = shanghaiDayStart(now);
        const { selfpostSlotId } = await import("./slots");
        const postsToday = await store.countSendsToday(now).catch(() => 0);
        const lines = slots.map((s) => {
          const id = selfpostSlotId(dayStart, s.index);
          const state = fired.has(id) ? "done" : s.atMs <= now ? "due" : "upcoming";
          return `- ${fmtTime(s.atMs)} (${s.label}): ${state}`;
        });
        return (
          `AI self-post trigger: ${config.enabled ? "ON" : "OFF"} — ` +
          `posts today ${postsToday}/${config.dailyCap}.\n` +
          `Today's quiet slots:\n${lines.join("\n")}`
        );
      },
    },
    {
      name: "selfpost_log",
      description:
        "Read the AI self-post decision log — what the trigger did today: posted, or chose not to post (and why). This is the 'AI 今天想发没发' view. Read-only.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max entries (default 10)." },
        },
        additionalProperties: false,
      },
      manualId: "selfpost",
      run: async (args) => {
        const limit = numArg(args, "limit") ?? 10;
        const entries = await env.selfpostStore.listLog(Math.max(1, Math.min(50, limit)));
        if (entries.length === 0) return "No self-post decisions logged yet.";
        return entries
          .map((e) => {
            const when = fmtTime(e.at);
            const what =
              e.outcome === "posted"
                ? `posted${e.textPreview ? `: "${e.textPreview}"` : ""}`
                : `skipped (${e.reason})`;
            return `- ${when} slot #${e.slotIndex}: ${what}`;
          })
          .join("\n");
      },
    },
    {
      name: "selfpost_post_now",
      description:
        "Ask the model RIGHT NOW whether it has something worth posting to the Our Space feed (one decision call, same gate and cap as the quiet slots). Use when SHE asks you to post something, or to '发一条动态'. " +
        PERMISSION_LINE,
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "selfpost",
      run: async (_args, ctx?: ToolContext) => {
        if (env.isIncognito()) {
          throw new ToolError("Incognito: cannot post to the feed here.");
        }
        const deps = await env.buildExecutorDeps();
        const now = env.nowMs();
        // Manual run: slot = now, index -1 (never collides with daily slots).
        const outcome = await fireSelfpostSlot(deps, { index: -1, atMs: now, label: "manual" });
        return describeOutcome(outcome);
      },
    },
  ];
  return tools;
}
