/**
 * Tests for SqliteKnowledgeStore — Phase 2 SQLite vector store.
 * Uses an in-memory fake KbDatabase (no native deps).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SqliteKnowledgeStore, type KbDatabase } from "../src/knowledge/vec-store.js";
import type { KbChunkRecord, KbDoc } from "../src/knowledge/store.js";

/** Minimal in-memory SQL fake: supports the subset we use. */
function makeFakeDb(): KbDatabase {
  const docs = new Map<string, Record<string, unknown>>();
  const chunks = new Map<string, Record<string, unknown>>();
  const norm = (sql: string) => sql.replace(/\s+/g, " ").trim().toLowerCase();

  return {
    async runAsync(sql: string, params: unknown[] = []) {
      const q = norm(sql);
      if (q.startsWith("create table") || q.startsWith("create index")) return {};
      if (q.startsWith("insert into kb_docs")) {
        const [id, name, kind, size, chunk_count, status, error, created_at] = params as unknown[];
        docs.set(id as string, { id, name, kind, size, chunk_count, status, error, created_at });
        return {};
      }
      if (q.startsWith("insert or replace into kb_chunks")) {
        const [id, doc_id, idx, text, heading_path, vector, embed_model] = params as unknown[];
        chunks.set(id as string, { id, doc_id, idx, text, heading_path, vector, embed_model });
        return {};
      }
      if (q.startsWith("update kb_docs set")) {
        const id = params[params.length - 1] as string;
        const row = docs.get(id);
        if (row) {
          // Parse SET assignments in order.
          const setPart = q.split("set ")[1].split(" where ")[0];
          const cols = setPart.split(",").map((s) => s.trim().split(" = ")[0]);
          cols.forEach((col, i) => {
            row[col] = params[i];
          });
        }
        return {};
      }
      if (q === "delete from kb_chunks where doc_id = ?") {
        const docId = params[0] as string;
        for (const [k, v] of chunks) if (v.doc_id === docId) chunks.delete(k);
        return {};
      }
      if (q === "delete from kb_docs where id = ?") {
        docs.delete(params[0] as string);
        return {};
      }
      if (q === "delete from kb_chunks" || q === "delete from kb_docs") {
        (q.includes("chunks") ? chunks : docs).clear();
        return {};
      }
      throw new Error(`unhandled SQL: ${sql}`);
    },
    async getAllAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const q = norm(sql);
      if (q.includes("from kb_docs order by")) {
        return [...docs.values()]
          .sort((a, b) => (b.created_at as number) - (a.created_at as number))
          .map((d) => ({
            id: d.id, name: d.name, kind: d.kind, size: d.size,
            chunk_count: d.chunk_count, status: d.status, error: d.error,
            created_at: d.created_at,
          })) as T[];
      }
      if (q.includes("from kb_chunks where doc_id = ?")) {
        const docId = params[0] as string;
        return [...chunks.values()]
          .filter((c) => c.doc_id === docId)
          .sort((a, b) => (a.idx as number) - (b.idx as number))
          .map(mapChunk) as T[];
      }
      if (q.includes("from kb_chunks order by")) {
        return [...chunks.values()].map(mapChunk) as T[];
      }
      if (q.includes("from kb_chunks where vector !=")) {
        return [...chunks.values()]
          .filter((c) => c.vector !== "[]")
          .map(mapChunk) as T[];
      }
      throw new Error(`unhandled SQL: ${sql}`);
    },
    async getFirstAsync<T>(sql: string, params: unknown[] = []): Promise<T | null> {
      const q = norm(sql);
      if (q.includes("from kb_docs where id = ?")) {
        const d = docs.get(params[0] as string);
        if (!d) return null;
        return {
          id: d.id, name: d.name, kind: d.kind, size: d.size,
          chunk_count: d.chunk_count, status: d.status, error: d.error,
          created_at: d.created_at,
        } as T;
      }
      if (q.includes("count(*) as n from kb_chunks")) {
        return { n: chunks.size } as T;
      }
      if (q.includes("count(*) as n from kb_docs where")) {
        const n = [...docs.values()].filter(
          (d) => d.status === "ready" && (d.chunk_count as number) > 0,
        ).length;
        return { n } as T;
      }
      throw new Error(`unhandled SQL: ${sql}`);
    },
    async withTransactionAsync(task: () => Promise<void>): Promise<void> {
      await task();
    },
  };
}

