import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  defaultThreadMeta,
  deleteMessageFrom,
  estimateTokens,
  forkSlice,
  groupIdOf,
  loadThreadData,
  nextVersionIndex,
  saveThreadData,
  selectedIdFor,
  splitForCompression,
  truncateForEdit,
  truncateForRegenerate,
  versionsOf,
  visibleMessages,
  type VersionedMessage,
  type VersionStore,
} from "../src/chat/thread-versions.js";

function msg(id: string, role: "user" | "assistant", extra: Partial<VersionedMessage> = {}): VersionedMessage {
  return { id, role, ...extra };
}

function memStore(initial: Record<string, string> = {}): VersionStore & { data: Record<string, string> } {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: async (k) => (k in data ? data[k] : null),
    setItem: async (k, v) => {
      data[k] = v;
    },
  };
}

describe("thread-versions envelope", () => {
  it("reads the legacy v1 bare array and flags upgraded", async () => {
    const store = memStore({
      "dudu.local-chat.t1.v1": JSON.stringify([msg("a", "user"), msg("b", "assistant")]),
    });
    const { messages, meta, upgraded } = await loadThreadData("t1", store);
    assert.equal(messages.length, 2);
    assert.equal(upgraded, true);
    assert.deepEqual(meta.selectedVersions, {});
  });

  it("round-trips the v2 envelope", async () => {
    const store = memStore();
    const meta = { ...defaultThreadMeta(1000), selectedVersions: { g1: "b2" }, tokenBudget: 8000 };
    await saveThreadData("t1", [msg("a", "user"), msg("b", "assistant", { groupId: "g1" })], meta, store);
    const loaded = await loadThreadData("t1", store);
    assert.equal(loaded.messages.length, 2);
    assert.equal(loaded.upgraded, false);
    assert.equal(loaded.meta.selectedVersions.g1, "b2");
    assert.equal(loaded.meta.tokenBudget, 8000);
  });

  it("survives corrupt storage with an empty thread", async () => {
    const store = memStore({ "dudu.local-chat.t1.v1": "not json{{" });
    const { messages } = await loadThreadData("t1", store);
    assert.deepEqual(messages, []);
  });

  it("sanitizes hostile meta", async () => {
    const store = memStore();
    await store.setItem(
      "dudu.local-chat.t1.v1",
      JSON.stringify({ v: 2, messages: [], meta: { selectedVersions: { g: 42 }, tokenBudget: -5 } }),
    );
    const { meta } = await loadThreadData("t1", store);
    assert.deepEqual(meta.selectedVersions, {});
    assert.equal(meta.tokenBudget, undefined);
  });
});

describe("versions", () => {
  const messages = [
    msg("u1", "user"),
    msg("a1", "assistant", { groupId: "g1", versionIndex: 0 }),
    msg("a2", "assistant", { groupId: "g1", versionIndex: 1 }),
    msg("u2", "user"),
    msg("a3", "assistant", { groupId: "g2", versionIndex: 0 }),
  ];

  it("groupIdOf defaults to the message id", () => {
    assert.equal(groupIdOf(msg("x", "assistant")), "x");
    assert.equal(groupIdOf(msg("x", "assistant", { groupId: "g" })), "g");
  });

  it("visibleMessages shows only the selected version per group", () => {
    const meta = { ...defaultThreadMeta(), selectedVersions: { g1: "a2" } };
    const ids = visibleMessages(messages, meta).map((m) => m.id);
    assert.deepEqual(ids, ["u1", "a2", "u2", "a3"]);
  });

  it("visibleMessages defaults to the first version", () => {
    const ids = visibleMessages(messages, defaultThreadMeta()).map((m) => m.id);
    assert.deepEqual(ids, ["u1", "a1", "u2", "a3"]);
  });

  it("versionsOf returns oldest-first", () => {
    assert.deepEqual(
      versionsOf(messages, "g1").map((m) => m.id),
      ["a1", "a2"],
    );
  });

  it("nextVersionIndex increments", () => {
    assert.equal(nextVersionIndex(messages, "g1"), 2);
    assert.equal(nextVersionIndex(messages, "g9"), 0);
  });

  it("selectedIdFor falls back when the selection was deleted", () => {
    const meta = { ...defaultThreadMeta(), selectedVersions: { g1: "gone" } };
    assert.equal(selectedIdFor(messages, "g1", meta), "a1");
    assert.equal(selectedIdFor(messages, "nope", meta), null);
  });
});

