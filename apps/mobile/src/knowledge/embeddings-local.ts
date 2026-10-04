/**
 * Knowledge base — on-device embeddings (Phase 2 interface, Phase 3 full).
 *
 * Interface for computing embeddings locally without API calls.
 * This enables offline use and better privacy (vectors never leave the phone).
 *
 * Phase 2 status: INTERFACE ONLY. The full implementation requires:
 *   1. onnxruntime-react-native (native module, needs dev build)
 *   2. Model download: all-MiniLM-L6-v2 (22MB, English) or
 *      multilingual-e5-small (113MB, Chinese + 100 languages)
 *   3. Tokenizer: WordPiece/BPE implemented in pure TS for Hermes
 *   4. Download manager: WiFi-only, progress UI, storage management
 *
 * Until then, use embedTexts() from ./embeddings.js (API-based).
 * The EmbeddingProvider interface below lets us swap seamlessly.
 *
 * PURE module: no React Native / expo imports (interface only).
 */

export interface EmbeddingProvider {
  /** Unique name for cache keys (e.g. "minilm-l6-v2-onnx"). */
  readonly name: string;
  /** Vector dimensions (e.g. 384 for MiniLM). */
  readonly dimensions: number;
  /** Whether the provider is ready (model downloaded + loaded). */
  isReady(): Promise<boolean>;
  /**
   * Embed texts to vectors. Throws with human-actionable message on failure.
   * Must return vectors in the same order as inputs.
   */
  embed(texts: string[]): Promise<number[][]>;
}

/** Name of the API-backed provider (its `name` is generic — resolve the real model separately). */
export const API_EMBEDDING_PROVIDER_NAME = "api-embeddings";

/**
 * API-based provider (Phase 1, always available).
 * Wraps embedTexts() to match the EmbeddingProvider interface.
 */
export function createApiEmbeddingProvider(
  getGroup: () => import("../api-groups/types.js").ApiGroup | null,
  embedFn?: typeof import("./embeddings.js").embedTexts,
): EmbeddingProvider {
  // Lazy import to avoid cycles; resolved at call time.
  return {
    name: API_EMBEDDING_PROVIDER_NAME,
    dimensions: 1536, // text-embedding-3-small; actual dim from API response
    async isReady(): Promise<boolean> {
      return getGroup() !== null;
    },
    async embed(texts: string[]): Promise<number[][]> {
      const group = getGroup();
      if (!group) throw new Error("noApiGroup");
      const { embedTexts: doEmbed } = await import("./embeddings.js");
      const fn = embedFn ?? doEmbed;
      const res = await fn(group, texts);
      return res.vectors;
    },
  };
}

/**
 * On-device provider (Phase 3).
 *
 * NOT YET IMPLEMENTED — throws on use with a clear message.
 * Implementation plan (see research/mobile-rag-plan.md §5 Phase 3):
 *   1. Add onnxruntime-react-native via Expo config plugin
 *   2. Download model ONNX file to Application Support (WiFi only)
 *   3. Implement WordPiece tokenizer in pure TS (from tokenizer.json)
 *   4. Run inference via onnxruntime, mean-pool, normalize
 *
 * The interface is ready; the implementation is a separate work item.
 */
export function createOnDeviceEmbeddingProvider(): EmbeddingProvider {
  return {
    name: "onnx-minilm-l6-v2",
    dimensions: 384,
    async isReady(): Promise<boolean> {
      return false; // Model not downloaded / runtime not integrated
    },
    async embed(_texts: string[]): Promise<number[][]> {
      throw new Error(
        "onDeviceNotReady: On-device embeddings need the model downloaded first. " +
          "This is a Phase 3 feature — use API embeddings for now.",
      );
    },
  };
}

/**
 * Pick the best available provider: on-device if ready, else API.
 * This is the single entry point for embedding — the indexer and the
 * knowledge_search query path both resolve their default embed through here.
 * In Phase 2 the on-device provider is never ready, so this behaves exactly
 * like the API path; when Phase 3 lands, callers get on-device for free.
 */
export async function selectEmbeddingProvider(
  getGroup: () => import("../api-groups/types.js").ApiGroup | null,
): Promise<EmbeddingProvider> {
  const onDevice = createOnDeviceEmbeddingProvider();
  if (await onDevice.isReady()) return onDevice;
  return createApiEmbeddingProvider(getGroup);
}

/**
 * Embed via the best provider, reporting the REAL model name.
 *
 * `EmbeddingProvider.name` is generic for the API path ("api-embeddings"),
 * but chunks record the actual model (e.g. "text-embedding-3-small") so a
 * later model change can be detected instead of silently breaking search.
 * Returns { vectors, model } in the EmbedResult shape.
 */
export async function embedWithRealModel(
  getGroup: () => import("../api-groups/types.js").ApiGroup | null,
  texts: string[],
): Promise<import("./embeddings.js").EmbedResult> {
  const provider = await selectEmbeddingProvider(getGroup);
  const vectors = await provider.embed(texts);
  let model = provider.name;
  if (provider.name === API_EMBEDDING_PROVIDER_NAME) {
    const group = getGroup();
    if (group) {
      const { embeddingModelFor } = await import("./embeddings.js");
      model = embeddingModelFor(group);
    }
  }
  return { vectors, model };
}
