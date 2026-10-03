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

  it("memory garden: confidence states and update", async () => {
    const s = new OurSpaceStore(fakeStorage());
    const m1 = await s.addMemory("She likes gray", "blooming");
    await s.addMemory("Maybe she likes tea", "sprouting");
    await s.addMemory("Ask about the trip", "ask");
    assert.equal((await s.listMemories()).length, 3);
    assert.equal((await s.listMemories("blooming")).length, 1);
    const updated = await s.updateMemory(m1.id, { confidence: "sprouting" });
    assert.equal(updated?.confidence, "sprouting");
    assert.equal(await s.updateMemory("nope", {}), null);
    assert.equal(await s.deleteMemory(m1.id), true);
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
  it("exposes 12 dialog-operated tools", () => {
    const tools = createOurSpaceTools(new OurSpaceStore(fakeStorage()));
    assert.equal(tools.length, 12);
    const names = tools.map((t) => t.name);
    for (const n of [
      "my_status_read", "my_status_update",
      "diary_write", "diary_read",
      "timeline_add", "timeline_read",
      "memory_add", "memory_read", "memory_update",
      "tell_later_add", "tell_later_read", "tell_later_done",
    ]) {
      assert.ok(names.includes(n), `missing tool ${n}`);
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

  it("memory_add defaults to sprouting, update to blooming", async () => {
    const store = new OurSpaceStore(fakeStorage());
    const reg = createToolRegistry(createOurSpaceTools(store));
    await reg.execute("memory_add", { text: "unsure thing" }, ctx);
    const list = await store.listMemories();
    assert.equal(list[0].confidence, "sprouting");
    const upd = await reg.execute("memory_update", { id: list[0].id, confidence: "blooming" }, ctx);
    assert.match(upd, /blooming/);
  });

  it("unknown ids throw helpful errors", async () => {
    const store = new OurSpaceStore(fakeStorage());
    const reg = createToolRegistry(createOurSpaceTools(store));
    await assert.rejects(() => reg.execute("memory_update", { id: "nope" }, ctx));
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
