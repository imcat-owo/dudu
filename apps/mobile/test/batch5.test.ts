/**
 * Batch 5 tests — persona, world books, remote backup, snapshots, import, storage.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  applyPersonaRegex,
  blankPersona,
  renderPersonaTemplate,
  validatePersona,
} from "../src/persona/types";
import { createPersonaStore } from "../src/persona/store";
import {
  blankWorldBook,
  blankWorldBookEntry,
  blankWorldBookState,
  evaluateWorldBooks,
  groupWorldBookEntries,
  renderWorldBookBlock,
  worldBookMatches,
} from "../src/persona/world-book";
import { createWorldBookStore } from "../src/persona/world-book-store";
import { createGlobalMdStore, renderGlobalMdBlock } from "../src/persona/global-md";
import {
  parseCherryBackup,
  parseChatBoxBackup,
  importConversations,
} from "../src/backup/import";
import { calculateStorage, formatBytes } from "../src/backup/storage";
import { validateWebDav, validateS3 } from "../src/backup/remote";
import { parseFontCatalog, searchFonts, fontFilename } from "../src/theme/google-fonts";
import { createWebAppStore, validateWebApp } from "../src/theme/web-apps";
import { createSnapshotStore, DEFAULT_SNAPSHOT_SETTINGS } from "../src/backup/snapshot";

// --- In-memory fakes ---

function makeKV() {
  const map = new Map<string, string>();
  return {
    getItem: async (k: string) => map.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: async (k: string) => {
      map.delete(k);
    },
    getAllKeys: async () => [...map.keys()],
  };
}

function makeFiles() {
  const map = new Map<string, string>();
  return {
    writeFile: async (p: string, c: string) => {
      map.set(p, c);
    },
    readFile: async (p: string) => {
      const v = map.get(p);
      if (v === undefined) throw new Error("not-found");
      return v;
    },
    deleteFile: async (p: string) => {
      map.delete(p);
    },
    listFiles: async (dir: string) => {
      return [...map.keys()].filter((k) => k.startsWith(dir + "/")).map((k) => k.slice(dir.length + 1));
    },
  };
}

// --- Persona types ---

describe("persona types", () => {
  it("validatePersona requires a name", () => {
    assert.equal(validatePersona(blankPersona()), "name-required");
    const p = blankPersona();
    p.name = "小梦";
    assert.equal(validatePersona(p), null);
  });

  it("validatePersona checks temperature range", () => {
    const p = blankPersona();
    p.name = "x";
    p.temperature = 5;
    assert.equal(validatePersona(p), "temperature-range");
  });

  it("validatePersona checks regex validity", () => {
    const p = blankPersona();
    p.name = "x";
    p.regexRules = [
      { id: "r1", name: "bad", pattern: "([", replacement: "", global: true, caseInsensitive: false, enabled: true },
    ];
    assert.equal(validatePersona(p), "regex-invalid");
  });

  it("applyPersonaRegex applies enabled rules", () => {
    const out = applyPersonaRegex("hello world", [
      { id: "r1", name: "t", pattern: "world", replacement: "嘟嘟", global: true, caseInsensitive: false, enabled: true },
      { id: "r2", name: "off", pattern: "hello", replacement: "x", global: true, caseInsensitive: false, enabled: false },
    ]);
    assert.equal(out, "hello 嘟嘟");
  });

  it("renderPersonaTemplate substitutes variables", () => {
    const out = renderPersonaTemplate("Hi {{ user }}, I am {{ persona }}: {{ message }}", {
      message: "你好",
      user: "醒醒",
      persona: "小梦",
    });
    assert.equal(out, "Hi 醒醒, I am 小梦: 你好");
  });
});

describe("persona store", () => {
  it("upsert and list personas", async () => {
    const store = createPersonaStore(makeKV());
    const p = blankPersona();
    p.name = "小梦";
    p.tagIds = ["t1"];
    assert.equal(await store.upsert(p), null);
    const list = await store.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, "小梦");
  });

  it("tags: create, assign, remove cleans up personas", async () => {
    const kv = makeKV();
    const store = createPersonaStore(kv);
    const tag = await store.createTag("温柔", "#ff0000");
    const p = blankPersona();
    p.name = "test";
    p.tagIds = [tag.id];
    await store.upsert(p);
    assert.equal((await store.byTag(tag.id)).length, 1);
    await store.removeTag(tag.id);
    assert.equal((await store.listTags()).length, 0);
    const updated = await store.get(p.id);
    assert.deepEqual(updated?.tagIds, []);
  });

  it("active persona persists", async () => {
    const kv = makeKV();
    const store = createPersonaStore(kv);
    const p = blankPersona();
    p.name = "x";
    await store.upsert(p);
    await store.setActiveId(p.id);
    assert.equal(await store.getActiveId(), p.id);
  });
});

// --- World books ---

describe("world book matching", () => {
  it("keyword triggers (case-insensitive)", () => {
    const e = blankWorldBookEntry();
    e.keywords = ["龙"];
    assert.equal(worldBookMatches(e, "天上飞着一条龙"), true);
    assert.equal(worldBookMatches(e, "今天天气不错"), false);
  });

  it("constantActive always triggers", () => {
    const e = blankWorldBookEntry();
    e.constantActive = true;
    assert.equal(worldBookMatches(e, "anything"), true);
  });

  it("regex mode works", () => {
    const e = blankWorldBookEntry();
    e.useRegex = true;
    e.keywords = ["\\d+岁"];
    assert.equal(worldBookMatches(e, "他今年18岁"), true);
    assert.equal(worldBookMatches(e, "他今年十八岁"), false);
  });

  it("bad regex does not throw", () => {
    const e = blankWorldBookEntry();
    e.useRegex = true;
    e.keywords = ["(["];
    assert.equal(worldBookMatches(e, "test"), false);
  });
});

describe("world book evaluation", () => {
  it("activates by priority order", () => {
    const book = blankWorldBook();
    const e1 = blankWorldBookEntry();
    e1.name = "low";
    e1.priority = 1;
    e1.keywords = ["猫"];
    e1.content = "猫的内容";
    const e2 = blankWorldBookEntry();
    e2.name = "high";
    e2.priority = 10;
    e2.keywords = ["猫"];
    e2.content = "高优先级";
    book.entries = [e1, e2];
    const { entries } = evaluateWorldBooks([book], [{ role: "user", content: "我有一只猫" }]);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].name, "high");
  });

  it("respects delay", () => {
    const book = blankWorldBook();
    const e = blankWorldBookEntry();
    e.keywords = ["猫"];
    e.content = "x";
    e.delay = 5;
    book.entries = [e];
    const { entries } = evaluateWorldBooks([book], [{ role: "user", content: "猫" }]);
    assert.equal(entries.length, 0);
  });

  it("sticky keeps entry active", () => {
    const book = blankWorldBook();
    const e = blankWorldBookEntry();
    e.keywords = ["猫"];
    e.content = "x";
    e.sticky = 3;
    book.entries = [e];
    const msgs = [{ role: "user", content: "猫" }];
    const r1 = evaluateWorldBooks([book], msgs);
    assert.equal(r1.entries.length, 1);
    // Next call with different message but within sticky window.
    const r2 = evaluateWorldBooks(
      [book],
      [...msgs, { role: "user", content: "狗" }],
      r1.state,
    );
    assert.equal(r2.entries.length, 1);
  });

  it("groupWorldBookEntries splits by position", () => {
    const e1 = blankWorldBookEntry();
    e1.position = "beforeSystem";
    const e2 = blankWorldBookEntry();
    e2.position = "afterSystem";
    const g = groupWorldBookEntries([e1, e2]);
    assert.equal(g.beforeSystem.length, 1);
    assert.equal(g.afterSystem.length, 1);
  });

  it("renderWorldBookBlock joins content", () => {
    const e = blankWorldBookEntry();
    e.content = "lore1";
    const e2 = blankWorldBookEntry();
    e2.content = "lore2";
    assert.equal(renderWorldBookBlock([e, e2]), "lore1\n\nlore2");
  });
});

describe("world book store", () => {
  it("upsert, list, remove", async () => {
    const store = createWorldBookStore(makeKV());
    const b = blankWorldBook();
    b.name = "奇幻世界";
    await store.upsert(b);
    assert.equal((await store.list()).length, 1);
    assert.equal((await store.enabledBooks()).length, 1);
    await store.remove(b.id);
    assert.equal((await store.list()).length, 0);
  });
});

// --- GLOBAL.md ---

describe("global-md", () => {
  it("set/get/has roundtrip", async () => {
    const store = createGlobalMdStore(makeKV());
    assert.equal(await store.has(), false);
    await store.set("我不吃辣。");
    assert.equal(await store.has(), true);
    assert.equal(await store.get(), "我不吃辣。");
  });

  it("renderGlobalMdBlock wraps content", () => {
    const block = renderGlobalMdBlock("我不吃辣");
    assert.ok(block.includes("我不吃辣"));
    assert.equal(renderGlobalMdBlock("  "), "");
  });
});

// --- Import ---

describe("cherry import", () => {
  it("parses topics with messages", () => {
    const json = JSON.stringify({
      topics: [
        {
          id: "t1",
          name: "测试对话",
          messages: [
            { role: "user", content: "你好", createdAt: 1000 },
            { role: "assistant", content: "你好呀", createdAt: 2000 },
          ],
        },
      ],
    });
    const convs = parseCherryBackup(json);
    assert.equal(convs.length, 1);
    assert.equal(convs[0].messages.length, 2);
    assert.equal(convs[0].sourceId, "cherry:t1");
  });

  it("throws on invalid JSON", () => {
    assert.throws(() => parseCherryBackup("not json"), /import-invalid-json/);
  });
});

describe("chatbox import", () => {
  it("parses conversations", () => {
    const json = JSON.stringify({
      conversations: [
        {
          id: "c1",
          name: "hi",
          messages: [{ role: "user", content: "hello" }],
        },
      ],
    });
    const convs = parseChatBoxBackup(json);
    assert.equal(convs.length, 1);
    assert.equal(convs[0].sourceId, "chatbox:c1");
  });
});

describe("importConversations", () => {
  it("imports as new threads, skips duplicates", async () => {
    const kv = makeKV();
    const convs = [
      { sourceId: "cherry:t1", name: "t1", messages: [{ role: "user" as const, content: "hi", createdAt: 1 }] },
    ];
    const r1 = await importConversations(convs, kv);
    assert.equal(r1.conversations, 1);
    const r2 = await importConversations(convs, kv);
    assert.equal(r2.conversations, 0);
    assert.equal(r2.skipped, 1);
  });
});

// --- Storage ---

describe("storage", () => {
  it("categorizes by prefix", async () => {
    const kv = makeKV();
    await kv.setItem("dudu.local-chat.abc.v1", "{}");
    await kv.setItem("dudu.memory.v1.profile", "{}");
    const report = await calculateStorage(kv);
    const chat = report.categories.find((c) => c.id === "chat");
    const memory = report.categories.find((c) => c.id === "memory");
    assert.ok(chat && chat.keys === 1);
    assert.ok(memory && memory.keys === 1);
  });

  it("formatBytes humanizes", () => {
    assert.equal(formatBytes(500), "500 B");
    assert.equal(formatBytes(2048), "2.0 KB");
    assert.equal(formatBytes(2 * 1024 * 1024), "2.0 MB");
  });
});

// --- Remote backup validation ---

describe("remote validation", () => {
  it("validateWebDav checks URL", () => {
    assert.equal(validateWebDav(""), "url-required");
    assert.equal(validateWebDav("not-a-url"), "url-invalid");
    assert.equal(validateWebDav("ftp://x.com"), "url-scheme");
    assert.equal(validateWebDav("https://dav.example.com"), null);
  });

  it("validateS3 checks fields", () => {
    assert.equal(validateS3("", "b", "k"), "endpoint-required");
    assert.equal(validateS3("https://s3.amazonaws.com", "", "k"), "bucket-required");
    assert.equal(validateS3("https://s3.amazonaws.com", "b", ""), "access-key-required");
    assert.equal(validateS3("https://s3.amazonaws.com", "b", "k"), null);
  });
});

// --- Google Fonts ---

describe("google fonts", () => {
  it("parseFontCatalog extracts entries", () => {
    const json = {
      "Noto Sans": {
        subsets: ["latin"],
        variants: { regular: { latin: { url: "https://example.com/noto.ttf" } } },
      },
    };
    const entries = parseFontCatalog(json);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].family, "Noto Sans");
  });

  it("searchFonts filters by name", () => {
    const entries = [
      { family: "Noto Sans", url: "u1", subsets: [] },
      { family: "Roboto", url: "u2", subsets: [] },
    ];
    assert.equal(searchFonts(entries, "noto").length, 1);
    assert.equal(searchFonts(entries, "").length, 2);
  });

  it("fontFilename sanitizes", () => {
    assert.equal(fontFilename({ family: "Noto Sans SC", url: "x.ttf", subsets: [] }), "google-noto-sans-sc.ttf");
  });
});

// --- Web apps ---

describe("web apps", () => {
  it("validateWebApp checks inputs", () => {
    assert.equal(validateWebApp("", "https://x.com"), "name-required");
    assert.equal(validateWebApp("x", "not-a-url"), "url-invalid");
    assert.equal(validateWebApp("x", "ftp://y.com"), "url-scheme");
    assert.equal(validateWebApp("我的应用", "https://x.com"), null);
  });

  it("add/list/remove roundtrip", async () => {
    const store = createWebAppStore(makeKV());
    const { app, error } = await store.add("测试", "https://example.com");
    assert.equal(error, undefined);
    assert.ok(app);
    assert.equal((await store.list()).length, 1);
    await store.remove(app.id);
    assert.equal((await store.list()).length, 0);
  });
});

// --- Snapshots ---

describe("snapshots", () => {
  it("take/list/read/remove roundtrip", async () => {
    const store = createSnapshotStore(makeKV(), makeFiles());
    const info = await store.take('{"kind":"dudu-backup"}', "manual");
    assert.equal(info.reason, "manual");
    const list = await store.list();
    assert.equal(list.length, 1);
    const content = await store.read(info.id);
    assert.ok(content.includes("dudu-backup"));
    await store.remove(info.id);
    assert.equal((await store.list()).length, 0);
  });

  it("prunes beyond keepCount", async () => {
    const kv = makeKV();
    const store = createSnapshotStore(kv, makeFiles());
    await store.updateSettings({ enabled: true, keepCount: 2 });
    await store.take("{}", "manual");
    await store.take("{}", "manual");
    await store.take("{}", "manual");
    const list = await store.list();
    assert.equal(list.length, 2);
  });

  it("isDue respects frequency", async () => {
    const kv = makeKV();
    const store = createSnapshotStore(kv, makeFiles());
    assert.equal(await store.isDue(), false); // disabled by default
    await store.updateSettings({ enabled: true, frequency: "daily" });
    assert.equal(await store.isDue(), true); // never taken
    await store.take("{}", "schedule");
    assert.equal(await store.isDue(Date.now()), false); // just taken
  });

  it("never prunes pre-restore snapshots", async () => {
    const kv = makeKV();
    const store = createSnapshotStore(kv, makeFiles());
    await store.updateSettings({ enabled: true, keepCount: 1 });
    await store.take("{}", "pre-restore");
    await store.take("{}", "manual");
    await store.take("{}", "manual");
    const list = await store.list();
    // pre-restore kept + 1 manual (keepCount=1 for prunable)
    assert.ok(list.some((s) => s.reason === "pre-restore"));
  });
});

describe("snapshot defaults", () => {
  it("has sane defaults", () => {
    assert.equal(DEFAULT_SNAPSHOT_SETTINGS.enabled, false);
    assert.equal(DEFAULT_SNAPSHOT_SETTINGS.keepCount, 7);
  });
});
