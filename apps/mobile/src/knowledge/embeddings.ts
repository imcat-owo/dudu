/**
 * Knowledge base — embeddings via the user's own API group. PURE module:
 * plain fetch, no React Native / expo imports.
 *
 * Calls OpenAI-compatible `/v1/embeddings` on the active group — the same
 * BYO-key philosophy as chat. Zero new dependencies, zero model downloads.
 *
 * Honest failures: no group configured -> clear error; API without an
 * embeddings endpoint -> clear error (never silently skip).
 */

import { type ApiGroup, normalizeBaseUrl } from "../api-groups/types.js";

/** Default embedding model for OpenAI-compatible endpoints. */
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingError";
  }
}

function embeddingModelFor(group: ApiGroup): string {
  return group.embeddingModel?.trim() || DEFAULT_EMBEDDING_MODEL;
}

function embeddingHeaders(group: ApiGroup): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = group.apiKey?.trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  return { ...headers, ...group.headers };
}

export interface EmbedResult {
  vectors: number[][];
  /** Model actually used (for cache keys). */
  model: string;
}

/**
 * Embed a batch of texts. Throws EmbeddingError with a human-actionable
 * message on any failure (auth, 404 = no embeddings endpoint, rate limit…).
 */
export async function embedTexts(
  group: ApiGroup,
  texts: string[],
  opts: { signal?: AbortSignal } = {},
): Promise<EmbedResult> {
  if (!group) throw new EmbeddingError("noApiGroup");
  if (texts.length === 0) return { vectors: [], model: embeddingModelFor(group) };
  const model = embeddingModelFor(group);
  const url = `${normalizeBaseUrl(group.baseUrl)}/embeddings`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: embeddingHeaders(group),
      body: JSON.stringify({ model, input: texts }),
      signal: opts.signal,
    });
  } catch (e) {
    throw new EmbeddingError(`embeddingNetwork: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) {
      throw new EmbeddingError("embeddingAuth: API key rejected by the embeddings endpoint.");
    }
    if (res.status === 404) {
      throw new EmbeddingError(
        "embeddingUnsupported: this API has no /v1/embeddings endpoint. Try another group.",
      );
    }
    if (res.status === 429) {
      throw new EmbeddingError("embeddingRateLimit: too many requests, try again in a bit.");
    }
    throw new EmbeddingError(
      `embeddingFailed: HTTP ${res.status}${body ? ` — ${body.slice(0, 200)}` : ""}`,
    );
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new EmbeddingError("embeddingBadResponse: the API didn't return JSON.");
  }
  const data = (json as { data?: Array<{ embedding?: unknown; index?: number }> }).data;
  if (!Array.isArray(data) || data.length === 0) {
    throw new EmbeddingError("embeddingBadResponse: empty embedding result.");
  }
  const vectors: number[][] = new Array(texts.length);
  for (const row of data) {
    const idx = typeof row.index === "number" ? row.index : -1;
    const emb = row.embedding;
    if (
      idx < 0 ||
      idx >= texts.length ||
      !Array.isArray(emb) ||
      emb.some((v) => typeof v !== "number")
    ) {
      throw new EmbeddingError("embeddingBadResponse: malformed embedding vector.");
    }
    vectors[idx] = emb as number[];
  }
  if (vectors.some((v) => !v)) {
    throw new EmbeddingError("embeddingBadResponse: missing vectors for some inputs.");
  }
  return { vectors, model };
}
