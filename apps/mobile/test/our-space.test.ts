import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getManual } from "../src/manuals/index.js";
import { createToolRegistry, type ToolContext } from "../src/api-groups/local-tools.js";
import {
  type OurSpaceStorage,
  OurSpaceStore,
} from "../src/our-space/store.js";
import { createOurSpaceTools } from "../src/our-space/tools.js";

function fakeStorage(): OurSpaceStorage {
  const map = new Map<string, string>();
  return {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v);
    },
  };
}

const ctx: ToolContext = { authorize: async () => true };

describe("our-space store", () => {
  it("diary: add, list newest-first, delete", async () => {
    const s = new OurSpaceStore(fakeStorage());
    assert.deepEqual(await s.listDiary(), []);
    const e1 = await s.addDiary("Morning", "Good morning text");
    await s.addDiary("Evening", "Good evening text");
    const list = await s.listDiary();
    assert.equal(list.length, 2);
    assert.equal(list[0].title, "Evening");
    assert.match(e1.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(await s.deleteDiary(e1.id), true);
    assert.equal(await s.deleteDiary("nope"), false);
    assert.equal((await s.listDiary()).length, 1);
  });

  it("diary: rejects empty title/content", async () => {
    const s = new OurSpaceStore(fakeStorage());
    await assert.rejects(() => s.addDiary("", "x"));
    await assert.rejects(() => s.addDiary("t", "   "));
  });

  it("timeline: add and list newest-first", async () => {
    const s = new OurSpaceStore(fakeStorage());
    await s.addTimeline("First", "desc", "moment");
    // Ensure distinct timestamps (same-ms ties are unordered).
    await new Promise((r) => setTimeout(r, 2));
    await s.addTimeline("Big day", "", "milestone");
    const list = await s.listTimeline();
    assert.equal(list.length, 2);
    assert.equal(list[0].kind, "milestone");
    assert.equal(list[1].kind, "moment");
  });

  it("memory garden: reads from canonical backend via gardenStateOf", async () => {
    // The garden UI reads from the canonical memory store (one truth source).
    const { MemoryStore } = await import("../src/memory/store.js");
    const { gardenStateOf } = await import("../src/memory/types.js");
    const ms = new MemoryStore(fakeStorage());
    await ms.addMemory("She likes gray", { confidence: "confident" });
    await ms.addMemory("Maybe she likes tea", { confidence: "unsure" });
    await ms.addMemory("Ask about the trip", { confidence: "question" });
    const all = await ms.listCurrent();
    assert.equal(all.length, 3);
    const states = all.map(gardenStateOf).sort();
    assert.deepEqual(states, ["ask", "blooming", "sprouting"]);
  });

  it("tell-later: queue, complete, filter", async () => {
    const s = new OurSpaceStore(fakeStorage());
    const a = await s.addTellLater("Tell her about the update");
    await s.addTellLater("Remind her to rest");
    assert.equal((await s.listTellLater()).length, 2);
    assert.equal((await s.listTellLater(false)).length, 2);
    await s.completeTellLater(a.id, true);
    assert.equal((await s.listTellLater(false)).length, 1);
    const done = await s.listTellLater(true);
    assert.equal(done.find((i) => i.id === a.id)?.done, true);
  });

  it("status: set and get", async () => {
    const s = new OurSpaceStore(fakeStorage());
    assert.equal(await s.getStatus(), null);
    const st = await s.setStatus("Building Our Space", "Phase 3 work");
    assert.equal(st.text, "Building Our Space");
    assert.equal((await s.getStatus())?.detail, "Phase 3 work");
  });

  it("subscribe: emits on mutation", async () => {
    const s = new OurSpaceStore(fakeStorage());
    let n = 0;
    const unsub = s.subscribe(() => n++);
    await s.addDiary("t", "c");
    await s.setStatus("x");
    assert.equal(n, 2);
    unsub();
    await s.addDiary("t2", "c2");
    assert.equal(n, 2);
  });

  it("corrupted storage: falls back without throwing", async () => {
    const bad: OurSpaceStorage = {
      getItem: async () => "{not json",
      setItem: async () => {},
    };
    const s = new OurSpaceStore(bad);
    assert.deepEqual(await s.listDiary(), []);
    assert.equal(await s.getStatus(), null);
  });
});

describe("our-space tools", () => {
  it("exposes 9 dialog-operated tools (memory lives in the canonical memory/ tools)", () => {
    const tools = createOurSpaceTools(new OurSpaceStore(fakeStorage()));
    assert.equal(tools.length, 9);
    const names = tools.map((t) => t.name);
    for (const n of [
      "my_status_read", "my_status_update",
      "diary_write", "diary_read",
      "timeline_add", "timeline_read",
      "tell_later_add", "tell_later_read", "tell_later_done",
    ]) {
      assert.ok(names.includes(n), `missing tool ${n}`);
    }
    // No duplicate memory tools — the canonical memory/ system owns memory_*.
    for (const n of ["memory_add", "memory_read", "memory_update"]) {
      assert.ok(!names.includes(n), `duplicate tool ${n}`);
    }
  });

  it("diary_write + diary_read round-trip via registry", async () => {
    const store = new OurSpaceStore(fakeStorage());
    const reg = createToolRegistry(createOurSpaceTools(store));
    const out = await reg.execute("diary_write", { title: "Test day", content: "It was good." }, ctx);
    assert.match(out, /saved/i);
    const read = await reg.execute("diary_read", {}, ctx);
    assert.match(read, /Test day/);
  });

  it("canonical memory tools: add/search/confirm round-trip", async () => {
    const { MemoryStore } = await import("../src/memory/store.js");
    const { createMemoryTools } = await import("../src/memory/tools.js");
    const ms = new MemoryStore(fakeStorage());
    const reg = createToolRegistry(createMemoryTools(ms));
    const out = await reg.execute("memory_add", { content: "She likes gray" }, ctx);
    assert.match(out, /remembered/i);
    const found = await reg.execute("memory_search", { query: "gray" }, ctx);
    assert.match(found, /She likes gray/);
  });

  it("unknown ids throw helpful errors", async () => {
    const store = new OurSpaceStore(fakeStorage());
    const reg = createToolRegistry(createOurSpaceTools(store));
    await assert.rejects(() => reg.execute("tell_later_done", { id: "nope" }, ctx));
    await assert.rejects(() => reg.execute("no_such_tool", {}, ctx));
  });

  it("tell_later full flow", async () => {
    const store = new OurSpaceStore(fakeStorage());
    const reg = createToolRegistry(createOurSpaceTools(store));
    await reg.execute("tell_later_add", { text: "Tell her the build passed" }, ctx);
    const before = await reg.execute("tell_later_read", {}, ctx);
    assert.match(before, /pending/);
    const item = (await store.listTellLater())[0];
    await reg.execute("tell_later_done", { id: item.id }, ctx);
    const after = await reg.execute("tell_later_read", {}, ctx);
    assert.match(after, /done/);
  });
});

describe("our-space manual", () => {
  it("is registered and points at the right file", () => {
    const m = getManual("our-space");
    assert.ok(m);
    assert.equal(m?.file, "src/manuals/our-space.ts");
    assert.match(m?.body ?? "", /she NEVER edits/i);
  });
});
