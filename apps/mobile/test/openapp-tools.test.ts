/**
 * open_app tool tests.
 *
 * Under test:
 * 1. The tool exists with name "open_app", manualId "open_app", capability
 *    "open_apps" (out-of-app → authorize gate), and its description bakes in
 *    the approval iron rule + the fixed whitelist.
 * 2. Approval gate: deny → ToolError, openExternalUrl NEVER called.
 * 3. Jump happy path: allow → openExternalUrl called with the EXACT
 *    whitelisted URL; watchdog armed with the right delay + payload.
 * 4. Can't-open → honest "not installed" error.
 * 5. Unknown entry → rejected before any approval/open.
 * 6. Webview mode: no authorize call at all; openWebViewUrl called.
 * 7. inApp on an entry without a web version → honest error.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LocalTool, ToolContext } from "../src/api-groups/local-tools.js";
import { ToolError } from "../src/api-groups/local-tools.js";
import { createOpenAppTools, type OpenAppToolEnv } from "../src/openapp/tools.js";
import type { NotificationPort } from "../src/outreach/notify.js";

interface Ctx {
  tool: LocalTool;
  env: OpenAppToolEnv;
  opened: string[];
  webOpened: string[];
  scheduled: Array<{ identifier: string; seconds: number; data: Record<string, string> }>;
  state: { authorizeCalls: number; allow: boolean; canOpen: boolean };
  ctx: ToolContext;
}

function makeCtx(): Ctx {
  const opened: string[] = [];
  const webOpened: string[] = [];
  const scheduled: Ctx["scheduled"] = [];
  const state = { authorizeCalls: 0, allow: true, canOpen: true };
  const notifications: NotificationPort = {
    getPermissionsAsync: async () => ({ status: "granted" }),
    cancelScheduledNotificationAsync: async () => {},
    scheduleNotificationAsync: async (req) => {
      scheduled.push({
        identifier: req.identifier,
        seconds: req.trigger.seconds,
        data: req.content.data ?? {},
      });
      return req.identifier;
    },
  };
  const env: OpenAppToolEnv = {
    openExternalUrl: async (url: string) => {
      opened.push(url);
      return state.canOpen;
    },
    openWebViewUrl: async (url: string) => {
      webOpened.push(url);
    },
    notifications,
    getActivePersonaId: async () => "persona-1",
    getThreadId: () => "thread-1",
    nowMs: () => 1_700_000_000_000,
  };
  const ctx: ToolContext = {
    authorize: async () => {
      state.authorizeCalls += 1;
      return state.allow;
    },
  };
  const [tool] = createOpenAppTools(env);
  return { tool, env, opened, webOpened, scheduled, state, ctx };
}

describe("open_app tool shape", () => {
  it("exists with the right identity and baked-in rules", () => {
    const { tool } = makeCtx();
    assert.equal(tool.name, "open_app");
    assert.equal(tool.manualId, "open_app");
    assert.equal(tool.capability, "open_apps");
    assert.ok(tool.description.includes("amap-search"), "lists fixed entries");
    assert.ok(tool.description.includes("ALWAYS"), "approval iron rule in description");
    assert.ok(tool.description.includes("CANNOT see inside"), "honesty rule in description");
  });
});

describe("approval gate", () => {
  it("deny → ToolError, openExternalUrl NEVER called", async () => {
    const c = makeCtx();
    c.state.allow = false;
    await assert.rejects(
      c.tool.run({ entry: "amap-search", params: { query: "西湖" } }, c.ctx),
      (e: unknown) => e instanceof ToolError,
    );
    assert.equal(c.opened.length, 0);
    assert.equal(c.scheduled.length, 0);
    assert.equal(c.state.authorizeCalls, 1);
  });

  it("unknown entry → rejected before any approval or open", async () => {
    const c = makeCtx();
    await assert.rejects(c.tool.run({ entry: "nope", params: {} }, c.ctx), /No such fixed path/);
    assert.equal(c.state.authorizeCalls, 0);
    assert.equal(c.opened.length, 0);
  });

  it("can't-open → honest not-installed error", async () => {
    const c = makeCtx();
    c.state.canOpen = false;
    await assert.rejects(c.tool.run({ entry: "wechat-open", params: {} }, c.ctx), /微信/);
    assert.equal(c.scheduled.length, 0, "no watchdog when nothing opened");
  });
});

describe("jump happy path", () => {
  it("opens the EXACT whitelisted URL and arms the watchdog", async () => {
    const c = makeCtx();
    const result = await c.tool.run({ entry: "amap-search", params: { query: "西湖" } }, c.ctx);
    assert.equal(c.opened.length, 1);
    assert.equal(
      c.opened[0],
      `iosamap://poi?sourceApplication=dudu&keywords=${encodeURIComponent("西湖")}`,
    );
    assert.equal(c.scheduled.length, 1);
    const s = c.scheduled[0];
    assert.ok(s.identifier.startsWith("dudu-openapp-"));
    assert.equal(s.seconds, 300, "default 5 minutes");
    assert.equal(s.data.kind, "openapp-watch");
    assert.equal(s.data.entryId, "amap-search");
    assert.equal(s.data.app, "高德地图");
    assert.equal(s.data.personaId, "persona-1");
    assert.equal(s.data.threadId, "thread-1");
    assert.ok(result.includes("高德地图"));
  });

  it("respects a custom watchdog delay, clamped 1-60", async () => {
    const c = makeCtx();
    await c.tool.run({ entry: "wechat-open", params: {}, watchdogMinutes: 1 }, c.ctx);
    assert.equal(c.scheduled[0].seconds, 60);
    const c2 = makeCtx();
    await c2.tool.run({ entry: "wechat-open", params: {}, watchdogMinutes: 999 }, c2.ctx);
    assert.equal(c2.scheduled[0].seconds, 3600);
  });

  it("missing required param → honest error, nothing opened", async () => {
    const c = makeCtx();
    await assert.rejects(
      c.tool.run({ entry: "amap-search", params: {} }, c.ctx),
      /Missing required parameter/,
    );
    assert.equal(c.state.authorizeCalls, 0, "no approval asked for a broken call");
    assert.equal(c.opened.length, 0);
  });
});

describe("webview mode", () => {
  it("web entries open in-app with NO approval", async () => {
    const c = makeCtx();
    const result = await c.tool.run(
      { entry: "youtube-watch", params: { videoId: "abc123" } },
      c.ctx,
    );
    assert.equal(c.state.authorizeCalls, 0);
    assert.equal(c.opened.length, 0);
    assert.deepEqual(c.webOpened, ["https://www.youtube.com/watch?v=abc123"]);
    assert.equal(c.scheduled.length, 0, "no watchdog for in-app");
    assert.ok(result.includes("没离开嘟嘟") || result.includes("never left"));
  });

  it("inApp=true on an entry with a web version → webview, no approval", async () => {
    const c = makeCtx();
    await c.tool.run({ entry: "taobao-open", params: {}, inApp: true }, c.ctx);
    assert.equal(c.state.authorizeCalls, 0);
    assert.deepEqual(c.webOpened, ["https://www.taobao.com"]);
    assert.equal(c.opened.length, 0);
  });

  it("inApp=true without a web version → honest error", async () => {
    const c = makeCtx();
    await assert.rejects(
      c.tool.run({ entry: "wechat-open", params: {}, inApp: true }, c.ctx),
      /no web version/,
    );
    assert.equal(c.state.authorizeCalls, 0);
    assert.equal(c.webOpened.length, 0);
    assert.equal(c.opened.length, 0);
  });
});
