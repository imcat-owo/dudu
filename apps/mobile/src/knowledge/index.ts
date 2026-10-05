/** Knowledge base module — public surface. */

export type { ChunkOptions, TextChunk } from "./chunking";
export {
  chunkDocument,
  chunkId,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_SIZE,
  hashString,
} from "./chunking";
export type { EmbedResult } from "./embeddings";
export { DEFAULT_EMBEDDING_MODEL, EmbeddingError, embedTexts } from "./embeddings";
export type { EmbeddingProvider } from "./embeddings-local";
export {
  createApiEmbeddingProvider,
  createOnDeviceEmbeddingProvider,
  selectEmbeddingProvider,
} from "./embeddings-local";
export type { IndexProgress, IndexResult } from "./indexer";
export { EMBED_BATCH_SIZE, indexDocument } from "./indexer";
export type { KbChunkRecord, KbDoc, KbDocStatus, KnowledgeStorage } from "./store";
export { KnowledgeStore } from "./store";
export type { KnowledgeToolDeps } from "./tools";
export { createKnowledgeTools, SEARCH_MIN_SCORE } from "./tools";
export type { KbDatabase } from "./vec-store";
export { SqliteKnowledgeStore } from "./vec-store";
export type { ScoredItem } from "./vectors";
export { cosineSimilarity, topKByCosine } from "./vectors";
