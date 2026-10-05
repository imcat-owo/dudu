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

import { type ApiGroup, normalizeBaseUrl } from "../api-groups/types";

/** Default embedding model for OpenAI-compatible endpoints. */
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingError";
  }
}

export function embeddingModelFor(group: ApiGroup): string {
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
 *
 * Round-3 code P2-3: the production provider never passes a signal, so a
 * hung endpoint stalled indexing/search forever. When the caller passes no
 * signal, we arm our own 30s budget.
 */
const EMBED_TIMEOUT_MS = 30_000;

export async function embedTexts(
  group: ApiGroup,
  texts: string[],
  opts: { signal?: AbortSignal } = {},
): Promise<EmbedResult> {
  if (!group) throw new EmbeddingError("noApiGroup");
  if (texts.length === 0) return { vectors: [], model: embeddingModelFor(group) };
  const model = embeddingModelFor(group);
  const url = `${normalizeBaseUrl(group.baseUrl)}/embeddings`;
  const own = opts.signal ? null : new AbortController();
  const timer = own ? setTimeout(() => own.abort(), EMBED_TIMEOUT_MS) : null;
  // own is non-null exactly when opts.signal is absent, so one of the two
  // is always a real signal — no non-null assertion needed.
  const signal: AbortSignal | undefined = opts.signal ?? own?.signal ?? undefined;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: embeddingHeaders(group),
      body: JSON.stringify({ model, input: texts }),
      signal,
    });
  } catch (e) {
    if (timer) clearTimeout(timer);
    if ((e as { name?: string } | null)?.name === "AbortError") {
      throw new EmbeddingError(
        `embeddingTimeout: no response in ${EMBED_TIMEOUT_MS / 1000}s — the embeddings endpoint may be down.`,
      );
    }
    throw new EmbeddingError(`embeddingNetwork: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (timer) clearTimeout(timer);
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
