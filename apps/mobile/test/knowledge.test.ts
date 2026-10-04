import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolContext } from "../src/api-groups/local-tools.js";
import type { ApiGroup } from "../src/api-groups/types.js";
import { chunkDocument, chunkId, hashString } from "../src/knowledge/chunking.js";
import { healInterruptedDocs, indexDocument, reindexDocument } from "../src/knowledge/indexer.js";
import { type KnowledgeStorage, KnowledgeStore } from "../src/knowledge/store.js";
import {
  createKnowledgeAddTools,
  createKnowledgeTools,
  registerPdfExtractHandler,
} from "../src/knowledge/tools.js";
import { cosineSimilarity, topKByCosine } from "../src/knowledge/vectors.js";

function fakeStorage(): KnowledgeStorage {
  const map = new Map<string, string>();
  return {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v);
    },
  };
}

const ctx: ToolContext = { authorize: async () => true };

const fakeGroup = {
  id: "g1",
  name: "test",
  vendor: "openai",
  baseUrl: "https://api.example.com/v1",
  apiKey: "sk-test",
  model: "gpt-test",
  headers: {},
  createdAt: 0,
} as ApiGroup;

/**
 * Toy embedder for tests: 3-dim vector counting keyword hits.
 * Deterministic, no network.
 */
function toyEmbed(_group: ApiGroup, texts: string[]) {
  const vec = (t: string): number[] => {
    const s = t.toLowerCase();
    const has = (w: string) => (s.includes(w) ? 1 : 0);
    return [has("cat"), has("dog"), has("paris")];
  };
  return Promise.resolve({ vectors: texts.map(vec), model: "toy" });
}

describe("knowledge chunking", () => {
  it("splits markdown on headers and keeps the path", () => {
    const md = `# Animals\n\nCats are cute.\n\n## Dogs\n\nDogs are loyal.`;
    const chunks = chunkDocument("d1", md, true);
    assert.ok(chunks.length >= 2);
    const dogChunk = chunks.find((c) => c.text.includes("loyal"));
    assert.ok(dogChunk);
    assert.equal(dogChunk.headingPath, "Animals > Dogs");
    assert.ok(dogChunk.text.startsWith(""));
  });

  it("chunk ids are deterministic", () => {
    assert.equal(chunkId("d1", 3), chunkId("d1", 3));
    assert.notEqual(chunkId("d1", 3), chunkId("d1", 4));
    assert.notEqual(chunkId("d1", 3), chunkId("d2", 3));
  });

  it("hashString is stable", () => {
    assert.equal(hashString("hello"), hashString("hello"));
    assert.notEqual(hashString("hello"), hashString("world"));
  });

  it("long plain text gets windowed with overlap", () => {
    const text = "word ".repeat(500); // 2500 chars
    const chunks = chunkDocument("d1", text, false, { chunkSize: 800, chunkOverlap: 100 });
    assert.ok(chunks.length >= 3);
    for (const c of chunks) assert.ok(c.text.length <= 800);
  });

  it("empty text yields no chunks", () => {
    assert.deepEqual(chunkDocument("d1", " \n ", false), []);
  });
});

describe("knowledge vectors", () => {
  it("cosine similarity basics", () => {
    assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
    assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
    assert.ok(Math.abs(cosineSimilarity([1, 1], [-1, -1]) - -1) < 1e-9);
    assert.equal(cosineSimilarity([], []), 0);
    assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
    assert.equal(cosineSimilarity([1], [1, 2]), 0); // length mismatch
  });

  it("topK orders by similarity and respects threshold", () => {
    const cands = [
      { item: "a", vector: [1, 0] },
      { item: "b", vector: [0.9, 0.1] },
      { item: "c", vector: [0, 1] },
    ];
    const top = topKByCosine([1, 0], cands, 2);
    assert.deepEqual(
      top.map((t) => t.item),
      ["a", "b"],
    );
    const strict = topKByCosine([1, 0], cands, 10, 0.999);
    assert.deepEqual(
      strict.map((t) => t.item),
      ["a"],
    );
  });
});

