/**
 * Knowledge base — store. PURE module: no React Native / expo imports.
 *
 * Two KV tables on the injectable backend (AsyncStorage in production,
 * Map-backed fake in tests) — same pattern as the memory store:
 *
 *   kb_docs   -> KV "dudu.kb.v1.docs"   (JSON: KbDoc[])
 *   kb_chunks -> KV "dudu.kb.v1.chunks" (JSON: KbChunkRecord[])
 *
 * Vectors live inside chunk records (Phase 1 scale: a few thousand chunks,
 * pure-JS cosine is <10ms). Phase 2 moves vectors to sqlite-vec; the
 * KnowledgeStore interface stays the same.
 */

import { createWriteChain } from "../util/write-chain";

export type KbDocStatus = "ready" | "indexing" | "failed";

export interface KbDoc {
  id: string;
  name: string;
  /** "txt" | "md" | "pdf" — Phase 2 adds PDF. */
  kind: "txt" | "md" | "pdf";
  size: number;
  chunkCount: number;
  status: KbDocStatus;
  /** Human-readable failure reason when status === "failed". */
  error?: string;
  createdAt: number;
}

export interface KbChunkRecord {
  id: string;
  docId: string;
  index: number;
  text: string;
  headingPath: string;
  /** Embedding vector (float array). Empty until indexed. */
  vector: number[];
  /** Embedding model that produced the vector (cache coherence). */
  embedModel: string;
}

export interface KnowledgeStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem?: (key: string) => Promise<void>;
}

const KEYS = {
  docs: "dudu.kb.v1.docs",
  chunks: "dudu.kb.v1.chunks",
} as const;

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function isDoc(v: unknown): v is KbDoc {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Record<string, unknown>;
  return (
    typeof d.id === "string" &&
    typeof d.name === "string" &&
    (d.kind === "txt" || d.kind === "md" || d.kind === "pdf") &&
    typeof d.chunkCount === "number" &&
    (d.status === "ready" || d.status === "indexing" || d.status === "failed")
  );
}

export class KnowledgeStore {
  constructor(private storage: KnowledgeStorage) {}

  /**
   * Write chain: every mutation runs inside exclusive() so concurrent
   * read-modify-write cycles can't interleave (stale-read merge losing
   * chunks, or an indexer resurrecting chunks of a just-deleted doc).
   * The chain never breaks: each link swallows its own rejection for
   * chaining purposes, while the caller still sees fn's real
   * result/rejection.
   */
  private writeChain = createWriteChain();

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    // Serialized by the shared write-chain helper (src/util/write-chain.ts).
    return this.writeChain(fn);
  }

  private listeners = new Set<() => void>();
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

  // ---------- docs ----------

  async listDocs(): Promise<KbDoc[]> {
    const raw = await this.storage.getItem(KEYS.docs);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isDoc).sort((a, b) => b.createdAt - a.createdAt);
    } catch {
      return [];
    }
  }

  async getDoc(id: string): Promise<KbDoc | null> {
    const docs = await this.listDocs();
    return docs.find((d) => d.id === id) ?? null;
  }

  async addDoc(name: string, kind: "txt" | "md" | "pdf", size: number): Promise<KbDoc> {
    return this.exclusive(async () => {
      const docs = await this.listDocs();
      const doc: KbDoc = {
        id: newId("kbdoc"),
        name,
        kind,
        size,
        chunkCount: 0,
        status: "indexing",
        createdAt: Date.now(),
      };
      docs.unshift(doc);
      await this.storage.setItem(KEYS.docs, JSON.stringify(docs));
      this.emit();
      return doc;
    });
  }

  async updateDoc(id: string, patch: Partial<KbDoc>): Promise<KbDoc | null> {
    return this.exclusive(async () => {
      const docs = await this.listDocs();
      const i = docs.findIndex((d) => d.id === id);
      if (i < 0) return null;
      docs[i] = { ...docs[i], ...patch, id: docs[i].id };
      await this.storage.setItem(KEYS.docs, JSON.stringify(docs));
      this.emit();
      return docs[i];
    });
  }

  /** Delete a doc AND all its chunks. Really deletes. */
  async deleteDoc(id: string): Promise<void> {
    return this.exclusive(async () => {
      const docs = (await this.listDocs()).filter((d) => d.id !== id);
      await this.storage.setItem(KEYS.docs, JSON.stringify(docs));
      const chunks = (await this.listChunks()).filter((c) => c.docId !== id);
      await this.storage.setItem(KEYS.chunks, JSON.stringify(chunks));
      this.emit();
    });
  }

  async clearAll(): Promise<void> {
    return this.exclusive(async () => {
      await this.storage.setItem(KEYS.docs, JSON.stringify([]));
      await this.storage.setItem(KEYS.chunks, JSON.stringify([]));
      this.emit();
    });
  }

  // ---------- chunks ----------

  async listChunks(docId?: string): Promise<KbChunkRecord[]> {
    const raw = await this.storage.getItem(KEYS.chunks);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const all = parsed as KbChunkRecord[];
      return docId ? all.filter((c) => c.docId === docId) : all;
    } catch {
      return [];
    }
  }

  async putChunks(records: KbChunkRecord[]): Promise<void> {
    return this.exclusive(async () => {
      // A doc can be deleted mid-index (user deletes while the embedding
      // pipeline is still running). Drop chunks whose doc is gone instead
      // of resurrecting them — search must never return chunks of a
      // deleted doc.
      const liveDocIds = new Set((await this.listDocs()).map((d) => d.id));
      const live = records.filter((r) => liveDocIds.has(r.docId));
      const existing = await this.listChunks();
      const ids = new Set(live.map((r) => r.id));
      const merged = [...live, ...existing.filter((c) => !ids.has(c.id))];
      await this.storage.setItem(KEYS.chunks, JSON.stringify(merged));
      this.emit();
    });
  }

  async chunkCount(): Promise<number> {
    return (await this.listChunks()).length;
  }

  async hasIndexedDocs(): Promise<boolean> {
    const docs = await this.listDocs();
    return docs.some((d) => d.status === "ready" && d.chunkCount > 0);
  }
}
