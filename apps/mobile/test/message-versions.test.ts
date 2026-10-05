/**
 * Gap fill A1/A2/A5: agent-level version operations on createLocalAgent.
 * Group-requiring paths (regenerateAt/editAndRegenerate) are covered for
 * their honest no-group error; truncation semantics live in
 * thread-versions.test.ts. deleteMessage and thread-meta persistence run
 * end to end against a fake store.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createLocalAgent,
  loadThread,
  type HistoryStore,
  type LocalChatMessage,
} from "../src/api-groups/local-agent.js";

function memStore(): HistoryStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v);
    },
  };
}

const msg = (
  id: string,
  role: "user" | "assistant",
  content: string,
  extra: Partial<LocalChatMessage> = {},
): LocalChatMessage => ({ id, role, content, ...extra });

function agent(threadId: string, store: HistoryStore) {
  return createLocalAgent({ threadId, getGroup: () => null, historyStore: store });
}

const flush = () => new Promise((r) => setTimeout(r, 20));

describe("deleteMessage (A5)", () => {
  it("deletes one version; selection re-points to a survivor", async () => {
    const store = memStore();
    const a = agent("del-1", store);
    a.setMessages([
      msg("u1", "user", "hi"),
      msg("a1", "assistant", "first", { groupId: "g", versionIndex: 0 }),
      msg("a2", "assistant", "second", { groupId: "g", versionIndex: 1 }),
    ]);
    await flush();
    a.setThreadMeta({
      selectedVersions: { g: "a2" },
      createdAt: 1,
      updatedAt: 1,
    });
    await flush();
    await a.deleteMessage("a2", false);
    await flush();
    assert.deepEqual(
      a.messages.map((m) => m.id),
      ["u1", "a1"],
    );
    assert.equal(a.getThreadMeta().selectedVersions["g"], "a1");
  });

  it("deleteVersions=true removes the whole group", async () => {
    const store = memStore();
    const a = agent("del-2", store);
    a.setMessages([
      msg("u1", "user", "hi"),
      msg("a1", "assistant", "first", { groupId: "g", versionIndex: 0 }),
      msg("a2", "assistant", "second", { groupId: "g", versionIndex: 1 }),
      msg("u2", "user", "later"),
    ]);
    await flush();
    await a.deleteMessage("a1", true);
    await flush();
    assert.deepEqual(
      a.messages.map((m) => m.id),
      ["u1", "u2"],
    );
    assert.ok(!("g" in a.getThreadMeta().selectedVersions));
  });

  it("only shows the selected version in messages", async () => {
    const store = memStore();
    const a = agent("del-3", store);
    a.setMessages([
      msg("u1", "user", "hi"),
      msg("a1", "assistant", "first", { groupId: "g", versionIndex: 0 }),
      msg("a2", "assistant", "second", { groupId: "g", versionIndex: 1 }),
    ]);
    await flush();
    a.setThreadMeta({ selectedVersions: { g: "a1" }, createdAt: 1, updatedAt: 1 });
    await flush();
    assert.deepEqual(a.messages.map((m) => m.id), ["u1", "a1"]);
  });
});

describe("thread meta persistence", () => {
  it("systemPrompt and tokenBudget survive a reload", async () => {
    const store = memStore();
    const a = agent("meta-1", store);
    a.setMessages([msg("u1", "user", "hi")]);
    await flush();
    a.setThreadMeta({
      selectedVersions: {},
      systemPrompt: "be brief",
      tokenBudget: 12345,
      createdAt: 1,
      updatedAt: 2,
    });
    await flush();
    const loaded = await loadThread("meta-1", store);
    assert.equal(loaded.meta.systemPrompt, "be brief");
    assert.equal(loaded.meta.tokenBudget, 12345);
  });
});

describe("no-group honesty", () => {
  it("regenerateAt throws a plain GroupError without a group", async () => {
    const a = agent("ng-1", memStore());
    a.setMessages([msg("u1", "user", "hi"), msg("a1", "assistant", "yo")]);
    await flush();
    await assert.rejects(() => a.regenerateAt("a1"), /noApiGroup/);
  });

  it("editAndRegenerate throws a plain GroupError without a group", async () => {
    const a = agent("ng-2", memStore());
    a.setMessages([msg("u1", "user", "hi"), msg("a1", "assistant", "yo")]);
    await flush();
    await assert.rejects(() => a.editAndRegenerate("u1", "hello"), /noApiGroup/);
  });

  it("compressContext throws a plain GroupError without a group", async () => {
    const a = agent("ng-3", memStore());
    await assert.rejects(() => a.compressContext(), /noApiGroup/);
  });

  it("getContextUsage estimates visible tokens", async () => {
    const a = agent("ng-4", memStore());
    a.setMessages([msg("u1", "user", "hello world")]);
    await flush();
    const usage = a.getContextUsage();
    assert.ok(usage.tokens > 0, "estimates something");
    assert.equal(usage.messages, 1);
  });
});
