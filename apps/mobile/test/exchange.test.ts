import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { KeyValueStore } from "../src/backup.js";
import { type BackupToolDeps, createBackupTools } from "../src/backup-tools.js";
import { loadThreadData } from "../src/chat/thread-versions.js";
import { detectAdapter, EXCHANGE_ADAPTERS, getAdapter } from "../src/exchange/adapters.js";
import { importExchange } from "../src/exchange/import.js";
import {
  buildExchange,
  EXCHANGE_KIND,
  EXCHANGE_VERSION,
  parseExchange,
} from "../src/exchange/types.js";

function fakeKV(seed: Record<string, string> = {}): KeyValueStore {
  const map = new Map(Object.entries(seed));
  return {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v);
    },
    getAllKeys: async () => [...map.keys()],
  };
}

const CHERRY_JSON = JSON.stringify({
  topics: [
    {
      id: "t1",
      name: "cherry chat",
      messages: [
        { role: "user", content: "hello", createdAt: 1000 },
        { role: "assistant", content: "hi there", createdAt: 2000 },
        { role: "user", content: "   ", createdAt: 3000 },
      ],
    },
  ],
});

const CHATBOX_JSON = JSON.stringify({
  conversations: [
    {
      id: "c9",
      name: "chatbox chat",
      messages: [
        { role: "user", content: "yo", createdAt: 5000 },
        { role: "assistant", content: [{ type: "text", text: "sup" }], createdAt: 6000 },
      ],
    },
  ],
});

const ST_JSONL = [
  JSON.stringify({ user_name: "Her", character_name: "Nana", create_date: "2026-01-01" }),
  JSON.stringify({ name: "Nana", is_user: false, mes: "hey", send_date: "2026-01-01T10:00:00Z" }),
  JSON.stringify({
    name: "system",
    is_user: false,
    is_system: true,
    mes: "prompt",
    send_date: "2026-01-01T09:00:00Z",
  }),
  JSON.stringify({
    name: "Nana",
    is_user: false,
    mes: "first",
    swipes: ["first", "second"],
    swipe_id: 1,
    send_date: "2026-01-01T10:01:00Z",
  }),
  JSON.stringify({ name: "Her", is_user: true, mes: "hi nana", send_date: "2026-01-01T10:02:00Z" }),
].join("\n");

describe("parseExchange (dudu-exchange v1 envelope)", () => {
  it("accepts a valid envelope", () => {
    const ex = buildExchange({ app: "Test", exportedAt: 1 }, [
      { id: "x1", name: "chat", messages: [{ role: "user", content: "hi", createdAt: 1 }] },
    ]);
    const r = parseExchange(JSON.stringify(ex));
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.exchange.kind, EXCHANGE_KIND);
      assert.equal(r.exchange.version, EXCHANGE_VERSION);
    }
  });
  it("rejects empty / bad json / bad kind", () => {
    assert.equal(parseExchange("   ").ok, false);
    assert.equal((parseExchange("   ") as { code: string }).code, "empty");
    assert.equal((parseExchange("{oops") as { code: string }).code, "not-json");
    assert.equal(
      (parseExchange(JSON.stringify({ kind: "nope", version: 1 })) as { code: string }).code,
      "bad-kind",
    );
  });
  it("rejects a FUTURE version cleanly (never half-parsed)", () => {
    const ex = buildExchange({ app: "Future", exportedAt: 1 }, []);
    (ex as { version: number }).version = 99;
    const r = parseExchange(JSON.stringify(ex));
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "unsupported-version");
  });
  it("rejects invalid shape (missing conversations, bad message)", () => {
    assert.equal(
      (
        parseExchange(
          JSON.stringify({
            kind: EXCHANGE_KIND,
            version: 1,
            source: { app: "x", exportedAt: 1 },
            personas: [],
            memories: [],
          }),
        ) as { code: string }
      ).code,
      "invalid-shape",
    );
    const bad = buildExchange({ app: "x", exportedAt: 1 }, [
      { id: "x1", name: "c", messages: [{ role: "user", content: "   ", createdAt: 1 }] },
    ]);
    assert.equal((parseExchange(JSON.stringify(bad)) as { code: string }).code, "invalid-shape");
  });
  it("parses personas[] and memories[] but keeps them validated", () => {
    const ex = buildExchange(
      { app: "x", exportedAt: 1 },
      [],
      [{ id: "p1", name: "Nana", description: "sweet" }],
      [{ text: "she likes tea", createdAt: 5 }],
    );
    const r = parseExchange(JSON.stringify(ex));
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.exchange.personas.length, 1);
      assert.equal(r.exchange.memories.length, 1);
    }
  });
});

describe("detectAdapter", () => {
  it("detects cherry / chatbox / sillytavern, rejects garbage, never throws", () => {
    assert.equal(detectAdapter(CHERRY_JSON)?.id, "cherry");
    assert.equal(detectAdapter(CHATBOX_JSON)?.id, "chatbox");
    assert.equal(detectAdapter(ST_JSONL)?.id, "sillytavern");
    assert.equal(detectAdapter("hello world"), null);
    assert.equal(detectAdapter(""), null);
    assert.equal(detectAdapter("{not json"), null);
  });
  it("all adapters are registered with ids", () => {
    const ids = EXCHANGE_ADAPTERS.map((a) => a.id).sort();
    assert.deepEqual(ids, ["chatbox", "cherry", "sillytavern"]);
    assert.ok(getAdapter("cherry")?.appName.length);
  });
});

