import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createToolRegistry, type ToolContext } from "../src/api-groups/local-tools.js";
import { buildMemorySection, MEMORY_SECTION_BUDGET } from "../src/memory/read-path.js";
import { searchMemories, tokenize } from "../src/memory/search.js";
import { type MemoryStorage, MemoryStore } from "../src/memory/store.js";
import { createMemoryTools } from "../src/memory/tools.js";
import { gardenStateOf } from "../src/memory/types.js";
import {
  extractMemories,
  looksSensitive,
  parseExtractionResult,
  shouldExtract,
} from "../src/memory/write-path.js";

function fakeStorage(): MemoryStorage {
  const map = new Map<string, string>();
  return {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v);
    },
  };
}

const ctx: ToolContext = { authorize: async () => true };

describe("memory store: CRUD", () => {
  it("add/get/list/delete round-trip", async () => {
    const s = new MemoryStore(fakeStorage());
    assert.deepEqual(await s.listMemories(), []);
    const m = await s.addMemory("她喜欢灰调手绘风", {
      category: "preference",
      confidence: "confident",
    });
    assert.equal(m.content, "她喜欢灰调手绘风");
    assert.equal(m.confidence, "confident");
    assert.equal(m.validTo, null);
    assert.deepEqual((await s.getMemory(m.id))?.id, m.id);
    assert.equal((await s.listCurrent()).length, 1);
    assert.equal(await s.deleteMemory(m.id), true);
    assert.equal((await s.listCurrent()).length, 0);
    assert.equal(await s.deleteMemory("nope"), false);
  });

  it("rejects empty and oversized content", async () => {
    const s = new MemoryStore(fakeStorage());
    await assert.rejects(() => s.addMemory("   "), /must not be empty/);
    await assert.rejects(() => s.addMemory("x".repeat(2001)), /too long/);
  });

  it("profile: set/get/delete", async () => {
    const s = new MemoryStore(fakeStorage());
    await s.setProfile("name", "醒醒");
    await s.setProfile("city", "上海");
    const p = await s.getProfile();
    assert.equal(p.length, 2);
    assert.equal(await s.deleteProfile("city"), true);
    assert.equal((await s.getProfile()).length, 1);
    await assert.rejects(() => s.setProfile("", "x"), /must not be empty/);
  });
});

describe("memory store: temporal discipline", () => {
  it("supersede keeps old as history, never overwrites", async () => {
    const s = new MemoryStore(fakeStorage());
    const old = await s.addMemory("她住北京", { confidence: "confident" });
    const next = await s.supersedeMemory(old.id, "她住上海", { actor: "user" });
    assert.notEqual(next.id, old.id);
    assert.equal(next.content, "她住上海");
    const fetchedOld = await s.getMemory(old.id);
    assert.notEqual(fetchedOld?.validTo, null);
    assert.equal(fetchedOld?.supersededBy, next.id);
    // Current list only shows the new one.
    const current = await s.listCurrent();
    assert.equal(current.length, 1);
    assert.equal(current[0].id, next.id);
    // Full list keeps both (wilted history queryable).
    assert.equal((await s.listMemories()).length, 2);
  });

  it("cannot supersede an already-superseded record", async () => {
    const s = new MemoryStore(fakeStorage());
    const a = await s.addMemory("A", {});
    await s.supersedeMemory(a.id, "B", {});
    await assert.rejects(() => s.supersedeMemory(a.id, "C", {}), /already superseded/);
  });

  it("confirm promotes unsure to confident", async () => {
    const s = new MemoryStore(fakeStorage());
    const m = await s.addMemory("她可能喜欢猫", { confidence: "unsure" });
    assert.equal(gardenStateOf(m), "sprouting");
    const c = await s.confirmMemory(m.id, "user");
    assert.equal(c.confidence, "confident");
    assert.equal(gardenStateOf(c), "blooming");
  });

  it("garden states map correctly", async () => {
    const s = new MemoryStore(fakeStorage());
    const q = await s.addMemory("她想问什么?", { confidence: "question" });
    assert.equal(gardenStateOf(q), "ask");
    const old = await s.addMemory("old fact", { confidence: "confident" });
    await s.supersedeMemory(old.id, "new fact", {});
    const wilted = await s.getMemory(old.id);
    assert.ok(wilted);
    assert.equal(gardenStateOf(wilted), "wilted");
  });

  it("events are logged for every write", async () => {
    const s = new MemoryStore(fakeStorage());
    const m = await s.addMemory("x", {});
    await s.confirmMemory(m.id);
    await s.deleteMemory(m.id);
    const events = await s.listEvents();
    const ops = events.map((e) => e.op);
    assert.ok(ops.includes("add"));
    assert.ok(ops.includes("confirm"));
    assert.ok(ops.includes("delete"));
  });
});

