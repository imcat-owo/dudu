/**
 * open_app — the AI's "light control" （轻控制） hand for other apps.
 *
 * PURE module: no React Native / expo imports. Node-testable.
 *
 * "AI 只做决策不猜界面": the AI picks a WHITELIST entry id + declared
 * params. It can never invent a URL. Jump mode (leaving 嘟嘟） ALWAYS
 * passes her authorization popup first (capability "open_apps"); webview
 * mode stays in-app and needs no approval.
 *
 * Jump flow: authorize → openExternalUrl → arm watchdog → honest summary.
 * Any step failing closed: deny = no open, can't-open = honest "not
 * installed", watchdog failure = reported, never fatal.
 *
 * manualId "open_app" pairs with src/manuals/openapp.ts (纸条机制）.
 */

import type { LocalTool, ToolContext } from "../api-groups/local-tools";
import { ToolError } from "../api-groups/local-tools";
import { t } from "../i18n";
import {
  armWatchdog,
  clampWatchdogMinutes,
  type OpenAppWatchData,
  type OpenAppWatchDeps,
} from "./watchdog";
import { buildEntryUrl, buildWebUrl, describeWhitelist, lookupOpenAppEntry } from "./whitelist";

export interface OpenAppToolEnv {
  /** canOpenURL + openURL. Resolves false when the scheme can't open. */
  openExternalUrl(url: string): Promise<boolean>;
  /** In-app browser navigation (browserController). Stays inside 嘟嘟. */
  openWebViewUrl(url: string): Promise<void>;
  notifications: OpenAppWatchDeps["notifications"];
  /** Active persona id (for the watchdog return). Null = unknown. */
  getActivePersonaId(): Promise<string | null>;
  /** The dialog she's in right now (for the watchdog return). */
  getThreadId(): string;
  nowMs(): number;
}

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

function newWatchId(nowMs: number): string {
  return `${nowMs.toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(36)}`;
}

const APPROVAL_LINE =
  "APPROVAL RULE (hard): jumping out of 嘟嘟 ALWAYS asks her first — the tool " +
  "itself pops the authorization. Never try to bypass it, never open silently. " +
  "In-app web mode (web entries) needs no approval because she never leaves.";

export function createOpenAppTools(env: OpenAppToolEnv): LocalTool[] {
  return [
    {
      name: "open_app",
      description:
        'Open another app for her — the "light control" hand. You pick a FIXED ' +
        "whitelist entry (never an arbitrary URL) and its declared params.\n" +
        "Two modes:\n" +
        "- Web entries open inside 嘟嘟's own browser (no approval needed, she never leaves).\n" +
        "- Jump entries leave 嘟嘟 for the other app: the tool pops HER approval first, " +
        "then opens it, then arms a watchdog notification — tapping it brings her straight " +
        "back to this dialog with a welcome-back from you.\n" +
        "You CANNOT see inside the other app (iOS sandbox) — never claim to know what " +
        "happened there. Fixed entries:\n" +
        describeWhitelist() +
        "\n" +
        APPROVAL_LINE,
      parameters: {
        type: "object",
        properties: {
          entry: {
            type: "string",
            description: 'Whitelist entry id (required), e.g. "amap-search".',
          },
          params: {
            type: "object",
            description: 'Template params for the entry, e.g. {"query": "西湖"}.',
            additionalProperties: true,
          },
          inApp: {
            type: "boolean",
            description:
              "Prefer the in-app web version (no approval, she never leaves). Fails honestly when the entry has no web version.",
          },
          watchdogMinutes: {
            type: "number",
            description:
              'Jump mode only: minutes before the "bring me back" notification rings (1-60, default 5).',
          },
        },
        required: ["entry"],
        additionalProperties: false,
      },
      capability: "open_apps",
      manualId: "open_app",
      run: async (args: Record<string, unknown>, ctx: ToolContext) => {
        const entryId = strArg(args, "entry").trim();
        const entry = lookupOpenAppEntry(entryId);
        if (!entry) {
          throw new ToolError(t("openapp.error.unknownEntry", { entry: entryId || "?" }));
        }
        const params = (args.params ?? {}) as Record<string, unknown>;
        const inApp = args.inApp === true;

        // In-app web mode: no approval — she never leaves 嘟嘟.
        if (inApp || entry.mode === "webview") {
          let url: string;
          try {
            url = buildWebUrl(entry, params);
          } catch (e) {
            throw new ToolError(e instanceof Error ? e.message : String(e));
          }
          await env.openWebViewUrl(url);
          return t("openapp.result.webview", { app: entry.app, url });
        }

        // Jump mode: HER approval first. Always. No bypass.
        let url: string;
        try {
          url = buildEntryUrl(entry, params);
        } catch (e) {
          throw new ToolError(e instanceof Error ? e.message : String(e));
        }
        const ok = await ctx.authorize({
          capability: "open_apps",
          action: t("openapp.auth.action", { app: entry.app }),
          reason: t("openapp.auth.reason", { app: entry.app }),
        });
        if (!ok) {
          throw new ToolError(t("openapp.error.denied", { app: entry.app }));
        }
        const opened = await env.openExternalUrl(url).catch(() => false);
        if (!opened) {
          throw new ToolError(t("openapp.error.notInstalled", { app: entry.app }));
        }

        // Arm the watchdog: the legal way back.
        const minutes = clampWatchdogMinutes(args.watchdogMinutes);
        const now = env.nowMs();
        const watch: OpenAppWatchData = {
          kind: "openapp-watch",
          entryId: entry.id,
          app: entry.app,
          personaId: (await env.getActivePersonaId().catch(() => null)) ?? "",
          threadId: env.getThreadId(),
          jumpedAt: now,
          watchId: newWatchId(now),
        };
        const { armed } = await armWatchdog({ notifications: env.notifications }, watch, minutes);
        return t("openapp.result.opened", {
          app: entry.app,
          minutes: String(minutes),
          watchdog: armed ? t("openapp.result.watchdogArmed") : t("openapp.result.watchdogFailed"),
        });
      },
    },
  ];
}
