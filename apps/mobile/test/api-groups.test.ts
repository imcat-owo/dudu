import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSseParser, GroupError, parseSseData } from "../src/api-groups/direct-transport.js";
import { createGroupStore, type SecureBackend } from "../src/api-groups/store.js";
import {
  type ApiGroup,
  blankGroup,
  normalizeBaseUrl,
  validateGroup,
} from "../src/api-groups/types.js";

function fakeSecure(): SecureBackend & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => {
      data.set(k, v);
    },
    deleteItem: async (k) => {
      data.delete(k);
    },
  };
}

function sampleGroup(over: Partial<ApiGroup> = {}): ApiGroup {
  return {
    id: "g_test1",
    name: "主力",
    vendor: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-test",
    model: "gpt-4o-mini",
    headers: {},
    createdAt: 1,
    ...over,
  };
}

describe("validateGroup", () => {
  it("accepts a complete group", () => {
    assert.equal(validateGroup(sampleGroup()), null);
  });
  it("rejects missing name / url / key / model in order", () => {
    assert.equal(validateGroup(sampleGroup({ name: " " })), "nameRequired");
    assert.equal(validateGroup(sampleGroup({ baseUrl: "" })), "baseUrlRequired");
    assert.equal(validateGroup(sampleGroup({ baseUrl: "not-a-url" })), "baseUrlInvalid");
    assert.equal(validateGroup(sampleGroup({ apiKey: "" })), "apiKeyRequired");
    assert.equal(validateGroup(sampleGroup({ model: "  " })), "modelRequired");
  });
  it("normalizeBaseUrl strips trailing slashes", () => {
    assert.equal(normalizeBaseUrl("https://x.com/v1///"), "https://x.com/v1");
  });
  it("blankGroup fills the vendor preset url", () => {
    assert.equal(blankGroup("openai").baseUrl, "https://api.openai.com/v1");
    assert.equal(blankGroup("custom").baseUrl, "");
  });
});

describe("parseSseData", () => {
  it("extracts the text delta", () => {
    const delta = parseSseData("g", JSON.stringify({ choices: [{ delta: { content: "hello" } }] }));
    assert.equal(delta, "hello");
  });
  it("returns null for [DONE] and non-data frames", () => {
    assert.equal(parseSseData("g", "[DONE]"), null);
    assert.equal(parseSseData("g", JSON.stringify({ choices: [{ delta: {} }] })), null);
  });
  it("throws GroupError naming the group on API errors", () => {
    assert.throws(
      () => parseSseData("主力", JSON.stringify({ error: { message: "bad key" } })),
      (e: unknown) =>
        e instanceof GroupError && e.groupName === "主力" && /bad key/.test(e.message),
    );
  });
});

describe("createSseParser", () => {
  it("emits deltas across chunk boundaries", () => {
    const deltas: string[] = [];
    const parser = createSseParser("g", (d) => deltas.push(d));
    const line1 = `data: ${JSON.stringify({ choices: [{ delta: { content: "hel" } }] })}\n`;
    const line2 = `data: ${JSON.stringify({ choices: [{ delta: { content: "lo" } }] })}\n`;
    parser.push(line1.slice(0, 10)); // split mid-line
    parser.push(line1.slice(10) + line2);
    parser.push("data: [DONE]\n");
    assert.deepEqual(deltas, ["hel", "lo"]);
  });
  it("ignores non-data lines", () => {
    const deltas: string[] = [];
    const parser = createSseParser("g", (d) => deltas.push(d));
    parser.push(": keep-alive\n\ndata: [DONE]\n\n");
    assert.deepEqual(deltas, []);
  });
});

describe("createGroupStore", () => {
  it("upsert/remove/setActive round-trip with a fake backend", async () => {
    const secure = fakeSecure();
    const store = createGroupStore(secure);
    await store.upsert(sampleGroup());
    await store.upsert(sampleGroup({ id: "g_test2", name: "备用" }));
    let snap = store.getSnapshot();
    assert.equal(snap.groups.length, 2);
    // First group becomes active automatically.
    assert.equal(snap.activeId, "g_test1");

    await store.setActive("g_test2");
    assert.equal(store.getSnapshot().activeId, "g_test2");

    await store.remove("g_test2");
    snap = store.getSnapshot();
    assert.equal(snap.groups.length, 1);
    assert.equal(snap.activeId, "g_test1"); // falls back to the survivor

    // Secrets went to the secure backend only.
    const stored = secure.data.get("openmuse.api-groups.v1") ?? "";
    assert.ok(stored.includes("sk-test"), "key persisted in secure backend");
  });

  it("editing a group keeps its id and secrets", async () => {
    const store = createGroupStore(fakeSecure());
    await store.upsert(sampleGroup());
    await store.upsert(sampleGroup({ model: "gpt-4o" }));
    const snap = store.getSnapshot();
    assert.equal(snap.groups.length, 1);
    assert.equal(snap.groups[0].model, "gpt-4o");
    assert.equal(snap.groups[0].apiKey, "sk-test");
  });

  it("corrupt JSON parses to an empty list, never throws", async () => {
    const secure = fakeSecure();
    secure.data.set("openmuse.api-groups.v1", "not json{{{");
    const store = createGroupStore(secure);
    // ensureLoaded runs on creation; give it a tick.
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(store.getSnapshot().groups, []);
  });
});
