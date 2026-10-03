import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolContext } from "../src/api-groups/local-tools.js";
import type { ApiGroup } from "../src/api-groups/types.js";
import { chunkDocument, chunkId, hashString } from "../src/knowledge/chunking.js";
import { indexDocument } from "../src/knowledge/indexer.js";
import { type KnowledgeStorage, KnowledgeStore } from "../src/knowledge/store.js";
import { createKnowledgeTools } from "../src/knowledge/tools.js";
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
