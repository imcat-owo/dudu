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

import { type LocalTool, ToolError } from "../api-groups/local-tools";
import type { ApiGroup } from "../api-groups/types";
import type { EmbedResult } from "./embeddings";
import { embedWithRealModel } from "./embeddings-local";
import { topKByCosine } from "./vectors";

export interface KnowledgeToolDeps {
  /** Active API group (for /v1/embeddings). Null = honestly report unconfigured. */
  getGroup: () => ApiGroup | null;
  /**
   * Override the embedding call (tests). Defaults to the best available
   * EmbeddingProvider (on-device when ready, else API).
   */
  embed?: (group: ApiGroup, texts: string[]) => Promise<EmbedResult>;
  /**
   * Read a plain-text file (txt/md) from a URI. Injected by local-agent
   * (expo-file-system). Required by knowledge_add_file; when absent the
   * tool reports honestly instead of failing silently.
   */
  readTextFile?: (uri: string) => Promise<string>;
}

/**
 * PDF text extraction needs a hidden WebView (see knowledge/pdf-extract.tsx),
 * which only the UI layer can mount. The UI registers its implementation
 * here; the knowledge_add_file tool calls it for .pdf URIs.
 */
type PdfExtractHandler = (uri: string) => Promise<string>;

let pdfExtractHandler: PdfExtractHandler | null = null;

/** UI layer calls this once to wire PDF text extraction for the AI tool. */
export function registerPdfExtractHandler(h: PdfExtractHandler): void {
  pdfExtractHandler = h;
}

/**
 * Default embedding path: resolve the best provider and adapt it to the
 * EmbedResult shape. Reports the REAL model name (e.g. "text-embedding-3-small",
 * not the generic provider name) so a later model change can be detected
 * instead of silently breaking search.
 */
export async function defaultEmbed(
  getGroup: () => ApiGroup | null,
  texts: string[],
): Promise<EmbedResult> {
  return embedWithRealModel(getGroup, texts);
}

/** Similarity floor: below this, a chunk is noise, not an answer. */
export const SEARCH_MIN_SCORE = 0.25;
const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 10;

/**
 * Knowledge base guardrails (P2-6): no silent duplicates, no runaway size.
 * - One document ≈ 500k chars max (~1MB of text — plenty for a phone KB).
 * - 200 documents max (keeps search fast and embedding bills sane).
 */
export const KB_MAX_DOC_CHARS = 500_000;
export const KB_MAX_DOCS = 200;

/**
 * Reject duplicate / oversized / over-count adds BEFORE anything is written.
 * Throws ToolError with a message the AI can relay to her directly.
 */
async function guardKnowledgeAdd(
  store: KnowledgeAddStore,
  name: string,
  text: string,
): Promise<void> {
  if (text.length > KB_MAX_DOC_CHARS) {
    throw new ToolError(
      `“${name}”太大了（约${Math.round(text.length / 1000)}千字，知识库单篇上限约${Math.round(KB_MAX_DOC_CHARS / 1000)}千字）。让她拆成几篇小的再存。`,
    );
  }
  const docs = await store.listDocs();
  if (docs.length >= KB_MAX_DOCS) {
    throw new ToolError(
      `知识库已经有${docs.length}篇文档（上限${KB_MAX_DOCS}篇）。让她删掉一些不用的再存新的。`,
    );
  }
  const normName = name.trim().toLowerCase();
  const sameName = docs.find((d) => d.name.trim().toLowerCase() === normName);
  if (sameName) {
    if (sameName.size === text.length) {
      throw new ToolError(
        `《${sameName.name}》已经在知识库里了（名字和大小都一样，应该是同一篇）。不用重复存；如果她想刷新索引，用 knowledge_reindex。`,
      );
    }
    throw new ToolError(
      `知识库里已经有一篇叫《${sameName.name}》的文档了。让她换个名字，或者先删掉旧的；如果想刷新它，用 knowledge_reindex。`,
    );
  }
}

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
 * Minimal store interface needed by knowledge_search (structural typing).
 * Compatible with KnowledgeStore, SqliteKnowledgeStore, and the lazy wrapper.
 */
