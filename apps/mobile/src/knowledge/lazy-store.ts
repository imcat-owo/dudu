/**
 * Knowledge base — lazy SQLite store for AI tools.
 *
 * createLocalAgent() builds tools synchronously, but the SQLite store
 * needs async initialization (openDatabaseAsync + migration). This
 * wrapper implements the same interface and delegates to the real
 * SQLite store on first use. Before init completes, it falls back to
 * the legacy AsyncStorage store so searches never fail.
 *
 * PURE-ish: only depends on the store interfaces.
 */

import { getKnowledgeStore, knowledgeStore } from "./instance.js";
import type { KbChunkRecord, KbDoc } from "./store.js";
import type { SqliteKnowledgeStore } from "./vec-store.js";
import { topKByCosine } from "./vectors.js";

type Store = typeof knowledgeStore | SqliteKnowledgeStore;

let sqlitePromise: Promise<SqliteKnowledgeStore> | null = null;

function getSqlite(): Promise<SqliteKnowledgeStore> {
  if (!sqlitePromise) {
    sqlitePromise = getKnowledgeStore().catch((e) => {
      // Don't cache the rejection — reset so the next call retries SQLite
      // init instead of permanently degrading to the AsyncStorage fallback
      // (which would split-brain AI writes away from the UI's SQLite reads).
      sqlitePromise = null;
      throw e;
    });
  }
  return sqlitePromise;
}

/**
 * A KnowledgeStore-compatible facade that lazily upgrades to SQLite.
 * All methods await the SQLite store if available, else use the legacy
 * AsyncStorage store. This keeps createLocalAgent() sync.
 */
export function createLazyKnowledgeStore(): {
  listDocs(): Promise<KbDoc[]>;
  getDoc(id: string): Promise<KbDoc | null>;
  addDoc(name: string, kind: KbDoc["kind"], size: number): Promise<KbDoc>;
  updateDoc(id: string, patch: Partial<KbDoc>): Promise<KbDoc | null>;
  deleteDoc(id: string): Promise<void>;
  clearAll(): Promise<void>;
  listChunks(docId?: string): Promise<KbChunkRecord[]>;
  putChunks(records: KbChunkRecord[]): Promise<void>;
  chunkCount(): Promise<number>;
  hasIndexedDocs(): Promise<boolean>;
  searchChunks(
    queryVector: readonly number[],
    k: number,
    minScore?: number,
  ): Promise<Array<{ chunk: KbChunkRecord; score: number }>>;
} {
  // Try SQLite, fall back to legacy on any failure (never break search).
  async function store(): Promise<Store> {
    try {
      return await getSqlite();
    } catch {
      return knowledgeStore;
    }
  }

  return {
    listDocs: () => store().then((s) => s.listDocs()),
    getDoc: (id) => store().then((s) => s.getDoc(id)),
    addDoc: (name, kind, size) => store().then((s) => s.addDoc(name, kind, size)),
    updateDoc: (id, patch) => store().then((s) => s.updateDoc(id, patch)),
    deleteDoc: (id) => store().then((s) => s.deleteDoc(id)),
    clearAll: () => store().then((s) => s.clearAll()),
    listChunks: (docId) => store().then((s) => s.listChunks(docId)),
    putChunks: (records) => store().then((s) => s.putChunks(records)),
    chunkCount: () => store().then((s) => s.chunkCount()),
    hasIndexedDocs: () => store().then((s) => s.hasIndexedDocs()),
    searchChunks: (queryVector, k, minScore = 0) =>
      store().then((s) => {
        if ("searchChunks" in s) {
          return (s as SqliteKnowledgeStore).searchChunks(queryVector, k, minScore);
        }
        // Legacy fallback: JS cosine (should not happen post-migration).
        return s.listChunks().then((chunks) =>
          topKByCosine(
            queryVector,
            chunks
              .filter((c) => c.vector.length > 0 && c.vector.length === queryVector.length)
              .map((c) => ({ item: c, vector: c.vector })),
            k,
            minScore,
          ).map((h) => ({ chunk: h.item, score: h.score })),
        );
      }),
  };
}

/** Singleton lazy store for AI tools. */
export const lazyKnowledgeStore = createLazyKnowledgeStore();