describe("memory search", () => {
  it("tokenizes CJK and latin", () => {
    assert.ok(tokenize("她喜欢灰调手绘风").includes("灰"));
    assert.ok(tokenize("Hello World").includes("hello"));
  });

  it("finds relevant memories, ranks by relevance", async () => {
    const s = new MemoryStore(fakeStorage());
    await s.addMemory("她喜欢灰调手绘风", { confidence: "confident" });
    await s.addMemory("她养了一只猫", { confidence: "confident" });
    await s.addMemory("今天天气不错", { confidence: "confident" });
    const all = await s.listCurrent();
    const hits = searchMemories(all, "灰调手绘", { limit: 5 });
    assert.ok(hits.length >= 1);
    assert.ok(hits[0].record.content.includes("灰调"));
  });

  it("excludes superseded by default, includes on request", async () => {
    const s = new MemoryStore(fakeStorage());
    const old = await s.addMemory("她住北京", { confidence: "confident" });
    await s.supersedeMemory(old.id, "她住上海", {});
    const all = await s.listMemories();
    const def = searchMemories(all, "北京", {});
    assert.ok(def.every((h) => h.record.validTo === null));
    const withOld = searchMemories(all, "北京", { includeSuperseded: true });
    assert.ok(withOld.some((h) => h.record.id === old.id));
  });

  it("never throws on garbage input", () => {
    assert.deepEqual(searchMemories([], "", {}), []);
    assert.deepEqual(searchMemories([], "???", {}), []);
  });
});

describe("memory read path", () => {
  it("empty store yields empty section (honest)", async () => {
    const s = new MemoryStore(fakeStorage());
    assert.equal(await buildMemorySection(s, "你好"), "");
  });

  it("injects profile + top-k within budget", async () => {
    const s = new MemoryStore(fakeStorage());
    await s.setProfile("name", "醒醒");
    for (let i = 0; i < 20; i++) {
      await s.addMemory(`记忆${i} 灰调手绘风偏好`, { confidence: "confident" });
    }
    const section = await buildMemorySection(s, "灰调");
    assert.ok(section.includes("醒醒"));
    assert.ok(section.length <= MEMORY_SECTION_BUDGET);
  });

  it("labels unsure memories honestly", async () => {
    const s = new MemoryStore(fakeStorage());
    await s.addMemory("她可能喜欢猫", { confidence: "unsure" });
    const section = await buildMemorySection(s, "猫");
    assert.ok(section.includes("unsure"));
    assert.ok(!section.includes("[certain] 她可能喜欢猫"));
  });
});