describe("knowledge store", () => {
  it("doc CRUD + chunk round-trip", async () => {
    const s = new KnowledgeStore(fakeStorage());
    assert.deepEqual(await s.listDocs(), []);
    const doc = await s.addDoc("notes.md", "md", 100);
    assert.equal(doc.status, "indexing");
    assert.equal((await s.listDocs()).length, 1);
    await s.updateDoc(doc.id, { status: "ready", chunkCount: 2 });
    assert.equal((await s.getDoc(doc.id))?.status, "ready");
    await s.putChunks([
      {
        id: "c1",
        docId: doc.id,
        index: 0,
        text: "hello",
        headingPath: "",
        vector: [1],
        embedModel: "toy",
      },
    ]);
    assert.equal(await s.chunkCount(), 1);
    assert.equal((await s.listChunks(doc.id)).length, 1);
    assert.ok(await s.hasIndexedDocs());
    await s.deleteDoc(doc.id);
    assert.deepEqual(await s.listDocs(), []);
    assert.equal(await s.chunkCount(), 0);
    assert.ok(!(await s.hasIndexedDocs()));
  });
});

describe("knowledge indexer", () => {
  it("full pipeline: chunk -> embed -> store -> ready", async () => {
    const s = new KnowledgeStore(fakeStorage());
    const doc = await s.addDoc("pets.md", "md", 50);
    const seen: string[] = [];
    const res = await indexDocument(s, fakeGroup, doc.id, "# Pets\n\nI love my cat.", true, {
      embed: toyEmbed,
      onProgress: (p) => seen.push(p.phase),
    });
    assert.ok(res.chunkCount >= 1);
    assert.equal(res.embedModel, "toy");
    assert.deepEqual(seen, ["chunking", "embedding", "embedding"]);
    const updated = await s.getDoc(doc.id);
    assert.equal(updated?.status, "ready");
    assert.equal(updated?.chunkCount, res.chunkCount);
    const chunks = await s.listChunks(doc.id);
    assert.ok(chunks.every((c) => c.vector.length === 3));
  });

  it("no group -> failed with noApiGroup", async () => {
    const s = new KnowledgeStore(fakeStorage());
    const doc = await s.addDoc("x.md", "md", 10);
    await assert.rejects(
      () => indexDocument(s, null, doc.id, "text", false, { embed: toyEmbed }),
      /noApiGroup/,
    );
    assert.equal((await s.getDoc(doc.id))?.status, "failed");
  });

  it("empty document -> failed", async () => {
    const s = new KnowledgeStore(fakeStorage());
    const doc = await s.addDoc("empty.md", "md", 0);
    await assert.rejects(
      () => indexDocument(s, fakeGroup, doc.id, " ", false, { embed: toyEmbed }),
      /emptyDocument/,
    );
  });
});