describe("sillytavern adapter", () => {
  it("parses metadata + messages, skips system, uses active swipe", () => {
    const adapter = getAdapter("sillytavern");
    assert.ok(adapter);
    const convs = adapter.parse(ST_JSONL);
    assert.equal(convs.length, 1);
    assert.equal(convs[0].name, "Nana");
    // system line skipped, active swipe "second" used instead of "first"
    assert.equal(convs[0].messages.length, 3);
    assert.equal(convs[0].messages[0].content, "hey");
    assert.equal(convs[0].messages[1].content, "second");
    assert.equal(convs[0].messages[1].role, "assistant");
    assert.equal(convs[0].messages[2].role, "user");
    assert.ok(convs[0].messages[0].createdAt < convs[0].messages[2].createdAt);
  });
  it("throws import-no-conversations when no messages survive", () => {
    const adapter = getAdapter("sillytavern");
    assert.ok(adapter);
    assert.throws(
      () => adapter.parse(JSON.stringify({ user_name: "a", character_name: "b" })),
      /import-no-conversations/,
    );
  });
});

describe("importExchange", () => {
  it("imports cherry chats as new threads", async () => {
    const kv = fakeKV();
    const out = await importExchange(CHERRY_JSON, kv);
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.adapter.id, "cherry");
      assert.equal(out.result.conversations, 1);
      assert.equal(out.result.messages, 2); // blank message dropped
      const keys = await kv.getAllKeys();
      assert.equal(keys.filter((k) => k.startsWith("dudu.local-chat.")).length, 1);
    }
  });
  it("imported thread is readable by the app's own thread reader (regression: no empty dialogs)", async () => {
    const kv = fakeKV();
    const out = await importExchange(CHERRY_JSON, kv);
    assert.equal(out.ok, true);
    const keys = await kv.getAllKeys();
    const key = keys.find((k) => k.startsWith("dudu.local-chat.import_"));
    assert.ok(key, "import wrote a thread key");
    const threadId = key.slice("dudu.local-chat.".length, -".v1".length);
    // The app's real reader (what the chat screen / local-agent uses).
    const td = await loadThreadData(threadId, kv);
    assert.equal(td.messages.length, 2, "imported messages must survive the real reader");
    for (const m of td.messages) {
      assert.equal(
        typeof m.id,
        "string",
        "every message needs an id (readers filter id-less ones out)",
      );
    }
    const contents = td.messages.map((m) => (m as { content?: unknown }).content);
    assert.deepEqual(contents, ["hello", "hi there"]);
  });
  it("importing the same file twice skips everything the second time", async () => {
    const kv = fakeKV();
    const first = await importExchange(CHATBOX_JSON, kv);
    assert.equal(first.ok, true);
    const second = await importExchange(CHATBOX_JSON, kv);
    assert.equal(second.ok, true);
    if (second.ok) {
      assert.equal(second.result.conversations, 0);
      assert.equal(second.result.skipped, 1);
    }
    const keys = await kv.getAllKeys();
    assert.equal(keys.filter((k) => k.startsWith("dudu.local-chat.")).length, 1);
  });
  it("corrupt file fails with ZERO writes", async () => {
    const kv = fakeKV({ "dudu.local-chat.keep.v1": JSON.stringify({ messages: [] }) });
    const before = await kv.getAllKeys();
    const out = await importExchange("this is not any known export", kv);
    assert.equal(out.ok, false);
    assert.equal((out as { code: string }).code, "unknown-source");
    assert.deepEqual(await kv.getAllKeys(), before);
    const out2 = await importExchange('{"topics": "broken"', kv);
    assert.equal(out2.ok, false);
    assert.deepEqual(await kv.getAllKeys(), before);
  });
  it("imports a dudu-exchange v1 file directly", async () => {
    const ex = buildExchange({ app: "SomeApp", exportedAt: 7 }, [
      {
        id: "abc",
        name: "old times",
        messages: [{ role: "assistant", content: "remember?", createdAt: 9 }],
      },
    ]);
    const kv = fakeKV();
    const out = await importExchange(JSON.stringify(ex), kv);
    assert.equal(out.ok, true);
    if (out.ok) assert.equal(out.result.conversations, 1);
  });
  it("rejects a future-version exchange file with ZERO writes", async () => {
    const ex = buildExchange({ app: "Future", exportedAt: 1 }, []);
    (ex as { version: number }).version = 5;
    const kv = fakeKV();
    const before = await kv.getAllKeys();
    const out = await importExchange(JSON.stringify(ex), kv);
    assert.equal(out.ok, false);
    assert.equal((out as { code: string }).code, "unsupported-version");
    assert.deepEqual(await kv.getAllKeys(), before);
  });
  it("forced adapter id overrides auto-detect", async () => {
    const kv = fakeKV();
    const out = await importExchange(CHATBOX_JSON, kv, "chatbox");
    assert.equal(out.ok, true);
    if (out.ok) assert.equal(out.adapter.id, "chatbox");
    const bad = await importExchange(CHERRY_JSON, kv, "nope");
    assert.equal(bad.ok, false);
    assert.equal((bad as { code: string }).code, "unknown-source");
  });
});

