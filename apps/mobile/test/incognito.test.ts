import "./helpers/rn-stub.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createLocalAgent,
  type HistoryStore,
  type LocalChatMessage,
  loadLocalHistory,
} from "../src/api-groups/local-agent.js";

/** In-memory HistoryStore — AsyncStorage has no node implementation. */
function fakeStore(): HistoryStore & { data: Map<string, string>; writes: string[] } {
  const data = new Map<string, string>();
  const writes: string[] = [];
  return {
    data,
    writes,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => {
      data.set(k, v);
      writes.push(k);
    },
  };
}

const msg = (id: string, role: "user" | "assistant", content: string): LocalChatMessage => ({
  id,
  role,
  content,
});

describe("incognito history gating", () => {
  it("normal mode persists via setMessages", async () => {
    const store = fakeStore();
    const agent = createLocalAgent({
      threadId: "t1",
      getGroup: () => null,
      historyStore: store,
      isIncognito: () => false,
    });
    agent.setMessages([msg("u1", "user", "hello"), msg("a1", "assistant", "hi")]);
    // saveLocalHistory is fire-and-forget; let the microtask flush.
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(store.writes.length, 1);
    const saved = await loadLocalHistory("t1", store);
    assert.equal(saved.length, 2);
    assert.equal(saved[0].content, "hello");
  });

  it("incognito mode NEVER writes via setMessages", async () => {
    const store = fakeStore();
    const agent = createLocalAgent({
      threadId: "t2",
      getGroup: () => null,
      historyStore: store,
      isIncognito: () => true,
    });
    agent.setMessages([msg("u1", "user", "secret"), msg("a1", "assistant", "shh")]);
    agent.addMessage({ id: "u2", role: "user", content: "more secrets" });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(store.writes.length, 0);
    assert.equal(store.data.size, 0);
    // In-memory session still works — messages are visible, just not stored.
    assert.equal(agent.messages.length, 3);
  });

  it("toggling incognito ON does not wipe saved normal history", async () => {
    const store = fakeStore();
    let incognito = false;
    const agent = createLocalAgent({
      threadId: "t3",
      getGroup: () => null,
      historyStore: store,
      isIncognito: () => incognito,
    });
    // Normal session: history saved.
    agent.setMessages([msg("u1", "user", "normal chat")]);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(store.writes.length, 1);

    // User toggles incognito ON — chat.tsx calls setMessages([]) to start fresh.
    // This must NOT overwrite the saved normal history with [].
    incognito = true;
    agent.setMessages([]);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(store.writes.length, 1, "no write should happen while incognito");

    // Toggle back OFF — normal history is intact.
    incognito = false;
    const saved = await loadLocalHistory("t3", store);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].content, "normal chat");
  });

  it("isIncognito is evaluated at save time, not at creation", async () => {
    const store = fakeStore();
    let incognito = false;
    const agent = createLocalAgent({
      threadId: "t4",
      getGroup: () => null,
      historyStore: store,
      isIncognito: () => incognito,
    });
    agent.setMessages([msg("u1", "user", "first")]);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(store.writes.length, 1);
    // Flip to incognito AFTER creation — the getter picks it up.
    incognito = true;
    agent.setMessages([msg("u1", "user", "second")]);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(store.writes.length, 1, "late toggle to incognito must still gate writes");
  });

  it("no isIncognito provided defaults to normal persistence", async () => {
    const store = fakeStore();
    const agent = createLocalAgent({ threadId: "t5", getGroup: () => null, historyStore: store });
    agent.setMessages([msg("u1", "user", "hello")]);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(store.writes.length, 1);
  });
});
