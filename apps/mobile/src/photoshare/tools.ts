/**
 * AI photo share （主动发照片） — AI management tools.
 *
 * Permission iron rule (her decision): the master toggle is OPT-IN and
 * defaults to OFF. Only SHE turns it on — the AI NEVER enables it
 * unprompted, never surprises her with photos she didn't ask for. When
 * she asks for a photo ("发张照片给我"), the toggle doesn't block it:
 * that's an answer, not a surprise (photoshare_share_now).
 *
 * manualId "photoshare" pairs with src/manuals/photoshare.ts (纸条机制).
 */

import type { LocalTool, ToolContext } from "../api-groups/local-tools";
import { ToolError } from "../api-groups/local-tools";
import type { PhotoshareFireOutcome } from "./executor";
import { firePhotoshareSlot } from "./executor";
import { PHOTOSHARE_TICK_MS } from "./scheduler";
import { photoshareSlotsToday } from "./slots";
import type { PhotoshareConfig, PhotoshareStore } from "./store";

export interface PhotoshareToolEnv {
  photoshareStore: PhotoshareStore;
  /** Build executor deps for a manual "share now" (slot = now). */
  buildExecutorDeps(): Promise<
    import("./executor").PhotoshareExecutorDeps & { isIncognito(): boolean }
  >;
  isIncognito(): boolean;
  nowMs(): number;
}

const PERMISSION_LINE =
  "PERMISSION RULE (hard): the photo-share master toggle is OPT-IN and defaults to OFF. " +
  "Only SHE turns it on — NEVER enable it unprompted, never surprise her with photos she " +
  "didn't ask for. When SHE asks for a photo, use photoshare_share_now (the toggle doesn't block answers).";

function numArg(args: Record<string, unknown>, name: string): number | undefined {
  const v = args[name];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function boolArg(args: Record<string, unknown>, name: string): boolean | undefined {
  const v = args[name];
  return typeof v === "boolean" ? v : undefined;
}

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
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

function describeOutcome(o: PhotoshareFireOutcome): string {
  if (o.fired && o.outcome === "shared") return `Shared a photo with her: "${o.caption}"`;
  if (o.fired) return "The model chose not to share this time (SKIP) — silence is fine.";
  return `Not shared (vetoed: ${o.reason}).`;
}

export function createPhotoshareTools(env: PhotoshareToolEnv): LocalTool[] {
  const tools: LocalTool[] = [
    {
      name: "photoshare_config",
      description:
        "Get or change the AI photo share (主动发照片): at a few quiet moments each day the app asks the model once whether it has a genuine photo moment worth sharing, and the model decides. " +
        "Args: enabled (bool — the master toggle, OPT-IN, default OFF), slotCount (1-4 quiet moments/day), dailyCap (0-2 photo shares/day). " +
        "Call with no args to read the current config. " +
        PERMISSION_LINE,
      parameters: {
        type: "object",
        properties: {
          enabled: {
            type: "boolean",
            description: "Master toggle. OPT-IN — only SHE turns this on.",
          },
          slotCount: {
            type: "number",
            description: "Quiet moments per day (1-4, default 2).",
          },
          dailyCap: {
            type: "number",
            description: "Max AI photo shares per day (0-2, default 1).",
          },
        },
        additionalProperties: false,
      },
      manualId: "photoshare",
      run: async (args, _ctx?: ToolContext) => {
        if (env.isIncognito()) {
          throw new ToolError("Incognito: the photo-share config cannot be changed here.");
        }
        const store = env.photoshareStore;
        const enabled = boolArg(args, "enabled");
        const slotCount = numArg(args, "slotCount");
        const dailyCap = numArg(args, "dailyCap");
        if (enabled === undefined && slotCount === undefined && dailyCap === undefined) {
          const c = await store.getConfig();
          return (
            `AI photo share: ${c.enabled ? "ON" : "OFF"}, ` +
            `${c.slotCount} quiet slots/day, cap ${c.dailyCap}/day. ` +
            `(tick every ${PHOTOSHARE_TICK_MS / 1000}s on foreground)`
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
      name: "photoshare_status",
      description:
        "Read the AI photo-share status: master toggle, today's quiet slots (times), which fired, and how many photos went out today vs the cap. Read-only.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "photoshare",
      run: async () => {
        const store = env.photoshareStore;
        const now = env.nowMs();
        const config: PhotoshareConfig = await store.getConfig();
        const slots = photoshareSlotsToday(config.slotCount, now);
        const fired = await store.firedSlotIds().catch(() => new Set<string>());
        const { shanghaiDayStart } = await import("../initiative/rules");
        const dayStart = shanghaiDayStart(now);
        const { photoshareSlotId } = await import("./slots");
        const sharesToday = await store.countSendsToday(now).catch(() => 0);
        const lines = slots.map((s) => {
          const id = photoshareSlotId(dayStart, s.index);
          const state = fired.has(id) ? "done" : s.atMs <= now ? "due" : "upcoming";
          return `- ${fmtTime(s.atMs)} (${s.label}): ${state}`;
        });
        return (
          `AI photo share: ${config.enabled ? "ON" : "OFF"} — ` +
          `photos today ${sharesToday}/${config.dailyCap}.\n` +
          `Today's quiet slots:\n${lines.join("\n")}`
        );
      },
    },
    {
      name: "photoshare_log",
      description:
        "Read the AI photo-share log — what he shared and when (caption previews), or chose not to share (and why). Read-only.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max entries (default 10)." },
        },
        additionalProperties: false,
      },
      manualId: "photoshare",
      run: async (args) => {
        const limit = numArg(args, "limit") ?? 10;
        const entries = await env.photoshareStore.listLog(Math.max(1, Math.min(50, limit)));
        if (entries.length === 0) return "No photo shares logged yet.";
        return entries
          .map((e) => {
            const when = fmtTime(e.at);
            const what =
              e.outcome === "shared"
                ? `shared${e.captionPreview ? `: "${e.captionPreview}"` : ""}${e.manual ? " (she asked)" : ""}`
                : `skipped (${e.reason})`;
            return `- ${when} slot #${e.slotIndex}: ${what}`;
          })
          .join("\n");
      },
    },
    {
      name: "photoshare_share_now",
      description:
        'Share a photo with her RIGHT NOW (one model decision + real image generation, same caps as the quiet slots). Use when SHE asks for a photo ("发张照片给我", "自拍一张"). ' +
        "This is an ANSWER, not a surprise — the master toggle doesn't block it. " +
        PERMISSION_LINE,
      parameters: {
        type: "object",
        properties: {
          hint: {
            type: "string",
            description:
              'Optional: what she asked for ("穿那件白衬衫的自拍"). Passed to the model as the moment.',
          },
        },
        additionalProperties: false,
      },
      manualId: "photoshare",
      run: async (args, _ctx?: ToolContext) => {
        if (env.isIncognito()) {
          throw new ToolError("Incognito: cannot share photos here.");
        }
        const deps = await env.buildExecutorDeps();
        const now = env.nowMs();
        const hint = strArg(args, "hint").trim();
        // Manual run: slot = now, index -1 (never collides with daily slots).
        const outcome = await firePhotoshareSlot(
          deps,
          { index: -1, atMs: now, label: "manual" },
          { manual: true, manualHint: hint },
        );
        return describeOutcome(outcome);
      },
    },
  ];
  return tools;
}