function mapChunk(c: Record<string, unknown>) {
  return {
    id: c.id, doc_id: c.doc_id, idx: c.idx, text: c.text,
    heading_path: c.heading_path, vector: c.vector, embed_model: c.embed_model,
  };
}

describe("SqliteKnowledgeStore", () => {
  it("addDoc + getDoc + listDocs round-trip", async () => {
    const s = new SqliteKnowledgeStore(makeFakeDb());
    const doc = await s.addDoc("notes.md", "md", 100);
    assert.equal(doc.name, "notes.md");
    assert.equal(doc.status, "indexing");
    const got = await s.getDoc(doc.id);
    assert.equal(got?.id, doc.id);
    const all = await s.listDocs();
    assert.equal(all.length, 1);
  });

  it("updateDoc patches status and returns updated doc", async () => {
    const s = new SqliteKnowledgeStore(makeFakeDb());
    const doc = await s.addDoc("a.txt", "txt", 10);
    const updated = await s.updateDoc(doc.id, { status: "ready", chunkCount: 3 });
    assert.equal(updated?.status, "ready");
    assert.equal(updated?.chunkCount, 3);
  });

  it("putChunks + listChunks + searchChunks finds similar", async () => {
    const s = new SqliteKnowledgeStore(makeFakeDb());
    const doc = await s.addDoc("d.md", "md", 50);
    const chunks: KbChunkRecord[] = [
      { id: "c1", docId: doc.id, index: 0, text: "cats are cute", headingPath: "", vector: [1, 0, 0], embedModel: "m" },
      { id: "c2", docId: doc.id, index: 1, text: "dogs are loyal", headingPath: "", vector: [0, 1, 0], embedModel: "m" },
    ];
    await s.putChunks(chunks);
    assert.equal(await s.chunkCount(), 2);
    const hits = await s.searchChunks([1, 0, 0], 5, 0);
    assert.equal(hits.length, 2);
    assert.equal(hits[0].chunk.id, "c1");
    assert.ok(hits[0].score > hits[1].score);
  });

  it("searchChunks respects minScore", async () => {
    const s = new SqliteKnowledgeStore(makeFakeDb());
    const doc = await s.addDoc("d.md", "md", 50);
    await s.putChunks([
      { id: "c1", docId: doc.id, index: 0, text: "x", headingPath: "", vector: [1, 0], embedModel: "m" },
    ]);
    const hits = await s.searchChunks([0, 1], 5, 0.9);
    assert.equal(hits.length, 0);
  });

  it("deleteDoc removes doc and chunks", async () => {
    const s = new SqliteKnowledgeStore(makeFakeDb());
    const doc = await s.addDoc("d.md", "md", 50);
    await s.putChunks([
      { id: "c1", docId: doc.id, index: 0, text: "x", headingPath: "", vector: [1], embedModel: "m" },
    ]);
    await s.deleteDoc(doc.id);
    assert.equal(await s.chunkCount(), 0);
    assert.equal((await s.listDocs()).length, 0);
  });

  it("supports pdf kind", async () => {
    const s = new SqliteKnowledgeStore(makeFakeDb());
    const doc: KbDoc = await s.addDoc("manual.pdf", "pdf", 1000);
    assert.equal(doc.kind, "pdf");
  });

  it("hasIndexedDocs reflects ready docs", async () => {
    const s = new SqliteKnowledgeStore(makeFakeDb());
    assert.equal(await s.hasIndexedDocs(), false);
    const doc = await s.addDoc("d.md", "md", 50);
    await s.updateDoc(doc.id, { status: "ready", chunkCount: 2 });
    assert.equal(await s.hasIndexedDocs(), true);
  });

  it("subscribe/emit notifies listeners", async () => {
    const s = new SqliteKnowledgeStore(makeFakeDb());
    let calls = 0;
    const unsub = s.subscribe(() => calls++);
    await s.addDoc("d.md", "md", 10);
    assert.equal(calls, 1);
    unsub();
    await s.addDoc("e.md", "md", 10);
    assert.equal(calls, 1);
  });
});
