import "./helpers/rn-stub.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLocalSystemPrompt } from "../src/api-groups/local-agent.js";
import {
  createLocalTools,
  createToolRegistry,
  READ_MANUAL_TOOL_NAME,
  type ToolContext,
  ToolError,
} from "../src/api-groups/local-tools.js";
import {
  buildManualIndex,
  getManual,
  MANUALS,
  manualIds,
  manualNote,
} from "../src/manuals/index.js";

const ctx: ToolContext = { authorize: async () => true };
const resolve = (key: string) => key;
const EMOJI_RE = /[😀-🙏🌀-🗿🚀-🛿☀-➿⬀-⯿]/u;

describe("manual registry", () => {
  it("has unique ids and complete fields", () => {
    const ids = manualIds();
    assert.equal(new Set(ids).size, ids.length, "duplicate manual ids");
    assert.ok(ids.length >= 8, "expected at least 8 seeded manuals");
    for (const m of MANUALS) {
      assert.ok(m.id, "missing id");
      assert.ok(m.title, "missing title");
      assert.ok(m.file.endsWith(".ts"), `bad file path: ${m.file}`);
      assert.ok(m.when.length > 10, `when too short for ${m.id}`);
      assert.ok(m.body.length > 100, `body too short for ${m.id}`);
    }
  });

  it("getManual finds by id, undefined for unknown", () => {
    assert.equal(getManual("permissions")?.title, "Device permissions & AI authorization");
    assert.equal(getManual("nope"), undefined);
  });

  it("manualNote is one line for known ids, empty for unknown", () => {
    const note = manualNote("permissions");
    assert.ok(note.includes("src/manuals/permissions.ts"));
    assert.ok(note.includes("Device permissions"));
    assert.equal(note.split("\n").length, 1, "note must be one line");
    assert.equal(manualNote("nope"), "");
  });

  it("index is token-minimal and covers every manual", () => {
    const index = buildManualIndex();
    for (const m of MANUALS) {
      assert.ok(index.includes(m.id), `index missing ${m.id}`);
      assert.ok(index.includes(m.file), `index missing file for ${m.id}`);
    }
    assert.ok(
      index.length < MANUALS.length * 115,
      `index too long: ${index.length} chars for ${MANUALS.length} manuals`,
    );
    assert.equal(index.split("\n").length, MANUALS.length, "one line per manual");
  });

  it("no emoji anywhere in manuals or index", () => {
    assert.ok(!EMOJI_RE.test(buildManualIndex()), "emoji in index");
    for (const m of MANUALS) {
      assert.ok(!EMOJI_RE.test(m.body), `emoji in manual ${m.id}`);
      assert.ok(!EMOJI_RE.test(m.title), `emoji in title ${m.id}`);
    }
  });
});

describe("read_manual tool", () => {
  it("is registered with a proper definition", () => {
    const registry = createToolRegistry(createLocalTools());
    assert.ok(registry.names().includes(READ_MANUAL_TOOL_NAME));
    const def = registry.definitions().find((d) => d.function.name === READ_MANUAL_TOOL_NAME);
    assert.ok(def);
    assert.ok(def.function.parameters.required?.includes("manual_id"));
  });

  it("returns the full manual body for a known id", async () => {
    const registry = createToolRegistry(createLocalTools());
    const out = await registry.execute(READ_MANUAL_TOOL_NAME, { manual_id: "permissions" }, ctx);
    assert.ok(out.includes("Device permissions"));
    assert.ok(out.includes("authorization gate"));
  });

  it("throws ToolError listing available ids for unknown manual", async () => {
    const registry = createToolRegistry(createLocalTools());
    await assert.rejects(
      () => registry.execute(READ_MANUAL_TOOL_NAME, { manual_id: "nope" }, ctx),
      (e: unknown) => {
        assert.ok(e instanceof ToolError);
        assert.ok((e as Error).message.includes("permissions"));
        return true;
      },
    );
  });
});

describe("system prompt wiring", () => {
  it("includes the manual index and the read-first instruction", () => {
    const tools = createLocalTools();
    const prompt = buildLocalSystemPrompt(tools, resolve as never);
    assert.ok(prompt.includes("read_manual"), "prompt missing read_manual mention");
    for (const id of manualIds()) {
      assert.ok(prompt.includes(id), `prompt index missing ${id}`);
    }
  });
});