describe("truncateForRegenerate", () => {
  const messages = [msg("u1", "user"), msg("a1", "assistant", { groupId: "g1" }), msg("u2", "user")];
  const meta = defaultThreadMeta();

  it("keeps everything before the target and returns its group", () => {
    const r = truncateForRegenerate(messages, meta, "a1");
    assert.ok(r);
    // a1 itself stays as v0 of its group — the fresh reply becomes v1.
    assert.deepEqual(r.kept.map((m) => m.id), ["u1", "a1"]);
    assert.equal(r.groupId, "g1");
  });

  it("returns null for user messages and unknown ids", () => {
    assert.equal(truncateForRegenerate(messages, meta, "u1"), null);
    assert.equal(truncateForRegenerate(messages, meta, "zzz"), null);
  });

  it("preserves unselected versions when regenerating an older selected version", () => {
    // Full list: v0 and v1 of g1, with v1 appended at the end (not adjacent).
    // She switched back to v0 (selected) and regenerates it: v1 must survive.
    const ms = [
      msg("u1", "user"),
      msg("a1", "assistant", { groupId: "g1", versionIndex: 0 }),
      msg("u2", "user"),
      msg("a2", "assistant", { groupId: "g1", versionIndex: 1 }),
    ];
    const m2 = { ...defaultThreadMeta(), selectedVersions: { g1: "a1" } };
    const r = truncateForRegenerate(ms, m2, "a1");
    assert.ok(r);
    // Visible timeline before a1 is just [u1]; a1 itself stays as v0 and
    // v1 (a2) — an unselected version of the target group — must survive.
    assert.deepEqual(
      r.kept.map((m) => m.id).sort(),
      ["a1", "a2", "u1"],
    );
    assert.equal(r.groupId, "g1");
  });

  it("drops later groups including their unselected versions", () => {
    const ms = [
      msg("u1", "user"),
      msg("a1", "assistant", { groupId: "g1", versionIndex: 0 }),
      msg("u2", "user"),
      msg("a2", "assistant", { groupId: "g2", versionIndex: 0 }),
      msg("a3", "assistant", { groupId: "g2", versionIndex: 1 }),
    ];
    const m2 = { ...defaultThreadMeta(), selectedVersions: { g2: "a3" } };
    const r = truncateForRegenerate(ms, m2, "a1");
    assert.ok(r);
    // g2's visible version (a3) is after the target: the whole group goes,
    // including its unselected version a2. The target a1 itself stays as
    // v0 of its group — the fresh reply will become v1.
    assert.deepEqual(r.kept.map((m) => m.id), ["u1", "a1"]);
  });
});

describe("truncateForEdit", () => {
  const messages = [msg("u1", "user"), msg("a1", "assistant"), msg("u2", "user")];
  const meta = defaultThreadMeta();

  it("keeps everything before the edited user message", () => {
    const r = truncateForEdit(messages, meta, "u1");
    assert.ok(r);
    assert.deepEqual(r.kept.map((m) => m.id), []);
    assert.equal(r.target.id, "u1");
  });

  it("returns null for assistant messages", () => {
    assert.equal(truncateForEdit(messages, meta, "a1"), null);
  });

  it("preserves unselected versions whose selected version is before the cut", () => {
    // v1 of g1 sits at the end of the full list, but its selected version
    // (v0) is before the edited message: the version survives.
    const ms = [
      msg("u1", "user"),
      msg("a1", "assistant", { groupId: "g1", versionIndex: 0 }),
      msg("u2", "user"),
      msg("a2", "assistant", { groupId: "g1", versionIndex: 1 }),
    ];
    const m2 = { ...defaultThreadMeta(), selectedVersions: { g1: "a1" } };
    const r = truncateForEdit(ms, m2, "u2");
    assert.ok(r);
    assert.deepEqual(
      r.kept.map((m) => m.id).sort(),
      ["a1", "a2", "u1"],
    );
    assert.equal(r.target.id, "u2");
  });

  it("drops a group whose selected version is after the edited message", () => {
    // The selected version (a2) follows u2 in the visible timeline, so the
    // whole group — including the unselected v0 — goes.
    const ms = [
      msg("u1", "user"),
      msg("a1", "assistant", { groupId: "g1", versionIndex: 0 }),
      msg("u2", "user"),
      msg("a2", "assistant", { groupId: "g1", versionIndex: 1 }),
    ];
    const m2 = { ...defaultThreadMeta(), selectedVersions: { g1: "a2" } };
    const r = truncateForEdit(ms, m2, "u2");
    assert.ok(r);
    assert.deepEqual(r.kept.map((m) => m.id), ["u1"]);
    assert.equal(r.target.id, "u2");
  });
});