describe("knowledge_search tool", () => {
  async function seededStore(): Promise<KnowledgeStore> {
    const s = new KnowledgeStore(fakeStorage());
    const doc = await s.addDoc("pets.md", "md", 50);
    await indexDocument(
      s,
      fakeGroup,
      doc.id,
      "# Pets\n\nMy cat naps all day.\n\n## Dogs\n\nDogs bark at night.",
      true,
      {
        embed: toyEmbed,
      },
    );
    const doc2 = await s.addDoc("travel.md", "md", 50);
    await indexDocument(s, fakeGroup, doc2.id, "# Travel\n\nParis is lovely in spring.", true, {
      embed: toyEmbed,
    });
    return s;
  }

  it("finds the relevant doc and cites it", async () => {
    const s = await seededStore();
    const [tool] = createKnowledgeTools(s, { getGroup: () => fakeGroup, embed: toyEmbed });
    const out = await tool.run({ query: "tell me about my cat" }, ctx);
    assert.ok(out.includes("pets.md"), `expected pets.md citation, got: ${out}`);
    assert.ok(out.includes("cat"));
  });

  it("returns empty-honest when nothing matches", async () => {
    const s = await seededStore();
    const [tool] = createKnowledgeTools(s, { getGroup: () => fakeGroup, embed: toyEmbed });
    // "zebra" hits no keyword dimension -> zero vector -> below threshold
    const out = await tool.run({ query: "zebra quantum mechanics" }, ctx);
    assert.ok(out.includes("No relevant passages"));
  });

  it("honest when KB is empty", async () => {
    const s = new KnowledgeStore(fakeStorage());
    const [tool] = createKnowledgeTools(s, { getGroup: () => fakeGroup, embed: toyEmbed });
    const out = await tool.run({ query: "anything" }, ctx);
    assert.ok(out.includes("empty"));
  });

  it("honest when no API group", async () => {
    const s = await seededStore();
    const [tool] = createKnowledgeTools(s, { getGroup: () => null, embed: toyEmbed });
    await assert.rejects(() => tool.run({ query: "cat" }, ctx), /No API group/);
  });

  it("requires query", async () => {
    const s = await seededStore();
    const [tool] = createKnowledgeTools(s, { getGroup: () => fakeGroup, embed: toyEmbed });
    await assert.rejects(() => tool.run({}, ctx), /query/);
  });

  it("tool is registered with the knowledge manual", async () => {
    const s = new KnowledgeStore(fakeStorage());
    const [tool] = createKnowledgeTools(s, { getGroup: () => fakeGroup });
    assert.equal(tool.name, "knowledge_search");
    assert.equal(tool.manualId, "knowledge");
    assert.ok(!("capability" in tool) || tool.capability === undefined);
  });
});

describe("indexer failure honesty (P1-18)", () => {
  it("embedding error marks doc failed, not zombie indexing", async () => {
    const s = new KnowledgeStore(fakeStorage());
    const doc = await s.addDoc("boom.md", "md", 50);
    const badEmbed = () => Promise.reject(new Error("embeddingAuth: nope"));
    await assert.rejects(
      () =>
        indexDocument(s, fakeGroup, doc.id, "# Boom\n\nSome text here.", true, { embed: badEmbed }),
      /embeddingAuth/,
    );
    const updated = await s.getDoc(doc.id);
    assert.equal(updated?.status, "failed");
    assert.ok(updated?.error?.includes("embeddingAuth"));
  });

  it("healInterruptedDocs heals stale indexing docs, leaves fresh ones", async () => {
    const s = new KnowledgeStore(fakeStorage());
    const stale = await s.addDoc("old.md", "md", 10);
    // Simulate a crash from long ago by backdating createdAt.
    const docs = await s.listDocs();
    const raw = docs.map((d) =>
      d.id === stale.id ? { ...d, createdAt: Date.now() - 60 * 60 * 1000 } : d,
    );
    const storage = (s as unknown as { storage: KnowledgeStorage }).storage;
    await storage.setItem("dudu.kb.v1.docs", JSON.stringify(raw));
    const fresh = await s.addDoc("new.md", "md", 10);

    const healed = await healInterruptedDocs(s);
    assert.equal(healed, 1);
    assert.equal((await s.getDoc(stale.id))?.status, "failed");
    assert.equal((await s.getDoc(stale.id))?.error, "interrupted");
    assert.equal((await s.getDoc(fresh.id))?.status, "indexing");
  });

  it("reindexDocument re-embeds with the current model", async () => {
    const s = new KnowledgeStore(fakeStorage());
    const doc = await s.addDoc("pets.md", "md", 50);
    await indexDocument(s, fakeGroup, doc.id, "# Pets\n\nI love my cat.", true, {
      embed: toyEmbed,
    });
    const before = await s.listChunks(doc.id);
    assert.ok(before.every((c) => c.embedModel === "toy"));

    const newEmbed = (_g: ApiGroup, texts: string[]) =>
      Promise.resolve({ vectors: texts.map(() => [0.1, 0.2, 0.3, 0.4]), model: "toy-v2" });
    const res = await reindexDocument(s, fakeGroup, doc.id, { embed: newEmbed });
    assert.equal(res.embedModel, "toy-v2");
    const after = await s.listChunks(doc.id);
    assert.equal(after.length, before.length);
    assert.ok(after.every((c) => c.vector.length === 4 && c.embedModel === "toy-v2"));
    assert.equal((await s.getDoc(doc.id))?.status, "ready");
  });

  it("reindexDocument fails honestly on empty doc", async () => {
    const s = new KnowledgeStore(fakeStorage());
    const doc = await s.addDoc("empty.md", "md", 10);
    await assert.rejects(
      () => reindexDocument(s, fakeGroup, doc.id, { embed: toyEmbed }),
      /emptyDocument/,
    );
    assert.equal((await s.getDoc(doc.id))?.status, "failed");
  });
});