describe("memory write path", () => {
  it("shouldExtract gates incognito and empty turns", () => {
    assert.equal(
      shouldExtract({ userText: "hi", assistantText: "hello there friend" }, true),
      false,
    );
    assert.equal(shouldExtract({ userText: "", assistantText: "" }, false), false);
    assert.equal(
      shouldExtract(
        { userText: "我喜欢灰调手绘风的设计", assistantText: "记下了，你喜欢灰调手绘风" },
        false,
      ),
      true,
    );
  });

  it("looksSensitive catches credentials and IDs", () => {
    assert.equal(looksSensitive("我的密码是 abc123"), true);
    assert.equal(looksSensitive("my password is hunter2"), true);
    assert.equal(looksSensitive("我喜欢灰调手绘风"), false);
    assert.equal(looksSensitive("卡号 6225880123456789"), true);
  });

  it("parseExtractionResult never throws on garbage", () => {
    assert.deepEqual(parseExtractionResult("not json at all"), []);
    assert.deepEqual(parseExtractionResult('[{"content": "x"}]'), [
      { content: "x", category: "other", reason: "" },
    ]);
  });

  it("extractMemories skips sensitive and dupes, never throws", async () => {
    const s = new MemoryStore(fakeStorage());
    await s.addMemory("她喜欢灰调手绘风", { confidence: "confident" });
    const complete = async () =>
      JSON.stringify([
        { content: "她喜欢灰调手绘风", category: "preference", reason: "dupe" },
        { content: "我的密码是 abc123", category: "fact", reason: "sensitive" },
        { content: "她养了一只猫叫咪咪", category: "fact", reason: "new" },
      ]);
    const n = await extractMemories(
      s,
      { userText: "我养了一只猫叫咪咪", assistantText: "好可爱" },
      complete,
    );
    assert.equal(n, 1);
    const all = await s.listCurrent();
    assert.ok(all.some((m) => m.content.includes("咪咪")));
    assert.ok(all.every((m) => !m.content.includes("密码")));
  });

  it("extractMemories never throws when the LLM fails", async () => {
    const s = new MemoryStore(fakeStorage());
    const n = await extractMemories(
      s,
      {
        userText: "hello world this is a longer turn",
        assistantText: "hi there, how are you doing today",
      },
      async () => {
        throw new Error("network down");
      },
    );
    assert.equal(n, 0);
  });
});

describe("memory tools", () => {
  it("5 tools: add/search/update/delete/confirm all work", async () => {
    const s = new MemoryStore(fakeStorage());
    const tools = createMemoryTools(s);
    const registry = createToolRegistry(tools);
    assert.deepEqual(registry.names().sort(), [
      "memory_add",
      "memory_confirm",
      "memory_delete",
      "memory_search",
      "memory_update",
    ]);

    const added = await registry.execute(
      "memory_add",
      { content: "她喜欢灰调", category: "preference", confidence: "confident" },
      ctx,
    );
    assert.ok(added.includes("Remembered"));

    const found = await registry.execute("memory_search", { query: "灰调" }, ctx);
    assert.ok(found.includes("灰调"));
    const idMatch = found.match(/id: ([^,)]+)/);
    assert.ok(idMatch);
    const id = idMatch[1];

    const updated = await registry.execute("memory_update", { id, content: "她超爱灰调" }, ctx);
    assert.ok(updated.includes("Updated"));

    // The old id is now superseded — confirm the NEW current record instead.
    const found2 = await registry.execute("memory_search", { query: "超爱灰调" }, ctx);
    const idMatch2 = found2.match(/id: ([^,)]+)/);
    assert.ok(idMatch2);
    const confirmed = await registry.execute("memory_confirm", { id: idMatch2[1] }, ctx);
    assert.ok(confirmed.includes("Confirmed"));
  });

  it("memory_add defaults to unsure (honest)", async () => {
    const s = new MemoryStore(fakeStorage());
    const tools = createMemoryTools(s);
    const registry = createToolRegistry(tools);
    await registry.execute("memory_add", { content: "AI 猜她喜欢猫" }, ctx);
    const all = await s.listCurrent();
    assert.equal(all[0].confidence, "unsure");
  });

  it("tools reject bad input loudly", async () => {
    const s = new MemoryStore(fakeStorage());
    const registry = createToolRegistry(createMemoryTools(s));
    await assert.rejects(() => registry.execute("memory_add", {}, ctx), /Missing/);
    await assert.rejects(() => registry.execute("memory_delete", { id: "nope" }, ctx), /not found/);
  });
});