describe("deleteMessageFrom", () => {
  it("deletes one version and re-points the selection", () => {
    const messages = [
      msg("a1", "assistant", { groupId: "g1", versionIndex: 0 }),
      msg("a2", "assistant", { groupId: "g1", versionIndex: 1 }),
    ];
    const meta = { ...defaultThreadMeta(), selectedVersions: { g1: "a2" } };
    const { messages: kept, meta: next } = deleteMessageFrom(messages, meta, "a2", false);
    assert.deepEqual(kept.map((m) => m.id), ["a1"]);
    assert.equal(next.selectedVersions.g1, "a1");
  });

  it("deletes all versions of a group when asked", () => {
    const messages = [
      msg("u1", "user"),
      msg("a1", "assistant", { groupId: "g1", versionIndex: 0 }),
      msg("a2", "assistant", { groupId: "g1", versionIndex: 1 }),
    ];
    const { messages: kept, meta: next } = deleteMessageFrom(
      messages,
      defaultThreadMeta(),
      "a1",
      true,
    );
    assert.deepEqual(kept.map((m) => m.id), ["u1"]);
    assert.deepEqual(next.selectedVersions, {});
  });

  it("deleting a user message leaves versions alone", () => {
    const messages = [msg("u1", "user"), msg("a1", "assistant", { groupId: "g1" })];
    const { messages: kept } = deleteMessageFrom(messages, defaultThreadMeta(), "u1", true);
    assert.deepEqual(kept.map((m) => m.id), ["a1"]);
  });
});

describe("forkSlice", () => {
  it("copies resolved messages up to the anchor and collapses versions", () => {
    const messages = [
      msg("u1", "user"),
      msg("a1", "assistant", { groupId: "g1", versionIndex: 0 }),
      msg("a2", "assistant", { groupId: "g1", versionIndex: 1 }),
      msg("u2", "user"),
    ];
    const meta = { ...defaultThreadMeta(), selectedVersions: { g1: "a2" } };
    const forked = forkSlice(messages, meta, "u2");
    assert.ok(forked);
    assert.deepEqual(
      forked.map((m) => m.id),
      ["u1", "a2", "u2"],
    );
    // Version identity collapsed: each message stands alone in the new thread.
    assert.equal(forked[1].groupId, "a2");
    assert.equal(forked[1].versionIndex, 0);
  });

  it("returns null for unknown anchors", () => {
    assert.equal(forkSlice([msg("u1", "user")], defaultThreadMeta(), "zzz"), null);
  });
});

describe("token estimates and compression split", () => {
  it("estimates ~4 chars per token", () => {
    assert.equal(estimateTokens("abcd"), 1);
    assert.equal(estimateTokens("abcde"), 2);
  });

  it("splitForCompression never cuts inside a user->assistant pair", () => {
    const messages = [
      msg("u1", "user"),
      msg("a1", "assistant"),
      msg("u2", "user"),
      msg("a2", "assistant"),
      msg("u3", "user"),
    ];
    // keepTailCount=2 would cut between u2 and a2; boundary moves back to after a1.
    const { head, tail } = splitForCompression(messages, 2);
    assert.deepEqual(head.map((m) => m.id), ["u1", "a1"]);
    assert.deepEqual(tail.map((m) => m.id), ["u2", "a2", "u3"]);
  });

  it("splitForCompression keeps everything when short", () => {
    const messages = [msg("u1", "user")];
    const { head, tail } = splitForCompression(messages, 10);
    assert.deepEqual(head, []);
    assert.deepEqual(tail.map((m) => m.id), ["u1"]);
  });
});
