import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { messageToolActions } from "../src/activity-drawer-model.js";
import { accumulateToolCalls, parseSseToolCallDeltas } from "../src/api-groups/direct-transport.js";
import {
  buildLocalSystemPrompt,
  MAX_TOOL_ITERATIONS,
  parseToolArgs,
} from "../src/api-groups/local-agent.js";
import {
  createLocalTools,
  createToolRegistry,
  type ToolContext,
  ToolError,
} from "../src/api-groups/local-tools.js";

const allowAll: ToolContext = {
  authorize: async () => true,
};
const denyAll: ToolContext = {
  authorize: async () => false,
};

describe("local tool registry", () => {
  it("exposes OpenAI function-calling definitions", () => {
    const tools = createLocalTools({
      now: () => new Date("2026-10-03T12:00:00Z"),
    });
    const registry = createToolRegistry(tools);
    const defs = registry.definitions();
    assert.ok(defs.length >= 2);
    for (const d of defs) {
      assert.equal(d.type, "function");
      assert.ok(d.function.name);
      assert.ok(d.function.description);
      assert.equal(d.function.parameters.type, "object");
    }
    const names = registry.names();
    assert.ok(names.includes("get_current_time"));
    assert.ok(names.includes("get_app_info"));
  });

  it("get_current_time returns a real date string", async () => {
    const tools = createLocalTools({ now: () => new Date("2026-10-03T12:00:00Z") });
    const registry = createToolRegistry(tools);
    const out = await registry.execute("get_current_time", {}, allowAll);
    assert.ok(out.includes("2026"));
  });

  it("get_app_info returns name/version/platform", async () => {
    const tools = createLocalTools({
      appInfo: () => ({ name: "TestApp", version: "1.2.3", platform: "ios" }),
    });
    const registry = createToolRegistry(tools);
    const out = await registry.execute("get_app_info", {}, allowAll);
    assert.ok(out.includes("TestApp"));
    assert.ok(out.includes("1.2.3"));
  });

  it("get_app_info default reads the real app.json version, never 'dev' (AI-use P2-5)", async () => {
    const tools = createLocalTools({});
    const registry = createToolRegistry(tools);
    const out = await registry.execute("get_app_info", {}, allowAll);
    assert.ok(!out.includes("version: dev"), `AI must never say "dev": ${out}`);
    assert.match(out, /version: \d+\.\d+\.\d+/);
  });

  it("get_current_time agrees with the device clock and includes the weekday (AI-use P2-1)", async () => {
    const tools = createLocalTools({ now: () => new Date("2026-10-05T04:00:00Z") });
    const registry = createToolRegistry(tools);
    const out = await registry.execute("get_current_time", {}, allowAll);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    assert.ok(out.includes("星期"), `expected weekday, got: ${out}`);
    assert.ok(out.includes(`(${tz})`), `expected device tz label, got: ${out}`);
  });

  it("unknown tool throws ToolError", async () => {
    const registry = createToolRegistry(createLocalTools());
    await assert.rejects(() => registry.execute("nope", {}, allowAll), ToolError);
  });

  it("capability tool runs when authorized", async () => {
    const tools = createLocalTools({
      readClipboard: async () => "hello-clipboard",
    });
    const registry = createToolRegistry(tools);
    assert.ok(registry.names().includes("read_clipboard"));
    const out = await registry.execute("read_clipboard", {}, allowAll);
    assert.equal(out, "hello-clipboard");
  });

  it("capability tool fails closed when denied (error, not silent)", async () => {
    let ran = false;
    const tools = createLocalTools({
      readClipboard: async () => {
        ran = true;
        return "should-not-happen";
      },
    });
    const registry = createToolRegistry(tools);
    await assert.rejects(() => registry.execute("read_clipboard", {}, denyAll), ToolError);
    assert.equal(ran, false);
  });

  it("capability tool fails closed when authorize throws", async () => {
    const tools = createLocalTools({
      readClipboard: async () => "x",
    });
    const registry = createToolRegistry(tools);
    const throwing: ToolContext = {
      authorize: async () => {
        throw new Error("popup exploded");
      },
    };
    // The tool's run calls authorize; a throw propagates as an error the
    // agent turns into a tool error message — never a silent allow.
    await assert.rejects(() => registry.execute("read_clipboard", {}, throwing));
  });

  it("write_clipboard requires text argument", async () => {
    let written = "";
    const tools = createLocalTools({
      writeClipboard: async (t) => {
        written = t;
      },
    });
    const registry = createToolRegistry(tools);
    const out = await registry.execute("write_clipboard", { text: "hi" }, allowAll);
    assert.equal(written, "hi");
    assert.ok(out.includes("clipboard"));
    await assert.rejects(() => registry.execute("write_clipboard", {}, allowAll), ToolError);
  });

  it("read_recent_photos clamps limit 1-10", async () => {
    let gotLimit = 0;
    const tools = createLocalTools({
      readPhotos: async (limit) => {
        gotLimit = limit;
        return [{ uri: "u1", id: "i1" }];
      },
    });
    const registry = createToolRegistry(tools);
    await registry.execute("read_recent_photos", { limit: 99 }, allowAll);
    assert.equal(gotLimit, 10);
    await registry.execute("read_recent_photos", { limit: -5 }, allowAll);
    assert.equal(gotLimit, 1);
  });

  it("capability tools are absent without device deps (no fakes)", () => {
    const registry = createToolRegistry(createLocalTools());
    const names = registry.names();
    assert.ok(!names.includes("read_recent_photos"));
    assert.ok(!names.includes("get_current_location"));
    assert.ok(!names.includes("read_clipboard"));
    // In-app tools always present.
    assert.ok(names.includes("get_current_time"));
  });
});

