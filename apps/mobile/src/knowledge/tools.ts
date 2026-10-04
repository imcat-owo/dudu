/**
 * Knowledge base — AI tools. PURE module: no React Native / expo imports.
 *
 * One tool (Phase 1):
 *   knowledge_search — semantic search over her uploaded documents.
 *   Embeds the query with the active API group, cosine-ranks chunks,
 *   returns top-k with source citations. Below-threshold hits are dropped —
 *   never inject irrelevant text into the model's context.
 *
 * In-app tool: no authorization gate (nothing crosses the app boundary).
 */

import { type LocalTool, ToolError } from "../api-groups/local-tools.js";
import type { ApiGroup } from "../api-groups/types.js";
import { type EmbedResult, embedTexts } from "./embeddings.js";
import type { KnowledgeStore } from "./store.js";
import { topKByCosine } from "./vectors.js";

export interface KnowledgeToolDeps {
  /** Active API group (for /v1/embeddings). Null = honestly report unconfigured. */
  getGroup: () => ApiGroup | null;
  /** Override the embedding call (tests). Defaults to embedTexts. */
  embed?: (group: ApiGroup, texts: string[]) => Promise<EmbedResult>;
}

/** Similarity floor: below this, a chunk is noise, not an answer. */
export const SEARCH_MIN_SCORE = 0.25;
const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 10;

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

function numArg(args: Record<string, unknown>, name: string, fallback: number): number {
  const v = args[name];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function formatHit(docName: string, headingPath: string, text: string, score: number): string {
  const where = headingPath ? `《${docName}》· ${headingPath}` : `《${docName}》`;
  const excerpt = text.length > 600 ? `${text.slice(0, 600)}…` : text;
  return `[${where} · 相关度 ${(score * 100).toFixed(0)}%]\n${excerpt}`;
}

/**
 * Build the knowledge tool set bound to a store instance.
 * Every tool REALLY works — no placeholders.
 */
export function createKnowledgeTools(store: KnowledgeStore, deps: KnowledgeToolDeps): LocalTool[] {
  const doEmbed = deps.embed ?? embedTexts;
  return [
    {
      name: "knowledge_search",
      description:
        "Search her uploaded documents (knowledge base) for relevant passages. Use when she asks about something that might be in her documents — manuals, notes, articles she uploaded. Returns matching passages with source citations (document name + section). If nothing relevant is found, it says so — never invent content. Cite the source when you use a passage in your answer.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "What to look for — a question or keywords.",
          },
          top_k: {
            type: "number",
            description: "How many passages to return (default 5, max 10).",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      manualId: "knowledge",
      run: async (args) => {
        const query = strArg(args, "query").trim();
        if (!query) throw new ToolError("Missing required argument: query.");
        const topK = Math.min(
          Math.max(1, Math.round(numArg(args, "top_k", DEFAULT_TOP_K))),
          MAX_TOP_K,
        );

        const group = deps.getGroup();
        if (!group) {
          throw new ToolError(
            "No API group is configured, so I can't search the knowledge base right now. Ask her to set up an API group first.",
          );
        }
        if (!(await store.hasIndexedDocs())) {
          return "The knowledge base is empty — she hasn't uploaded any documents yet.";
        }

        let queryVec: number[];
        try {
          const res = await doEmbed(group, [query]);
          queryVec = res.vectors[0];
        } catch (e) {
          throw new ToolError(
            `Couldn't embed the search query: ${e instanceof Error ? e.message : String(e)}`,
          );
        }

        const chunks = await store.listChunks();
        const docs = await store.listDocs();
        const docNames = new Map(docs.map((d) => [d.id, d.name]));
        const hits = topKByCosine(
          queryVec,
          chunks
            .filter((c) => c.vector.length > 0 && c.vector.length === queryVec.length)
            .map((c) => ({ item: c, vector: c.vector })),
          topK,
          SEARCH_MIN_SCORE,
        );
        if (hits.length === 0) {
          return "No relevant passages found in her documents.";
        }
        return hits
          .map((h) =>
            formatHit(
              docNames.get(h.item.docId) ?? h.item.docId,
              h.item.headingPath,
              h.item.text,
              h.score,
            ),
          )
          .join("\n\n---\n\n");
      },
    },
  ];
}

/**
 * Minimal store interface needed by knowledge_add_doc (structural typing).
 * Compatible with KnowledgeStore, SqliteKnowledgeStore, and the lazy wrapper.
 */
export interface KnowledgeAddStore {
  addDoc(name: string, kind: string, size: number): Promise<import("./store.js").KbDoc>;
  updateDoc(id: string, patch: Partial<import("./store.js").KbDoc>): Promise<unknown>;
}

/**
 * Build the knowledge-add tool set bound to a store instance.
 * The AI provides the document text directly (from chat, a file she shared,
 * or content it generated) — the tool registers the doc and indexes it.
 */
export function createKnowledgeAddTools(
  store: KnowledgeAddStore,
  deps: KnowledgeToolDeps,
): LocalTool[] {
  // Lazy to avoid a hard import cycle: indexer pulls embeddings which
  // are already imported above; indexDocument lives in indexer.js.
  return [
    {
      name: "knowledge_add_doc",
      description:
        "Add a document to her knowledge base (file cabinet) so it becomes searchable later. Use when she says '把这个存进知识库' / '记住这篇文档'. Provide a short name and the full text content — markdown is fine. The document is chunked, embedded, and indexed; knowledge_search can find it afterwards.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Document name, e.g. '宫保鸡丁菜谱'. Keep it short.",
          },
          text: {
            type: "string",
            description: "Full document text content to index.",
          },
        },
        required: ["name", "text"],
        additionalProperties: false,
      },
      manualId: "knowledge",
      run: async (args) => {
        const name = strArg(args, "name").trim();
        const text = strArg(args, "text");
        if (!name) throw new ToolError("name is required.");
        if (!text.trim()) throw new ToolError("text is required.");
        const group = deps.getGroup();
        if (!group) {
          throw new ToolError(
            "No API group configured — I need an API group with /v1/embeddings to index documents.",
          );
        }
        const doc = await store.addDoc(name, "md", text.length);
        try {
          const { indexDocument } = await import("./indexer.js");
          const result = await indexDocument(
            store as unknown as import("./store.js").KnowledgeStore,
            group,
            doc.id,
            text,
            true,
            { embed: deps.embed },
          );
          return `Document “${name}” indexed: ${result.chunkCount} chunks. knowledge_search can find it now.`;
        } catch (e) {
          await store.updateDoc(doc.id, {
            status: "failed",
            error: e instanceof Error ? e.message : "index failed",
          });
          throw new ToolError(e instanceof Error ? e.message : "indexing failed");
        }
      },
    },
  ];
}