describe("exchange_import AI tool", () => {
  function makeDeps(): BackupToolDeps {
    const map = new Map<string, string>();
    return {
      kv: {
        getItem: async (k) => map.get(k) ?? null,
        setItem: async (k, v) => {
          map.set(k, v);
        },
        getAllKeys: async () => [...map.keys()],
      },
      secure: {
        getItem: async () => null,
        setItem: async () => {},
      },
      getKnowledgeStore: async () => null,
      saveBackupFile: async (f) => f,
      listBackupFiles: async () => [],
      readBackupFile: async () => {
        throw new Error("none");
      },
      onRestored: async () => true,
    };
  }
  const ctx = { authorize: async () => true };

  it("is registered with manualId exchange and imports from text", async () => {
    const tools = createBackupTools(makeDeps());
    const tool = tools.find((t) => t.name === "exchange_import");
    assert.ok(tool, "exchange_import registered");
    assert.equal(tool.manualId, "exchange");
    const out = await tool.run({ exchange_json: CHERRY_JSON }, ctx);
    assert.match(out, /Cherry Studio/);
    assert.match(out, /1 chats, 2 messages/);
    assert.match(out, /never|untouched/i);
  });
  it("fails cleanly on garbage without writing", async () => {
    const deps = makeDeps();
    const tools = createBackupTools(deps);
    const tool = tools.find((t) => t.name === "exchange_import");
    assert.ok(tool);
    await assert.rejects(() => tool.run({ exchange_json: "garbage" }, ctx), /Import failed/);
    assert.deepEqual(await deps.kv.getAllKeys(), []);
  });
});

describe("backup_restore mode param", () => {
  function makeDeps(seed: Record<string, string>): BackupToolDeps & { keys(): Promise<string[]> } {
    const map = new Map(Object.entries(seed));
    const kv: KeyValueStore = {
      getItem: async (k) => map.get(k) ?? null,
      setItem: async (k, v) => {
        map.set(k, v);
      },
      getAllKeys: async () => [...map.keys()],
    };
    return {
      kv,
      secure: { getItem: async () => null, setItem: async () => {} },
      getKnowledgeStore: async () => null,
      saveBackupFile: async (f) => f,
      listBackupFiles: async () => [],
      readBackupFile: async () => {
        throw new Error("none");
      },
      onRestored: async () => true,
      keys: async () => [...map.keys()],
    };
  }
  const ctx = { authorize: async () => true };

  async function makeBackupJson(): Promise<string> {
    // Build a real backup from a kv with one thread, via backup_create.
    let json = "";
    const deps = makeDeps({
      "dudu.local-chat.backed.v1": JSON.stringify({
        messages: [{ role: "user", content: "saved" }],
      }),
      "dudu.api-groups.active.v1": JSON.stringify("g1"),
    });
    const tools = createBackupTools({
      ...deps,
      saveBackupFile: async (_f: string, j: string) => {
        json = j;
        return "saved";
      },
    });
    const create = tools.find((t) => t.name === "backup_create");
    assert.ok(create);
    await create.run({}, ctx);
    assert.ok(json.length > 0);
    return json;
  }

  it("overwrite (default) removes local-only threads; merge keeps them", async () => {
    const json = await makeBackupJson();
    const restoreInto = (extra: Record<string, string>) =>
      makeDeps({
        ...extra,
        "dudu.local-chat.localonly.v1": JSON.stringify({ messages: [] }),
      });

    // overwrite
    const d1 = restoreInto({});
    const t1 = createBackupTools(d1).find((t) => t.name === "backup_restore");
    assert.ok(t1);
    const out1 = await t1.run({ backup_json: json }, ctx);
    assert.match(out1, /mode: overwrite/);
    const keys1 = await d1.keys();
    // Overwrite empties local-only threads (crash-safe: never a wiped store
    // with nothing written) instead of deleting the keys.
    assert.deepEqual(
      JSON.parse((await d1.kv.getItem("dudu.local-chat.localonly.v1")) ?? "null"),
      [],
      "overwrite empties local-only thread",
    );
    assert.ok(keys1.includes("dudu.local-chat.backed.v1"), "overwrite restores backup thread");

    // merge
    const d2 = restoreInto({});
    const t2 = createBackupTools(d2).find((t) => t.name === "backup_restore");
    assert.ok(t2);
    const out2 = await t2.run({ backup_json: json, mode: "merge" }, ctx);
    assert.match(out2, /mode: merge/);
    const keys2 = await d2.keys();
    assert.ok(keys2.includes("dudu.local-chat.localonly.v1"), "merge keeps local-only");
    assert.ok(keys2.includes("dudu.local-chat.backed.v1"), "merge adds backup thread");
  });
});