describe("parseToolArgs", () => {
  it("parses valid JSON objects", () => {
    assert.deepEqual(parseToolArgs('{"a":1}'), { a: 1 });
  });
  it("empty/malformed becomes {}", () => {
    assert.deepEqual(parseToolArgs(""), {});
    assert.deepEqual(parseToolArgs("not json{"), {});
    assert.deepEqual(parseToolArgs("[1,2]"), {});
  });
});

describe("SSE tool-call parsing", () => {
  it("parses a tool_calls delta frame", () => {
    const data = JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, id: "call_1", function: { name: "get_time", arguments: "" } }],
          },
        },
      ],
    });
    const deltas = parseSseToolCallDeltas(data);
    assert.equal(deltas.length, 1);
    assert.equal(deltas[0].index, 0);
    assert.equal(deltas[0].id, "call_1");
    assert.equal(deltas[0].name, "get_time");
  });

  it("ignores malformed frames without throwing", () => {
    assert.deepEqual(parseSseToolCallDeltas("not json"), []);
    assert.deepEqual(parseSseToolCallDeltas("[DONE]"), []);
    assert.deepEqual(parseSseToolCallDeltas(JSON.stringify({ choices: [] })), []);
  });

  it("accumulates multi-chunk tool calls by index", () => {
    const acc = accumulateToolCalls();
    acc.push({ index: 0, id: "call_1", name: "write_clipboard" });
    acc.push({ index: 0, argumentsChunk: '{"text":' });
    acc.push({ index: 0, argumentsChunk: '"hi"}' });
    acc.push({ index: 1, id: "call_2", name: "get_current_time", argumentsChunk: "" });
    const done = acc.complete();
    assert.equal(done.length, 2);
    assert.equal(done[0].id, "call_1");
    assert.equal(done[0].name, "write_clipboard");
    assert.equal(done[0].arguments, '{"text":"hi"}');
    assert.equal(done[1].name, "get_current_time");
  });

  it("drops empty frames and synthesizes missing ids", () => {
    const acc = accumulateToolCalls();
    acc.push({ index: 0 }); // no name — not a real call
    acc.push({ index: 1, name: "get_current_time" }); // no id
    const done = acc.complete();
    assert.equal(done.length, 1);
    assert.ok(done[0].id.startsWith("tool_"));
  });
});

describe("buildLocalSystemPrompt", () => {
  it("includes tools and capability section", () => {
    const tools = createLocalTools({ now: () => new Date() });
    const prompt = buildLocalSystemPrompt(tools, (k) => `[${k}]`);
    assert.ok(prompt.includes("get_current_time"));
    // Capability section rendered via buildCapabilityPromptSection.
    assert.ok(prompt.includes("[perm.kind.photos]"));
    assert.ok(prompt.includes("[perm.aiDesc.photos]"));
  });

  it("opens with the identity block (P1-1: dynamic AI name, boyfriend, 嘟嘟腔)", () => {
    const tools = createLocalTools({ now: () => new Date() });
    const prompt = buildLocalSystemPrompt(tools, (k) => `[${k}]`, undefined, undefined, {
      aiName: "阿茶",
    });
    assert.ok(prompt.includes("阿茶"), "identity uses the user's AI name");
    assert.ok(!prompt.includes("小梦"), "identity has no hardcoded name");
    assert.ok(prompt.includes("boyfriend"), "identity states the relationship");
    assert.ok(prompt.includes("嘟嘟"), "identity names the app");
    assert.ok(
      prompt.indexOf("Who you are") < prompt.indexOf("Your tools:"),
      "identity comes before the tool list",
    );
  });

  it("falls back to ai.defaultName when no aiName is given", () => {
    const prompt = buildLocalSystemPrompt([], (k) => `[${k}]`);
    assert.ok(prompt.includes("[ai.defaultName]"), "identity falls back to the default name");
    assert.ok(!prompt.includes("小梦"), "identity has no hardcoded name");
  });

  it("includes the incognito section when incognito (P1-4)", () => {
    const prompt = buildLocalSystemPrompt([], (k) => `[${k}]`, undefined, undefined, {
      isIncognito: true,
    });
    assert.ok(prompt.includes("Incognito session"));
    const normal = buildLocalSystemPrompt([], (k) => `[${k}]`);
    assert.ok(!normal.includes("Incognito session"));
  });

  it("works with zero tools", () => {
    const prompt = buildLocalSystemPrompt([], (k) => `[${k}]`);
    assert.ok(prompt.includes("[perm.kind.bluetooth]"));
  });
});

describe("tool loop safety", () => {
  it("MAX_TOOL_ITERATIONS is a sane cap", () => {
    assert.equal(MAX_TOOL_ITERATIONS, 10);
    assert.ok(MAX_TOOL_ITERATIONS > 0 && MAX_TOOL_ITERATIONS <= 20);
  });
});

describe("drawer integration", () => {
  it("local tool calls flow into messageToolActions", () => {
    const msg = {
      id: "a1",
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "get_current_time", arguments: "{}" },
        },
      ],
    };
    const toolMsg = {
      id: "t1",
      role: "tool",
      content: "2026-10-03",
      toolCallId: "call_1",
    };
    const actions = messageToolActions(msg, [msg, toolMsg]);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].title, "get_current_time");
    assert.equal(actions[0].status, "done");
    assert.equal(actions[0].output, "2026-10-03");
  });

  it("running tool call (no result yet) shows as running", () => {
    const msg = {
      id: "a1",
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "read_clipboard", arguments: "{}" },
        },
      ],
    };
    const actions = messageToolActions(msg, [msg]);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].status, "running");
  });
});
