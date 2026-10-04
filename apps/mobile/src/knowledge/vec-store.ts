/**
 * Knowledge base — SQLite vector store (Phase 2).
 *
 * Moves chunk storage from AsyncStorage JSON blobs to expo-sqlite.
 * Vectors are stored as JSON in a TEXT column; search uses the same
 * pure-JS cosine similarity as Phase 1 (research: <10ms for 6k vectors
 * on device — not the bottleneck at our scale).
 *
 * The interface matches KnowledgeStore so the swap is painless.
 * When sqlite-vec becomes available in expo-sqlite, only the
 * searchChunks() implementation needs to change (SQL KNN instead of
 * JS cosine) — the rest stays the same.
 *
 * PURE-ish: expo-sqlite import is isolated here; the store takes an
 * injected database for tests.
 */

import type { KbChunkRecord, KbDoc } from "./store.js";
import { cosineSimilarity } from "./vectors.js";

const SCHEMA_VERSION = 2;

const CREATE_DOCS = `
CREATE TABLE IF NOT EXISTS kb_docs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  size INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  error TEXT,
  created_at INTEGER NOT NULL
);`;

const CREATE_CHUNKS = `
CREATE TABLE IF NOT EXISTS kb_chunks (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  text TEXT NOT NULL,
  heading_path TEXT NOT NULL DEFAULT '',
  vector TEXT NOT NULL DEFAULT '[]',
  embed_model TEXT NOT NULL DEFAULT ''
);`;

const CREATE_CHUNKS_DOC_IDX = `
CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc ON kb_chunks(doc_id);`;

/** Minimal expo-sqlite database interface (injected for tests). */
export interface KbDatabase {
  runAsync(sql: string, params?: unknown[]): Promise<unknown>;
  getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null>;
  /** Run a task inside a single transaction (rollback on throw). */
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

interface DocRow {
  id: string;
  name: string;
  kind: string;
  size: number;
  chunk_count: number;
  status: string;
  error: string | null;
  created_at: number;
}

interface ChunkRow {
  id: string;
  doc_id: string;
  idx: number;
  text: string;
  heading_path: string;
  vector: string;
  embed_model: string;
}

function rowToDoc(r: DocRow): KbDoc {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as KbDoc["kind"],
    size: r.size,
    chunkCount: r.chunk_count,
    status: r.status as KbDoc["status"],
    error: r.error ?? undefined,
    createdAt: r.created_at,
  };
}

