/** Knowledge base module — public surface. */

export type { ChunkOptions, TextChunk } from "./chunking.js";
export {
  chunkDocument,
  chunkId,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_SIZE,
  hashString,
} from "./chunking.js";
export type { EmbedResult } from "./embeddings.js";
export { DEFAULT_EMBEDDING_MODEL, EmbeddingError, embedTexts } from "./embeddings.js";
export type { EmbeddingProvider } from "./embeddings-local.js";
export {
  createApiEmbeddingProvider,
  createOnDeviceEmbeddingProvider,
  selectEmbeddingProvider,
} from "./embeddings-local.js";
export type { IndexProgress, IndexResult } from "./indexer.js";
export { EMBED_BATCH_SIZE, indexDocument } from "./indexer.js";
export type { KbChunkRecord, KbDoc, KbDocStatus, KnowledgeStorage } from "./store.js";
export { KnowledgeStore } from "./store.js";
export type { KnowledgeToolDeps } from "./tools.js";
export { createKnowledgeTools, SEARCH_MIN_SCORE } from "./tools.js";
export type { KbDatabase } from "./vec-store.js";
export { SqliteKnowledgeStore } from "./vec-store.js";
export type { ScoredItem } from "./vectors.js";
export { cosineSimilarity, topKByCosine } from "./vectors.js";
