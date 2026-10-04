/**
 * Knowledge base — indexing pipeline. PURE module: no React Native imports.
 *
 * indexDocument(): text -> chunks -> embeddings -> store.
 * Batching keeps proxy-friendly request sizes; a per-doc failure marks the
 * doc failed with an honest reason (never a silent half-index).
 */

import type { ApiGroup } from "../api-groups/types.js";
import { chunkDocument } from "./chunking.js";
import type { EmbedResult } from "./embeddings.js";
import { selectEmbeddingProvider } from "./embeddings-local.js";
import type { KbChunkRecord, KnowledgeStore } from "./store.js";
import type { SqliteKnowledgeStore } from "./vec-store.js";

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
    opts.embed ??
    (async (group: ApiGroup, texts: string[]) => {
      const provider = await selectEmbeddingProvider(() => group);
      const vectors = await provider.embed(texts);
      return { vectors, model: provider.name };
    });
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
}