function rowToChunk(r: ChunkRow): KbChunkRecord {
  let vector: number[] = [];
  try {
    const parsed: unknown = JSON.parse(r.vector);
    if (Array.isArray(parsed)) vector = parsed.filter((v) => typeof v === "number");
  } catch {
    // corrupt vector → empty (chunk is unsearchable but not fatal)
  }
  return {
    id: r.id,
    docId: r.doc_id,
    index: r.idx,
    text: r.text,
    headingPath: r.heading_path,
    vector,
    embedModel: r.embed_model,
  };
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export class SqliteKnowledgeStore {
  private ready: Promise<void>;
  private listeners = new Set<() => void>();

  constructor(private db: KbDatabase) {
    this.ready = this.migrate();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch {
        // listener errors must never break the store
      }
    }
  }

  private async migrate(): Promise<void> {
    await this.db.runAsync(CREATE_DOCS);
    await this.db.runAsync(CREATE_CHUNKS);
    await this.db.runAsync(CREATE_CHUNKS_DOC_IDX);
    // Future: check PRAGMA user_version for schema upgrades.
    void SCHEMA_VERSION;
  }

  private async ensureReady(): Promise<void> {
    await this.ready;
  }

  // ---------- docs ----------

  async listDocs(): Promise<KbDoc[]> {
    await this.ensureReady();
    const rows = await this.db.getAllAsync<DocRow>(
      "SELECT * FROM kb_docs ORDER BY created_at DESC",
    );
    return rows.map(rowToDoc);
  }

  async getDoc(id: string): Promise<KbDoc | null> {
    await this.ensureReady();
    const row = await this.db.getFirstAsync<DocRow>("SELECT * FROM kb_docs WHERE id = ?", [id]);
    return row ? rowToDoc(row) : null;
  }

  async addDoc(name: string, kind: KbDoc["kind"], size: number): Promise<KbDoc> {
    await this.ensureReady();
    const doc: KbDoc = {
      id: newId("kbdoc"),
      name,
      kind,
      size,
      chunkCount: 0,
      status: "indexing",
      createdAt: Date.now(),
    };
    await this.db.runAsync(
      "INSERT INTO kb_docs (id, name, kind, size, chunk_count, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        doc.id,
        doc.name,
        doc.kind,
        doc.size,
        doc.chunkCount,
        doc.status,
        doc.error ?? null,
        doc.createdAt,
      ],
    );
    this.emit();
    return doc;
  }

  async updateDoc(id: string, patch: Partial<KbDoc>): Promise<KbDoc | null> {
    await this.ensureReady();
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.name !== undefined) {
      sets.push("name = ?");
      params.push(patch.name);
    }
    if (patch.kind !== undefined) {
      sets.push("kind = ?");
      params.push(patch.kind);
    }
    if (patch.size !== undefined) {
      sets.push("size = ?");
      params.push(patch.size);
    }
    if (patch.chunkCount !== undefined) {
      sets.push("chunk_count = ?");
      params.push(patch.chunkCount);
    }
    if (patch.status !== undefined) {
      sets.push("status = ?");
      params.push(patch.status);
    }
    if (patch.error !== undefined) {
      sets.push("error = ?");
      params.push(patch.error ?? null);
    }
    if (sets.length === 0) return this.getDoc(id);
    params.push(id);
    await this.db.runAsync(`UPDATE kb_docs SET ${sets.join(", ")} WHERE id = ?`, params);
    this.emit();
    return this.getDoc(id);
  }

  async deleteDoc(id: string): Promise<void> {
    await this.ensureReady();
    await this.db.runAsync("DELETE FROM kb_chunks WHERE doc_id = ?", [id]);
    await this.db.runAsync("DELETE FROM kb_docs WHERE id = ?", [id]);
    this.emit();
  }

  async clearAll(): Promise<void> {
    await this.ensureReady();
    await this.db.runAsync("DELETE FROM kb_chunks");
    await this.db.runAsync("DELETE FROM kb_docs");
    this.emit();
  }

  // ---------- chunks ----------

  async putChunks(records: KbChunkRecord[]): Promise<void> {
    await this.ensureReady();
    // One transaction: a killed batch never leaves half a document behind.
    await this.db.withTransactionAsync(async () => {
      for (const r of records) {
        await this.db.runAsync(
          `INSERT OR REPLACE INTO kb_chunks
           (id, doc_id, idx, text, heading_path, vector, embed_model)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [r.id, r.docId, r.index, r.text, r.headingPath, JSON.stringify(r.vector), r.embedModel],
        );
      }
    });
    this.emit();
  }

  async listChunks(docId?: string): Promise<KbChunkRecord[]> {
    await this.ensureReady();
    const rows = docId
      ? await this.db.getAllAsync<ChunkRow>(
          "SELECT * FROM kb_chunks WHERE doc_id = ? ORDER BY idx",
          [docId],
        )
      : await this.db.getAllAsync<ChunkRow>("SELECT * FROM kb_chunks ORDER BY doc_id, idx");
    return rows.map(rowToChunk);
  }

  async chunkCount(): Promise<number> {
    await this.ensureReady();
    const row = await this.db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM kb_chunks");
    return row?.n ?? 0;
  }

  /**
   * Vector search: top-k chunks by cosine similarity.
   * Phase 2 uses JS cosine (fast enough at our scale); swap to sqlite-vec
   * KNN here when the extension becomes available — callers don't change.
   */
  async searchChunks(
    queryVector: readonly number[],
    k: number,
    minScore = 0,
  ): Promise<Array<{ chunk: KbChunkRecord; score: number }>> {
    await this.ensureReady();
    const rows = await this.db.getAllAsync<ChunkRow>(
      "SELECT * FROM kb_chunks WHERE vector != '[]'",
    );
    const scored: Array<{ chunk: KbChunkRecord; score: number }> = [];
    for (const row of rows) {
      const chunk = rowToChunk(row);
      if (chunk.vector.length === 0 || chunk.vector.length !== queryVector.length) continue;
      const score = cosineSimilarity(queryVector, chunk.vector);
      if (score >= minScore) scored.push({ chunk, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.max(0, k));
  }

  async hasIndexedDocs(): Promise<boolean> {
    await this.ensureReady();
    const row = await this.db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM kb_docs WHERE status = 'ready' AND chunk_count > 0",
    );
    return (row?.n ?? 0) > 0;
  }
}
