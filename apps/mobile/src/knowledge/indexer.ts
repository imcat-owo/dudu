/**
 * Knowledge base — indexing pipeline. PURE module: no React Native imports.
 *
 * indexDocument(): text -> chunks -> embeddings -> store.
 * Batching keeps proxy-friendly request sizes; a per-doc failure marks the
 * doc failed with an honest reason (never a silent half-index).
 */

import type { ApiGroup } from "../api-groups/types";
import { chunkDocument } from "./chunking";
import type { EmbedResult } from "./embeddings";
import { embedWithRealModel } from "./embeddings-local";
import type { KbChunkRecord, KnowledgeStore } from "./store";
import type { SqliteKnowledgeStore } from "./vec-store";

/** Max texts per /v1/embeddings call (proxy-friendly). */
export const EMBED_BATCH_SIZE = 32;

export interface IndexProgress {
  phase: "chunking" | "embedding";
  done: number;
  total: number;
}

export interface IndexResult {
  chunkCount: number;
  embedModel: string;
}

export interface IndexOptions {
  onProgress?: (p: IndexProgress) => void;
  /**
   * Override the embedding call (tests). Defaults to the best available
   * EmbeddingProvider (on-device when ready, else API).
   */
  embed?: (group: ApiGroup, texts: string[]) => Promise<EmbedResult>;
}

/**
 * Chunk + embed + store one document. Updates the doc status along the way:
 * indexing -> ready | failed (with reason).
 *
 * Any failure AFTER the doc is created marks it "failed" with an honest
 * reason — the doc never stays "indexing" forever (no zombie state),
 * whether the error came from chunking, embedding, or storage.
 */
export async function indexDocument(
  store: KnowledgeStore | SqliteKnowledgeStore,
  group: ApiGroup | null,
  docId: string,
  text: string,
  isMarkdown: boolean,
  opts: IndexOptions = {},
): Promise<IndexResult> {
  const doEmbed =
    opts.embed ?? ((group: ApiGroup, texts: string[]) => embedWithRealModel(() => group, texts));
  const onProgress = opts.onProgress;
  if (!group) {
    await store.updateDoc(docId, { status: "failed", error: "noApiGroup" });
    throw new Error("noApiGroup");
  }
  onProgress?.({ phase: "chunking", done: 0, total: 1 });
  const chunks = chunkDocument(docId, text, isMarkdown);
  if (chunks.length === 0) {
    await store.updateDoc(docId, { status: "failed", error: "emptyDocument" });
    throw new Error("emptyDocument");
  }

  try {
    // Embed in batches.
    const vectors: number[][] = [];
    let embedModel = "";
    for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
      const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
      onProgress?.({ phase: "embedding", done: i, total: chunks.length });
      const res = await doEmbed(
        group,
        batch.map((c) => c.text),
      );
      embedModel = res.model;
      vectors.push(...res.vectors);
    }
    onProgress?.({ phase: "embedding", done: chunks.length, total: chunks.length });

    const records: KbChunkRecord[] = chunks.map((c, i) => ({
      id: c.id,
      docId: c.docId,
      index: c.index,
      text: c.text,
      headingPath: c.headingPath,
      vector: vectors[i],
      embedModel,
    }));
    await store.putChunks(records);
    await store.updateDoc(docId, { status: "ready", chunkCount: records.length, error: undefined });
    return { chunkCount: records.length, embedModel };
  } catch (e) {
    // Embedding/storage blew up mid-pipeline (network, auth, rate limit…):
    // mark the doc failed with the real reason instead of leaving it
    // "indexing" forever, then rethrow so callers can react (task card, UI).
    const msg = e instanceof Error ? e.message : String(e);
    await store.updateDoc(docId, { status: "failed", error: msg }).catch(() => {});
    throw e;
  }
}

/**
 * Docs stuck in "indexing" whose indexing started long ago (default 10 min)
 * are leftovers from a crashed session — the app died mid-index and will
 * never finish them. Mark them failed with an honest reason so the list
 * stops spinning forever. She can delete and re-upload.
 *
 * Only touches STALE docs: anything recently created might still be
 * indexing in this session (e.g. the AI is indexing via knowledge_add_doc
 * right now), so those are left alone.
 */
export async function healInterruptedDocs(
  store: KnowledgeStore | SqliteKnowledgeStore,
  maxAgeMs = 10 * 60 * 1000,
): Promise<number> {
  const now = Date.now();
  const docs = await store.listDocs();
  let healed = 0;
  for (const doc of docs) {
    if (doc.status === "indexing" && now - doc.createdAt > maxAgeMs) {
      await store.updateDoc(doc.id, { status: "failed", error: "interrupted" }).catch(() => {});
      healed++;
    }
  }
  return healed;
}

/**
 * Re-embed an existing document's chunks with the CURRENT embedding model.
 * Used when she changed the embedding model: old vectors have the wrong
 * dimensions and search silently finds nothing. Chunk texts are preserved
 * in the records, so the original upload isn't needed.
 *
 * Marks the doc indexing -> ready | failed (honest, like indexDocument).
 */
export async function reindexDocument(
  store: KnowledgeStore | SqliteKnowledgeStore,
  group: ApiGroup | null,
  docId: string,
  opts: IndexOptions = {},
): Promise<IndexResult> {
  const doEmbed =
    opts.embed ?? ((group: ApiGroup, texts: string[]) => embedWithRealModel(() => group, texts));
  const onProgress = opts.onProgress;
  if (!group) {
    await store.updateDoc(docId, { status: "failed", error: "noApiGroup" });
    throw new Error("noApiGroup");
  }
  const existing = await store.listChunks(docId);
  if (existing.length === 0) {
    await store.updateDoc(docId, { status: "failed", error: "emptyDocument" });
    throw new Error("emptyDocument");
  }
  await store.updateDoc(docId, { status: "indexing", error: undefined });
  try {
    const vectors: number[][] = [];
    let embedModel = "";
    const sorted = [...existing].sort((a, b) => a.index - b.index);
    for (let i = 0; i < sorted.length; i += EMBED_BATCH_SIZE) {
      const batch = sorted.slice(i, i + EMBED_BATCH_SIZE);
      onProgress?.({ phase: "embedding", done: i, total: sorted.length });
      const res = await doEmbed(
        group,
        batch.map((c) => c.text),
      );
      embedModel = res.model;
      vectors.push(...res.vectors);
    }
    onProgress?.({ phase: "embedding", done: sorted.length, total: sorted.length });
    const records: KbChunkRecord[] = sorted.map((c, i) => ({
      ...c,
      vector: vectors[i],
      embedModel,
    }));
    await store.putChunks(records);
    await store.updateDoc(docId, {
      status: "ready",
      chunkCount: records.length,
      error: undefined,
    });
    return { chunkCount: records.length, embedModel };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await store.updateDoc(docId, { status: "failed", error: msg }).catch(() => {});
    throw e;
  }
}
