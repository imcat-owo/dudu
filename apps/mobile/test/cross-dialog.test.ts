/**
 * Feature 2 (vision): cross-dialog read/write — tools, trace store,
 * visibility store, persona isolation.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type CrossDialogStorage,
  createCrossDialogTools,
  DEFAULT_PERSONA_ID,
  listDialogs,
  readDialog,
  resolveDialog,
  sendToDialog,
  setDialogName,
} from "../src/chat/cross-dialog.js";
import {
  type CrossDialogTraceStorage,
  CrossDialogTraceStore,
  CrossDialogVisibilityStore,
  TRACE_MAX_ENTRIES,
} from "../src/chat/cross-dialog-trace.js";

type FakeStorage = CrossDialogStorage & CrossDialogTraceStorage & { __map: Map<string, string> };

function fakeStorage(): FakeStorage {
  const map = new Map<string, string>();
  return {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v);
    },
    getAllKeys: async () => [...map.keys()],
    __map: map,
  };
}

function seedHistory(
  storage: FakeStorage,
  threadId: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): void {
  storage.__map.set(
    `dudu.local-chat.${threadId}.v1`,
    JSON.stringify(messages.map((m, i) => ({ id: `m${i}`, ...m }))),
  );
}

function toolOpts(storage: CrossDialogStorage, threadId = "current") {
  const trace = new CrossDialogTraceStore(storage);
  const visibility = new CrossDialogVisibilityStore(storage);
  return {
    storage,
    threadId,
    trace,
    visibility,
    isIncognito: undefined as undefined | (() => boolean),
  };
}

describe("listDialogs", () => {
  it("returns empty when no dialogs exist", async () => {
    assert.deepEqual(await listDialogs(fakeStorage()), []);
  });

  it("lists dialogs with registry names and message counts", async () => {
    const s = fakeStorage();
    seedHistory(s, "aaa", [
      { role: "user", content: "hello there" },
      { role: "assistant", content: "hi" },
    ]);
    seedHistory(s, "bbb", []);
    await setDialogName(s, "aaa", "旅行计划");
    const dialogs = await listDialogs(s);
    assert.equal(dialogs.length, 2);
    const a = dialogs.find((d) => d.id === "aaa");
    assert.ok(a, "dialog aaa listed");
    assert.equal(a.name, "旅行计划");
    assert.equal(a.messageCount, 2);
    assert.equal(a.named, true);
    assert.equal(a.personaId, DEFAULT_PERSONA_ID);
  });

  it("derives a name from the first user message when unnamed", async () => {
    const s = fakeStorage();
    seedHistory(s, "aaa", [{ role: "user", content: "帮我查一下明天北京的天气怎么样" }]);
    const [d] = await listDialogs(s);
    assert.ok(d.name.includes("帮我查一下明天"), `name was: ${d.name}`);
    assert.equal(d.named, false);
  });

  it("hides other personas' dialogs (isolation at list time)", async () => {
    const s = fakeStorage();
    seedHistory(s, "aaa", [{ role: "user", content: "hi" }]);
    seedHistory(s, "bbb", [{ role: "user", content: "hi" }]);
    await setDialogName(s, "bbb", "B 的", "persona-b");
    const dialogs = await listDialogs(s, DEFAULT_PERSONA_ID);
    assert.deepEqual(
      dialogs.map((d) => d.id),
      ["aaa"],
    );
    const bOnly = await listDialogs(s, "persona-b");
    assert.deepEqual(
      bOnly.map((d) => d.id),
      ["bbb"],
    );
  });
});

describe("resolveDialog", () => {
  it("resolves by exact id and exact name", async () => {
    const s = fakeStorage();
    seedHistory(s, "aaa", []);
    await setDialogName(s, "aaa", "旅行计划");
    assert.equal((await resolveDialog(s, "aaa")).id, "aaa");
    assert.equal((await resolveDialog(s, "旅行计划")).id, "aaa");
  });

  it("resolves unambiguous partial names", async () => {
    const s = fakeStorage();
    seedHistory(s, "aaa", []);
    await setDialogName(s, "aaa", "旅行计划");
    assert.equal((await resolveDialog(s, "旅行")).id, "aaa");
  });

  it("rejects ambiguous names by listing candidates", async () => {
    const s = fakeStorage();
    seedHistory(s, "aaa", []);
    seedHistory(s, "bbb", []);
    await setDialogName(s, "aaa", "旅行计划A");
    await setDialogName(s, "bbb", "旅行计划B");
    await assert.rejects(() => resolveDialog(s, "旅行"), /more than one dialog/);
  });

  it("rejects unknown refs honestly", async () => {
    const s = fakeStorage();
    seedHistory(s, "aaa", []);
    await assert.rejects(() => resolveDialog(s, "nope"), /No dialog matches/);
  });

  it("denies cross-persona access explicitly", async () => {
    const s = fakeStorage();
    seedHistory(s, "aaa", []);
    await setDialogName(s, "aaa", "B 的", "persona-b");
    await assert.rejects(() => resolveDialog(s, "aaa", DEFAULT_PERSONA_ID), /different persona/);
  });
});

describe("readDialog", () => {
  it("returns last N user/assistant messages, oldest first", async () => {
    const s = fakeStorage();
    seedHistory(s, "aaa", [
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
      { role: "user", content: "three" },
    ]);
    const msgs = await readDialog(s, "aaa", 2);
    assert.deepEqual(
      msgs.map((m) => m.text),
      ["two", "three"],
    );
  });

  it("labels voice/image envelopes instead of dumping JSON", async () => {
    const s = fakeStorage();
    seedHistory(s, "aaa", [
      { role: "assistant", content: JSON.stringify({ type: "voice_message", uri: "x" }) },
    ]);
    const [m] = await readDialog(s, "aaa", 5);
    assert.equal(m.text, "[语音消息]");
  });

  it("returns empty for unknown dialogs (honest, not an error)", async () => {
    assert.deepEqual(await readDialog(fakeStorage(), "ghost", 10), []);
  });
});

describe("sendToDialog", () => {
  it("appends an assistant message with the marker when tag visible", async () => {
    const s = fakeStorage();
    seedHistory(s, "aaa", [{ role: "user", content: "hi" }]);
    const { tagVisible } = await sendToDialog(
      s,
      "aaa",
      "hello from elsewhere",
      { fromThreadId: "cur", fromName: "主对话", at: 1 },
      async () => true,
    );
    assert.equal(tagVisible, true);
    const raw = JSON.parse(s.__map.get("dudu.local-chat.aaa.v1") as string);
    const last = raw[raw.length - 1];
    assert.equal(last.role, "assistant");
    assert.equal(last.content, "hello from elsewhere");
    assert.deepEqual(last.crossDialog, { fromThreadId: "cur", fromName: "主对话", at: 1 });
  });

  it("omits the marker when the tag is turned off (trace still records)", async () => {
    const s = fakeStorage();
    seedHistory(s, "aaa", []);
    await sendToDialog(
      s,
      "aaa",
      "quiet hello",
      { fromThreadId: "cur", fromName: "主对话", at: 1 },
      async () => false,
    );
    const raw = JSON.parse(s.__map.get("dudu.local-chat.aaa.v1") as string);
    assert.ok(!("crossDialog" in raw[raw.length - 1]));
  });

  it("refuses empty messages", async () => {
    await assert.rejects(
      () =>
        sendToDialog(
          fakeStorage(),
          "aaa",
          "  ",
          { fromThreadId: "c", fromName: "n", at: 1 },
          async () => true,
        ),
      /empty message/,
    );
  });
});

describe("cross-dialog tools", () => {
  function toolsFor(s: CrossDialogStorage, threadId = "current") {
    const o = toolOpts(s, threadId);
    return { tools: createCrossDialogTools(o), ...o };
  }
  async function run(
    tools: ReturnType<typeof createCrossDialogTools>,
    name: string,
    args: Record<string, unknown>,
  ) {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, `tool ${name} exists`);
    return tool.run(args, { authorize: async () => true });
  }

  it("exposes exactly the four tools with manual ids", () => {
    const { tools } = toolsFor(fakeStorage());
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      "list_dialogs",
      "read_dialog",
      "send_to_dialog",
      "trace_read",
    ]);
    for (const t of tools) assert.equal(t.manualId, "cross-dialog");
  });

  it("list_dialogs lists and traces", async () => {
    const s = fakeStorage();
    seedHistory(s, "aaa", [{ role: "user", content: "hi" }]);
    const { tools, trace } = toolsFor(s);
    const out = await run(tools, "list_dialogs", {});
    assert.ok(out.includes("aaa"), out);
    const entries = await trace.list();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].action, "list");
    assert.equal(entries[0].fromThreadId, "current");
  });

  it("read_dialog reads by name and traces with reason", async () => {
    const s = fakeStorage();
    seedHistory(s, "aaa", [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi back" },
    ]);
    await setDialogName(s, "aaa", "旅行计划");
    const { tools, trace } = toolsFor(s);
    const out = await run(tools, "read_dialog", { dialog: "旅行", limit: 5 });
    assert.ok(out.includes("旅行计划"), out);
    assert.ok(out.includes("她：hello"), out);
    assert.ok(out.includes("嘟嘟：hi back"), out);
    const [e] = await trace.list();
    assert.equal(e.action, "read");
    assert.equal(e.toThreadId, "aaa");
    assert.equal(e.toName, "旅行计划");
  });

  it("send_to_dialog delivers, traces, and requires a reason", async () => {
    const s = fakeStorage();
    seedHistory(s, "aaa", []);
    await setDialogName(s, "aaa", "旅行计划");
    const { tools, trace } = toolsFor(s, "current");
    await assert.rejects(
      run(tools, "send_to_dialog", { dialog: "aaa", message: "hi" }),
      /needs a reason/,
    );
    const out = await run(tools, "send_to_dialog", {
      dialog: "aaa",
      message: "她让我告诉你一声",
      reason: "她说：跟旅行计划那边说一声",
    });
    assert.ok(out.includes("旅行计划"), out);
    const [e] = await trace.list();
    assert.equal(e.action, "send");
    assert.ok(e.summary.includes("她让我告诉你一声"));
    assert.ok(e.reason.includes("她说"));
  });

  it("send_to_dialog refuses the current dialog and incognito", async () => {
    const s = fakeStorage();
    seedHistory(s, "current", []);
    const o = toolOpts(s, "current");
    o.isIncognito = () => true;
    const tools = createCrossDialogTools(o);
    await assert.rejects(
      run(tools, "send_to_dialog", { dialog: "current", message: "x", reason: "r" }),
      /incognito/,
    );
    const o2 = toolOpts(s, "current");
    const tools2 = createCrossDialogTools(o2);
    await assert.rejects(
      run(tools2, "send_to_dialog", { dialog: "current", message: "x", reason: "r" }),
      /already talking in/,
    );
  });

  it("fail-closed: if the trace can't be written, the send never happens", async () => {
    const base = fakeStorage();
    seedHistory(base, "aaa", []);
    await setDialogName(base, "aaa", "旅行计划");
    const s: FakeStorage = {
      ...base,
      setItem: async (k, v) => {
        if (k === "dudu.cross-dialog-trace.v1") throw new Error("disk full");
        return base.setItem(k, v);
      },
    };
    const { tools } = toolsFor(s, "current");
    await assert.rejects(
      run(tools, "send_to_dialog", { dialog: "aaa", message: "hi", reason: "her request" }),
      /disk full/,
    );
    // The message must NOT have landed in the target dialog.
    const raw = JSON.parse((s.__map.get("dudu.local-chat.aaa.v1") ?? "[]") as string);
    assert.equal(raw.length, 0, "send happened without a trace — forbidden");
  });

  it("denies cross-persona targets", async () => {
    const s = fakeStorage();
    seedHistory(s, "aaa", []);
    await setDialogName(s, "aaa", "B 的", "persona-b");
    const { tools } = toolsFor(s);
    await assert.rejects(run(tools, "read_dialog", { dialog: "aaa" }), /different persona/);
  });
});

describe("CrossDialogTraceStore", () => {
  it("appends and lists newest-first", async () => {
    const s = fakeStorage();
    const t = new CrossDialogTraceStore(s);
    await t.append({
      action: "read",
      fromThreadId: "c",
      fromName: "主",
      toThreadId: "a",
      toName: "A",
      summary: "read 3",
      reason: "her request",
      personaId: "default",
    });
    await t.append({
      action: "send",
      fromThreadId: "c",
      fromName: "主",
      toThreadId: "a",
      toName: "A",
      summary: "hi",
      reason: "her request",
      personaId: "default",
    });
    const list = await t.list();
    assert.equal(list.length, 2);
    assert.equal(list[0].action, "send");
    assert.ok(list[0].id.startsWith("cdt_"));
  });

  it("caps at TRACE_MAX_ENTRIES", async () => {
    const s = fakeStorage();
    const t = new CrossDialogTraceStore(s);
    for (let i = 0; i < TRACE_MAX_ENTRIES + 10; i++) {
      await t.append({
        action: "list",
        fromThreadId: "c",
        fromName: "主",
        summary: `n${i}`,
        reason: "x",
        personaId: "default",
      });
    }
    assert.equal((await t.list(1000)).length, TRACE_MAX_ENTRIES);
  });

  it("falls back cleanly on corrupted storage", async () => {
    const bad = {
      getItem: async () => "{not json",
      setItem: async () => {},
    };
    const t = new CrossDialogTraceStore(bad);
    assert.deepEqual(await t.list(), []);
  });

  it("clear empties the trace", async () => {
    const s = fakeStorage();
    const t = new CrossDialogTraceStore(s);
    await t.append({
      action: "list",
      fromThreadId: "c",
      fromName: "主",
      summary: "x",
      reason: "x",
      personaId: "default",
    });
    await t.clear();
    assert.deepEqual(await t.list(), []);
  });
});

describe("CrossDialogVisibilityStore", () => {
  it("defaults the send tag to visible", async () => {
    const v = new CrossDialogVisibilityStore(fakeStorage());
    assert.equal(await v.isSendTagVisible("any"), true);
  });

  it("global toggle and per-dialog overrides", async () => {
    const s = fakeStorage();
    const v = new CrossDialogVisibilityStore(s);
    await v.setGlobalVisible(false);
    assert.equal(await v.isSendTagVisible("aaa"), false);
    await v.setDialogVisible("aaa", true);
    assert.equal(await v.isSendTagVisible("aaa"), true);
    assert.equal(await v.isSendTagVisible("bbb"), false);
    await v.setDialogVisible("aaa", null);
    assert.equal(await v.isSendTagVisible("aaa"), false);
  });

  it("falls back to defaults on corrupted storage", async () => {
    const bad = {
      getItem: async () => "{not json",
      setItem: async () => {},
    };
    const v = new CrossDialogVisibilityStore(bad);
    assert.equal(await v.isSendTagVisible("aaa"), true);
  });
});

describe("trace_read (AI-use P3-2)", () => {
  function toolsFor(s: CrossDialogStorage, threadId = "current") {
    const o = toolOpts(s, threadId);
    return { tools: createCrossDialogTools(o), ...o };
  }
  async function run(
    tools: ReturnType<typeof createCrossDialogTools>,
    name: string,
    args: Record<string, unknown>,
  ) {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, `tool ${name} exists`);
    return tool.run(args, { authorize: async () => true });
  }

  it("reports empty when nothing happened yet", async () => {
    const { tools } = toolsFor(fakeStorage());
    const out = (await run(tools, "trace_read", {})) as string;
    assert.ok(out.includes("empty"), out);
  });

  it("shows the AI's own sends newest-first", async () => {
    const s = fakeStorage();
    seedHistory(s, "other", [{ role: "user", content: "hi" }]);
    const { tools } = toolsFor(s);
    await run(tools, "send_to_dialog", {
      dialog: "other",
      message: "hello there",
      reason: "她亲口让我转告",
    });
    const out = (await run(tools, "trace_read", { limit: 5 })) as string;
    assert.ok(out.includes("send"), out);
    assert.ok(out.includes("hello there"), out);
    assert.ok(out.includes("她亲口让我转告"), out);
  });

  it("reading the trace leaves no trace entry (read-only)", async () => {
    const s = fakeStorage();
    const { tools, trace } = toolsFor(s);
    await run(tools, "trace_read", {});
    await run(tools, "trace_read", { limit: 1 });
    assert.equal((await trace.list()).length, 0);
  });

  it("hides entries from other personas", async () => {
    const s = fakeStorage();
    seedHistory(s, "other", [{ role: "user", content: "hi" }]);
    const { tools, trace } = toolsFor(s);
    // Simulate an entry recorded under a different persona.
    await trace.append({
      action: "send",
      fromThreadId: "current",
      fromName: "我",
      toThreadId: "other",
      toName: "other",
      summary: "other persona's business",
      reason: "other",
      personaId: "someone-else",
    });
    const out = (await run(tools, "trace_read", {})) as string;
    assert.ok(!out.includes("other persona's business"), out);
  });
});