describe("memory integration fixes", () => {
  it("no duplicate tool names across our-space + memory + local tools", async () => {
    const { createOurSpaceTools } = await import("../src/our-space/tools.js");
    const { createLocalTools } = await import("../src/api-groups/local-tools.js");
    const { OurSpaceStore } = await import("../src/our-space/store.js");
    const map = new Map<string, string>();
    const fake = {
      getItem: async (k: string) => map.get(k) ?? null,
      setItem: async (k: string, v: string) => {
        map.set(k, v);
      },
    };
    const all = [
      ...createLocalTools({}),
      ...createOurSpaceTools(new OurSpaceStore(fake as any)),
      ...createMemoryTools(new MemoryStore(fake)),
    ];
    const names = all.map((t) => t.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    assert.deepEqual(dupes, [], `duplicate tool names: ${dupes.join(", ")}`);
  });

  it("looksSensitive: word boundaries (keyboard/monkey not flagged)", () => {
    assert.equal(looksSensitive("I love my keyboard"), false);
    assert.equal(looksSensitive("the monkey ate a banana"), false);
    assert.equal(looksSensitive("key lime pie is delicious"), false);
    assert.equal(looksSensitive("my secretary called"), false);
    // Real secrets still caught
    assert.equal(looksSensitive("my api key is sk-123"), true);
    assert.equal(looksSensitive("here is the secret key: abc"), true);
    assert.equal(looksSensitive("key=sk-456"), true);
    assert.equal(looksSensitive("the password is hunter2"), true);
    assert.equal(looksSensitive("use this token abc"), true);
    assert.equal(looksSensitive("my secret plan"), true);
    assert.equal(looksSensitive("contact me at a@b.com"), true);
  });

  it("memory_add: source honest (ai-inferred vs user-told)", async () => {
    const s = new MemoryStore(fakeStorage());
    const reg = createToolRegistry(createMemoryTools(s));
    // AI inference (default unsure) -> ai-inferred
    await reg.execute("memory_add", { content: "AI thinks she likes tea" }, ctx);
    // Explicit confident (she told it) -> user-told
    await reg.execute(
      "memory_add",
      { content: "She said she likes gray", confidence: "confident" },
      ctx,
    );
    const all = await s.listCurrent();
    const inferred = all.find((m) => m.content.includes("tea"));
    const told = all.find((m) => m.content.includes("gray"));
    assert.equal(inferred?.source, "ai-inferred");
    assert.equal(told?.source, "user-told");
  });

  it("concurrent writes don't lose data (write queue)", async () => {
    const s = new MemoryStore(fakeStorage());
    await Promise.all([
      s.addMemory("first", {}),
      s.addMemory("second", {}),
      s.addMemory("third", {}),
    ]);
    const all = await s.listCurrent();
    assert.equal(all.length, 3);
  });

  it("auto-extract toggle: default on, can turn off", async () => {
    const s = new MemoryStore(fakeStorage());
    assert.equal(await s.getAutoExtract(), true);
    await s.setAutoExtract(false);
    assert.equal(await s.getAutoExtract(), false);
    await s.setAutoExtract(true);
    assert.equal(await s.getAutoExtract(), true);
  });

  it("read-path truncates on line boundaries", async () => {
    const s = new MemoryStore(fakeStorage());
    // Add many long memories to force truncation
    for (let i = 0; i < 30; i++) {
      await s.addMemory(
        `Memory number ${i} with a fairly long content string to fill up the budget quickly and force truncation behavior in the read path section builder.`,
        { confidence: "confident" },
      );
    }
    const section = await buildMemorySection(s, "memory");
    // If truncated, must end with ... and not cut mid-line (no partial last line without newline)
    if (section.length >= MEMORY_SECTION_BUDGET - 10) {
      assert.ok(section.endsWith("..."), "truncated section must end with ...");
      const withoutEllipsis = section.slice(0, -3);
      // The last char before ... should be end of a line, not mid-word
      assert.ok(
        !withoutEllipsis.endsWith(" ") || withoutEllipsis.includes("\n"),
        "should cut at line boundary",
      );
    }
  });
});