describe("knowledge_search model-change honesty (P1-19)", () => {
  it("says plainly when docs were indexed with another model", async () => {
    const s = new KnowledgeStore(fakeStorage());
    const doc = await s.addDoc("pets.md", "md", 50);
    await indexDocument(s, fakeGroup, doc.id, "# Pets\n\nMy cat naps.", true, { embed: toyEmbed });
    // New model with different dimensions.
    const v2Embed = (_g: ApiGroup, texts: string[]) =>
      Promise.resolve({ vectors: texts.map(() => [1, 2, 3, 4, 5]), model: "bigger-model" });
    const [tool] = createKnowledgeTools(s, { getGroup: () => fakeGroup, embed: v2Embed });
    const out = await tool.run({ query: "cat" }, ctx);
    assert.ok(out.includes("were indexed with"), `got: ${out}`);
    assert.ok(out.includes("incompatible"), `got: ${out}`);
    assert.ok(out.includes("knowledge_reindex"), `got: ${out}`);
    assert.ok(!out.includes("No relevant passages"), `must not pretend empty, got: ${out}`);
  });

  it("search still works when models match", async () => {
    const s = new KnowledgeStore(fakeStorage());
    const doc = await s.addDoc("pets.md", "md", 50);
    await indexDocument(s, fakeGroup, doc.id, "# Pets\n\nMy cat naps.", true, { embed: toyEmbed });
    const [tool] = createKnowledgeTools(s, { getGroup: () => fakeGroup, embed: toyEmbed });
    const out = await tool.run({ query: "cat" }, ctx);
    assert.ok(out.includes("pets.md"));
  });
});

describe("knowledge_reindex tool", () => {
  it("re-indexes a doc by name", async () => {
    const s = new KnowledgeStore(fakeStorage());
    const doc = await s.addDoc("pets.md", "md", 50);
    await indexDocument(s, fakeGroup, doc.id, "# Pets\n\nMy cat naps.", true, { embed: toyEmbed });
    const newEmbed = (_g: ApiGroup, texts: string[]) =>
      Promise.resolve({ vectors: texts.map(() => [9, 9, 9]), model: "toy-v2" });
    const tools = createKnowledgeAddTools(s, { getGroup: () => fakeGroup, embed: newEmbed });
    const reindex = tools.find((t) => t.name === "knowledge_reindex");
    assert.ok(reindex);
    const out = await reindex.run({ name: "pets.md" }, ctx);
    assert.ok(out.includes("re-indexed"), `got: ${out}`);
    assert.ok(out.includes("toy-v2"), `got: ${out}`);
    const chunks = await s.listChunks(doc.id);
    assert.ok(chunks.every((c) => c.embedModel === "toy-v2"));
  });

  it("errors honestly on unknown doc", async () => {
    const s = new KnowledgeStore(fakeStorage());
    const tools = createKnowledgeAddTools(s, { getGroup: () => fakeGroup, embed: toyEmbed });
    const reindex = tools.find((t) => t.name === "knowledge_reindex");
    assert.ok(reindex);
    await assert.rejects(() => reindex.run({ name: "nope.md" }, ctx), /No document named/);
  });
});

