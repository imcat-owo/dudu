/**
 * open_app watchdog tests.
 *
 * Under test:
 * 1. clampWatchdogMinutes: default 5, clamped to 1-60.
 * 2. parseWatchData: valid payloads parse; anything else → null.
 * 3. armWatchdog: schedules ONE notification with the right id, delay and
 *    payload (kind + persona + thread for the return trip); failure →
 *    armed:false, never throws.
 * 4. handleOpenAppTap: the full return trip — welcome-back is generated in
 *    the persona's voice and its bytes REALLY land in the dialog's storage;
 *    trace appended. Double tap → one greeting only.
 * 5. Persona isolation: a threadId from another persona (or forged) fails
 *    closed — no greeting, no cross-persona write.
 * 6. Honest failures: persona missing, no API group, bad data.
 * 7. The welcome-back prompt bakes in the honesty rule (never claim to know
 *    what happened inside the other app).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolContext } from "../src/api-groups/local-tools.js";
import { createOpenAppTools, type OpenAppToolEnv } from "../src/openapp/tools.js";
import { type CrossDialogStorage, setDialogName } from "../src/chat/cross-dialog.js";
import {
  CrossDialogTraceStore,
  CrossDialogVisibilityStore,
} from "../src/chat/cross-dialog-trace.js";
import {
  armWatchdog,
  clampWatchdogMinutes,
  handleOpenAppTap,
  isOpenAppWatchId,
  type OpenAppWatchData,
  type OpenAppWatchDeps,
  parseWatchData,
} from "../src/openapp/watchdog.js";
import type { NotificationPort } from "../src/outreach/notify.js";

function fakeStorage(): CrossDialogStorage & { __map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: async (k: string) => map.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      map.set(k, v);
    },
    getAllKeys: async () => [...map.keys()],
    __map: map,
  };
}

function seedDialog(storage: CrossDialogStorage & { __map: Map<string, string> }) {
  storage.__map.set(
    "dudu.local-chat.threadA.v1",
    JSON.stringify([{ id: "m0", role: "user", content: "帮我打开高德" }]),
  );
}

interface Ctx {
  deps: OpenAppWatchDeps;
  storage: CrossDialogStorage & { __map: Map<string, string> };
  scheduled: Array<{
    identifier: string;
    seconds: number;
    title: string;
    body: string;
    data: Record<string, string>;
  }>;
  prompts: string[];
  personaIds: string[];
  noGroup: boolean;
}

function makeCtx(): Ctx {
  const storage = fakeStorage();
  const trace = new CrossDialogTraceStore(storage);
  const visibility = new CrossDialogVisibilityStore(storage);
  const scheduled: Ctx["scheduled"] = [];
  const prompts: string[] = [];
  const personaIds: string[] = [];
  const state = { noGroup: false };
  const notifications: NotificationPort = {
    getPermissionsAsync: async () => ({ status: "granted" }),
    cancelScheduledNotificationAsync: async () => {},
    scheduleNotificationAsync: async (req) => {
      scheduled.push({
        identifier: req.identifier,
        seconds: req.trigger.seconds,
        title: req.content.title,
        body: req.content.body,
        data: req.content.data ?? {},
      });
      return req.identifier;
    },
  };
  const deps: OpenAppWatchDeps = {
    storage,
    trace,
    visibility,
    notifications,
    getActiveGroup: async () => (state.noGroup ? null : ({ id: "g1", name: "test" } as never)),
    generateText: async (_g, system, _u) => {
      prompts.push(system);
      return "回来了？高德那边怎么样？";
    },
    getPersona: async (id: string) => {
      personaIds.push(id);
      if (id === "persona-1") return { id, name: "小梦" } as never;
      if (id === "persona-2") return { id, name: "另一个人设" } as never;
      return null;
    },
    personaDisplayName: (p) => (p as { name: string }).name,
    nowMs: () => 1_700_000_000_000,
  };
  return {
    deps,
    storage,
    scheduled,
    prompts,
    personaIds,
    get noGroup() {
      return state.noGroup;
    },
    set noGroup(v: boolean) {
      state.noGroup = v;
    },
  };
}

function watchData(over: Partial<OpenAppWatchData> = {}): OpenAppWatchData {
  return {
    kind: "openapp-watch",
    entryId: "amap-search",
    app: "高德地图",
    personaId: "persona-1",
    threadId: "threadA",
    jumpedAt: 1_700_000_000_000,
    watchId: "w1",
    ...over,
  };
}

async function readHistory(storage: Ctx["storage"]): Promise<Array<{ content: string }>> {
  const raw = await storage.getItem("dudu.local-chat.threadA.v1");
  return raw ? (JSON.parse(raw) as Array<{ content: string }>) : [];
}

describe("clampWatchdogMinutes", () => {
  it("defaults to 5, clamps to 1-60", () => {
    assert.equal(clampWatchdogMinutes(undefined), 5);
    assert.equal(clampWatchdogMinutes(0), 1);
    assert.equal(clampWatchdogMinutes(999), 60);
    assert.equal(clampWatchdogMinutes(10), 10);
    assert.equal(clampWatchdogMinutes("x"), 5);
  });
});

describe("parseWatchData", () => {
  it("parses a valid payload", () => {
    const w = parseWatchData(watchData());
    assert.ok(w);
    assert.equal(w.app, "高德地图");
  });

  it("rejects anything else", () => {
    assert.equal(parseWatchData(null), null);
    assert.equal(parseWatchData({ kind: "initiative" }), null);
    assert.equal(parseWatchData({ ...watchData(), threadId: 42 }), null);
    assert.equal(parseWatchData({ ...watchData(), watchId: undefined }), null);
  });

  it("tolerates stringified numbers from notification data", () => {
    const w = parseWatchData({ ...watchData(), jumpedAt: "1700000000000" });
    assert.ok(w);
    assert.equal(w.jumpedAt, 0);
  });
});

describe("armWatchdog", () => {
  it("schedules one notification with the return-trip payload", async () => {
    const c = makeCtx();
    const { armed, notificationId } = await armWatchdog(
      { notifications: c.deps.notifications },
      watchData(),
      5,
    );
    assert.equal(armed, true);
    assert.equal(notificationId, "dudu-openapp-w1");
    assert.ok(isOpenAppWatchId(notificationId));
    assert.equal(c.scheduled.length, 1);
    const s = c.scheduled[0];
    assert.equal(s.seconds, 300);
    assert.ok(s.title.length > 0 && s.body.length > 0);
    assert.ok(s.body.includes("高德地图"));
    assert.equal(s.data.kind, "openapp-watch");
    assert.equal(s.data.personaId, "persona-1");
    assert.equal(s.data.threadId, "threadA");
  });

  it("never throws — scheduling failure reports armed:false", async () => {
    const c = makeCtx();
    const bad: NotificationPort = {
      ...c.deps.notifications,
      scheduleNotificationAsync: async () => {
        throw new Error("denied");
      },
    };
    const { armed } = await armWatchdog({ notifications: bad }, watchData(), 5);
    assert.equal(armed, false);
  });
});

describe("handleOpenAppTap", () => {
  it("greets back: bytes REALLY land in the dialog storage", async () => {
    const c = makeCtx();
    seedDialog(c.storage);
    await setDialogName(c.storage, "threadA", "和她的对话", "persona-1");
    const out = await handleOpenAppTap(c.deps, watchData());
    assert.equal(out.greeted, true);
    assert.equal(out.greeted && out.threadId, "threadA");
    const history = await readHistory(c.storage);
    assert.equal(history.length, 2, "the greeting was appended to the real history");
    assert.ok(history[1].content.includes("回来了"));
    // Honesty rule baked into the generation prompt.
    assert.ok(c.prompts[0].includes("CANNOT see inside"));
    assert.ok(c.prompts[0].includes("NEVER claim to know"));
  });

  it("double tap → one greeting only", async () => {
    const c = makeCtx();
    seedDialog(c.storage);
    await setDialogName(c.storage, "threadA", "和她的对话", "persona-1");
    const first = await handleOpenAppTap(c.deps, watchData());
    const second = await handleOpenAppTap(c.deps, watchData());
    assert.equal(first.greeted, true);
    assert.equal(second.greeted, false);
    assert.equal((second as { reason: string }).reason, "already-handled");
    const history = await readHistory(c.storage);
    assert.equal(history.length, 2, "no duplicate greeting");
  });

  it("persona isolation: another persona's threadId fails closed", async () => {
    const c = makeCtx();
    seedDialog(c.storage);
    await setDialogName(c.storage, "threadA", "和她的对话", "persona-1");
    // Attacker crafts data pointing at persona-1's dialog but claims persona-2
    // (which exists). resolveDialog filters by persona → no dialog → no write.
    const out = await handleOpenAppTap(c.deps, watchData({ personaId: "persona-2" }));
    assert.equal(out.greeted, false);
    assert.equal((out as { reason: string }).reason, "no-dialog");
    const history = await readHistory(c.storage);
    assert.equal(history.length, 1, "nothing was written to the other persona's dialog");
  });

  it("persona missing → honest failure", async () => {
    const c = makeCtx();
    const out = await handleOpenAppTap(c.deps, watchData({ personaId: "ghost" }));
    assert.equal(out.greeted, false);
    assert.equal((out as { reason: string }).reason, "persona-missing");
  });

  it("no API group → honest failure (can't generate)", async () => {
    const c = makeCtx();
    c.noGroup = true;
    const out = await handleOpenAppTap(c.deps, watchData());
    assert.equal(out.greeted, false);
    assert.equal((out as { reason: string }).reason, "no-api-group");
  });

  it("bad data → honest failure", async () => {
    const c = makeCtx();
    const out = await handleOpenAppTap(c.deps, { kind: "nope" });
    assert.equal(out.greeted, false);
  });
});

describe("end-to-end: jump → watchdog → tap → greeting lands", () => {
  it("the full chain with real bytes at every step", async () => {
    const c = makeCtx();
    seedDialog(c.storage);
    await setDialogName(c.storage, "threadA", "和她的对话", "persona-1");

    // 1. The AI calls open_app; she approves; the exact whitelisted URL opens.
    const opened: string[] = [];
    const toolEnv: OpenAppToolEnv = {
      openExternalUrl: async (url: string) => {
        opened.push(url);
        return true;
      },
      openWebViewUrl: async () => {
        throw new Error("should not be called");
      },
      notifications: c.deps.notifications,
      getActivePersonaId: async () => "persona-1",
      getThreadId: () => "threadA",
      nowMs: () => 1_700_000_000_000,
    };
    const [tool] = createOpenAppTools(toolEnv);
    const toolCtx: ToolContext = { authorize: async () => true };
    await tool.run({ entry: "amap-search", params: { query: "西湖" } }, toolCtx);
    assert.equal(opened.length, 1);
    assert.ok(opened[0].startsWith("iosamap://poi?sourceApplication=dudu&keywords="));

    // 2. The watchdog notification was armed; its data crosses as strings
    //    (like a real expo-notifications payload).
    assert.equal(c.scheduled.length, 1);
    const data = c.scheduled[0].data;
    assert.equal(data["kind"], "openapp-watch");

    // 3. She taps the notification → ONE welcome-back greeting lands in the
    //    dialog's real storage.
    const out = await handleOpenAppTap(c.deps, data);
    assert.equal(out.greeted, true);
    const history = await readHistory(c.storage);
    assert.equal(history.length, 2);
    assert.ok(history[1].content.includes("回来了"));
  });
});
