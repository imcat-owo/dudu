/**
 * P1-11 regression: chat history persistence used to swallow storage
 * failures silently — history was lost with no signal. Failures are now
 * flagged per thread, surfaced to listeners, retried, and retryable.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createLocalAgent,
  type HistoryStore,
  historyPersistFailed,
  type LocalChatMessage,
} from "../src/api-groups/local-agent.js";

function fakeStore(): HistoryStore & { data: Map<string, string>; writes: number } {
  const data = new Map<string, string>();
  const store: HistoryStore & { data: Map<string, string>; writes: number } = {
    data,
    writes: 0,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => {
      data.set(k, v);
      store.writes += 1;
    },
  };
  return store;
}

function failingStore(): HistoryStore {
  return {
    getItem: async () => null,
    setItem: async () => {
      throw new Error("disk full");
    },
  };
}

const msg = (id: string, role: "user" | "assistant", content: string): LocalChatMessage => ({
  id,
  role,
  content,
});

const flush = () => new Promise((r) => setTimeout(r, 10));

function agent(threadId: string, historyStore: HistoryStore, incognito = false) {
  return createLocalAgent({
    threadId,
    getGroup: () => null,
    historyStore,
    isIncognito: () => incognito,
  });
}

describe("history persist failure surfacing (P1-11)", () => {
  it("failed save flags the thread; session keeps working in memory", async () => {
    const a = agent("p11-t1", failingStore());
    a.setMessages([msg("u1", "user", "hello")]);
    await flush();
    assert.equal(historyPersistFailed("p11-t1"), true, "failure flagged, not silent");
    // The in-memory mirror keeps the session alive.
    assert.equal(a.messages.length, 1);
    assert.equal(a.messages[0].content, "hello");
  });

  it("listeners receive the failure flag in the event", async () => {
    const a = agent("p11-t2", failingStore());
    let seen: boolean | undefined;
    const sub = a.subscribe({
      onMessagesChanged: (e) => {
        seen = e.historySaveFailed;
      },
    });
    a.setMessages([msg("u1", "user", "hi")]);
    await flush();
    sub.unsubscribe();
    assert.equal(seen, true);
  });

  it("retryHistorySave succeeds once storage recovers and clears the flag", async () => {
    let broken = true;
    const data = new Map<string, string>();
    const store: HistoryStore = {
      getItem: async (k) => data.get(k) ?? null,
      setItem: async (k, v) => {
        if (broken) throw new Error("disk full");
        data.set(k, v);
      },
    };
    const a = agent("p11-t3", store);
    a.setMessages([msg("u1", "user", "keep me")]);
    await flush();
    assert.equal(historyPersistFailed("p11-t3"), true);

    broken = false;
    const ok = await a.retryHistorySave();
    assert.equal(ok, true);
    assert.equal(historyPersistFailed("p11-t3"), false, "flag cleared on success");
    const saved = data.get("dudu.local-chat.p11-t3.v1");
    assert.ok(saved, "messages actually persisted on retry");
    assert.ok(saved.includes("keep me"));
  });

  it("retry still failing keeps the flag up and resolves false", async () => {
    const a = agent("p11-t4", failingStore());
    a.setMessages([msg("u1", "user", "x")]);
    await flush();
    const ok = await a.retryHistorySave();
    assert.equal(ok, false);
    assert.equal(historyPersistFailed("p11-t4"), true);
  });

  it("successful saves never set the flag", async () => {
    const store = fakeStore();
    const a = agent("p11-t5", store);
    a.setMessages([msg("u1", "user", "fine")]);
    await flush();
    assert.equal(historyPersistFailed("p11-t5"), false);
    assert.equal(store.writes, 1);
  });

  it("incognito retry is a harmless true with zero writes", async () => {
    const store = fakeStore();
    const a = agent("p11-t6", store, true);
    a.setMessages([msg("u1", "user", "secret")]);
    await flush();
    assert.equal(await a.retryHistorySave(), true);
    assert.equal(store.writes, 0);
    assert.equal(historyPersistFailed("p11-t6"), false);
  });
});