describe("knowledge_add_file", () => {
  function addTools(s: KnowledgeStore, readTextFile?: (uri: string) => Promise<string>) {
    return createKnowledgeAddTools(s, {
      getGroup: () => fakeGroup,
      embed: toyEmbed,
      ...(readTextFile ? { readTextFile } : {}),
    });
  }

  it("indexes a txt file from uri", async () => {
    const s = new KnowledgeStore(fakeStorage());
    const tools = addTools(s, async (uri) => {
      assert.equal(uri, "file:///docs/recipe.txt");
      return "宫保鸡丁要放两勺糖。";
    });
    const tool = tools.find((t) => t.name === "knowledge_add_file");
    assert.ok(tool);
    const out = await tool.run({ uri: "file:///docs/recipe.txt" }, ctx);
    assert.ok(out.includes("indexed"), `got: ${out}`);
    assert.ok(out.includes("recipe.txt"), `got: ${out}`);
    const docs = await s.listDocs();
    assert.equal(docs.length, 1);
    assert.equal(docs[0].name, "recipe.txt");
  });

  it("uses explicit name when given", async () => {
    const s = new KnowledgeStore(fakeStorage());
    const tools = addTools(s, async () => "some text content here");
    const tool = tools.find((t) => t.name === "knowledge_add_file");
    assert.ok(tool);
    const out = await tool.run({ uri: "file:///x.md", name: "我的笔记" }, ctx);
    assert.ok(out.includes("我的笔记"), `got: ${out}`);
  });

  it("rejects unsupported file types honestly", async () => {
    const s = new KnowledgeStore(fakeStorage());
    const tools = addTools(s, async () => "x");
    const tool = tools.find((t) => t.name === "knowledge_add_file");
    assert.ok(tool);
    await assert.rejects(
      () => tool.run({ uri: "file:///photo.jpg", name: "photo.jpg" }, ctx),
      /only index .txt, .md, and .pdf/,
    );
  });

  it("requires uri", async () => {
    const s = new KnowledgeStore(fakeStorage());
    const tools = addTools(s, async () => "x");
    const tool = tools.find((t) => t.name === "knowledge_add_file");
    assert.ok(tool);
    await assert.rejects(() => tool.run({}, ctx), /uri is required/);
  });

  it("errors honestly when readTextFile is not wired", async () => {
    const s = new KnowledgeStore(fakeStorage());
    const tools = addTools(s); // no readTextFile
    const tool = tools.find((t) => t.name === "knowledge_add_file");
    assert.ok(tool);
    await assert.rejects(() => tool.run({ uri: "file:///a.txt" }, ctx), /isn't wired up/);
  });

  it("errors honestly on empty file", async () => {
    const s = new KnowledgeStore(fakeStorage());
    const tools = addTools(s, async () => "   ");
    const tool = tools.find((t) => t.name === "knowledge_add_file");
    assert.ok(tool);
    await assert.rejects(() => tool.run({ uri: "file:///empty.txt" }, ctx), /looks empty/);
  });

  it("pdf without handler fails honestly", async () => {
    // Note: this test must run before any test that registers a handler,
    // since the handler is module-level state.
    const s = new KnowledgeStore(fakeStorage());
    const tools = addTools(s, async () => "x");
    const tool = tools.find((t) => t.name === "knowledge_add_file");
    assert.ok(tool);
    await assert.rejects(
      () => tool.run({ uri: "file:///doc.pdf" }, ctx),
      /PDF extraction isn't available/,
    );
  });

  it("indexes a pdf via registered handler", async () => {
    const s = new KnowledgeStore(fakeStorage());
    registerPdfExtractHandler(async (uri) => {
      assert.equal(uri, "file:///doc.pdf");
      return "PDF extracted text about cats.";
    });
    const tools = addTools(s, async () => "x");
    const tool = tools.find((t) => t.name === "knowledge_add_file");
    assert.ok(tool);
    const out = await tool.run({ uri: "file:///doc.pdf" }, ctx);
    assert.ok(out.includes("indexed"), `got: ${out}`);
    const docs = await s.listDocs();
    assert.equal(docs[0].kind, "pdf");
  });
});