export interface KnowledgeSearchStore {
  hasIndexedDocs(): Promise<boolean>;
  listChunks(docId?: string): Promise<import("./store").KbChunkRecord[]>;
  listDocs(): Promise<import("./store").KbDoc[]>;
}

/**
 * Build the knowledge tool set bound to a store instance.
 * Every tool REALLY works — no placeholders.
 */
export function createKnowledgeTools(
  store: KnowledgeSearchStore,
  deps: KnowledgeToolDeps,
): LocalTool[] {
  const doEmbed = deps.embed ?? ((_group, texts) => defaultEmbed(deps.getGroup, texts));
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
        let queryModel: string;
        try {
          const res = await doEmbed(group, [query]);
          queryVec = res.vectors[0];
          queryModel = res.model;
        } catch (e) {
          throw new ToolError(
            `Couldn't embed the search query: ${e instanceof Error ? e.message : String(e)}`,
          );
        }

        const chunks = await store.listChunks();
        const docs = await store.listDocs();
        // Embedding-model change detection: if she switched the embedding
        // model, old vectors have different dimensions and cosine search
        // would silently find nothing. Say so honestly and offer re-index.
        const withVectors = chunks.filter((c) => c.vector.length > 0);
        const compatible = withVectors.filter((c) => c.vector.length === queryVec.length);
        if (withVectors.length > 0 && compatible.length === 0) {
          const oldModels = [
            ...new Set(withVectors.map((c) => c.embedModel || "an older model")),
          ].join(", ");
          return (
            `I can't search her documents right now: they were indexed with ${oldModels} ` +
            `(${withVectors[0].vector.length} dimensions), but the current embedding model is ` +
            `${queryModel} (${queryVec.length} dimensions) — the vectors are incompatible. ` +
            `Tell her honestly what happened and offer to re-index the documents with the ` +
            `knowledge_reindex tool (or the "re-index" button in the knowledge base). ` +
            `Don't pretend the documents contain nothing.`
          );
        }
        const docNames = new Map(docs.map((d) => [d.id, d.name]));
        const hits = topKByCosine(
          queryVec,
          compatible.map((c) => ({ item: c, vector: c.vector })),
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
 * Minimal store interface needed by knowledge_add_doc / knowledge_reindex
 * (structural typing). Compatible with KnowledgeStore, SqliteKnowledgeStore,
 * and the lazy wrapper.
 */
export interface KnowledgeAddStore {
  addDoc(name: string, kind: string, size: number): Promise<import("./store").KbDoc>;
  updateDoc(id: string, patch: Partial<import("./store").KbDoc>): Promise<unknown>;
  getDoc(id: string): Promise<import("./store").KbDoc | null>;
  listDocs(): Promise<import("./store").KbDoc[]>;
  listChunks(docId?: string): Promise<import("./store").KbChunkRecord[]>;
  putChunks(records: import("./store").KbChunkRecord[]): Promise<unknown>;
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
        await guardKnowledgeAdd(store, name, text);
        const doc = await store.addDoc(name, "md", text.length);
        try {
          const { indexDocument } = await import("./indexer");
          const result = await indexDocument(
            store as unknown as import("./store").KnowledgeStore,
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
    {
      name: "knowledge_reindex",
      description:
        "Re-index one of her knowledge base documents with the CURRENT embedding model. Use when knowledge_search reports that documents were indexed with a different (incompatible) embedding model, or when she asks to refresh a document's index. Finds the document by name (fuzzy) or id, re-embeds its existing paragraphs, and marks it ready again. The original upload isn't needed — paragraph texts are preserved.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Document name or id to re-index, e.g. '宫保鸡丁菜谱'.",
          },
        },
        required: ["name"],
        additionalProperties: false,
      },
      manualId: "knowledge",
      run: async (args) => {
        const name = strArg(args, "name").trim();
        if (!name) throw new ToolError("name is required.");
        const group = deps.getGroup();
        if (!group) {
          throw new ToolError(
            "No API group configured — I need an API group with /v1/embeddings to re-index.",
          );
        }
        const docs = await store.listDocs();
        const doc =
          docs.find((d) => d.id === name) ??
          docs.find((d) => d.name === name) ??
          docs.find((d) => d.name.toLowerCase().includes(name.toLowerCase()));
        if (!doc) {
          throw new ToolError(
            `No document named "${name}" in the knowledge base. Ask her which one she means.`,
          );
        }
        try {
          const { reindexDocument } = await import("./indexer");
          const result = await reindexDocument(
            store as unknown as import("./store").KnowledgeStore,
            group,
            doc.id,
            { embed: deps.embed },
          );
          return `Document “${doc.name}” re-indexed with ${result.embedModel}: ${result.chunkCount} chunks. knowledge_search works again.`;
        } catch (e) {
          throw new ToolError(e instanceof Error ? e.message : "re-indexing failed");
        }
      },
    },
    {
      name: "knowledge_add_file",
      description:
        "Add a FILE she shared to her knowledge base (file cabinet) so it becomes searchable later. Use when she attaches a file in chat and says '把这个存进知识库' / '把这个PDF存起来'. Pass the file's uri exactly as it appears in her message attachment. Supports .txt, .md, and .pdf — the text is extracted automatically, then chunked, embedded, and indexed; knowledge_search can find it afterwards.",
      parameters: {
        type: "object",
        properties: {
          uri: {
            type: "string",
            description:
              "File URI from her message attachment (e.g. the uri of the PDF she just sent).",
          },
          name: {
            type: "string",
            description:
              "Document name, e.g. '宫保鸡丁菜谱'. Optional — defaults to the file's own name.",
          },
        },
        required: ["uri"],
        additionalProperties: false,
      },
      manualId: "knowledge",
      run: async (args) => {
        const uri = strArg(args, "uri").trim();
        if (!uri) throw new ToolError("uri is required.");
        let name = strArg(args, "name").trim();
        if (!name) {
          // Derive from the URI's last path segment.
          const seg = uri.split("?")[0].split("/").pop() ?? "";
          name = seg ? decodeURIComponent(seg) : `file-${Date.now()}`;
        }
        const lower = `${name} ${uri}`.toLowerCase();
        const isPdf = lower.includes(".pdf");
        const isText = /\.(txt|md|markdown)(\?|$)/.test(lower);
        if (!isPdf && !isText) {
          throw new ToolError(
            `I can only index .txt, .md, and .pdf files — "${name}" isn't one of those. Tell her plainly.`,
          );
        }
        const group = deps.getGroup();
        if (!group) {
          throw new ToolError(
            "No API group configured — I need an API group with /v1/embeddings to index documents.",
          );
        }
        let text: string;
        try {
          if (isPdf) {
            if (!pdfExtractHandler) {
              throw new Error(
                "PDF extraction isn't available right now (the app view that extracts PDF text isn't mounted). Ask her to open the knowledge base screen and add the PDF there instead.",
              );
            }
            text = await pdfExtractHandler(uri);
          } else {
            if (!deps.readTextFile) {
              throw new Error("File reading isn't wired up in this build.");
            }
            text = await deps.readTextFile(uri);
          }
        } catch (e) {
          throw new ToolError(e instanceof Error ? e.message : "reading the file failed");
        }
        if (!text.trim()) {
          throw new ToolError(`The file "${name}" looks empty — nothing to index. Tell her.`);
        }
        const kind = isPdf ? "pdf" : name.toLowerCase().endsWith(".md") ? "md" : "txt";
        await guardKnowledgeAdd(store, name, text);
        const doc = await store.addDoc(name, kind, text.length);
        try {
          const { indexDocument } = await import("./indexer");
          const result = await indexDocument(
            store as unknown as import("./store").KnowledgeStore,
            group,
            doc.id,
            text,
            true,
            { embed: deps.embed },
          );
          return `File “${name}” indexed: ${result.chunkCount} chunks. knowledge_search can find it now.`;
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
