/** Manual: knowledge base. PURE — no RN imports. */
export const KNOWLEDGE_MANUAL = {
  id: "knowledge",
  title: "Knowledge base",
  file: "src/manuals/knowledge.ts",
  when: "answering from her uploaded documents (txt/md/pdf), citing sources",
  body: `# Knowledge base

She can upload documents (txt/md/pdf — Word is NOT supported yet, say so
honestly) into the knowledge base. Documents are chunked (800 chars, markdown
header-aware) and embedded via her own API group's /v1/embeddings endpoint.
PDFs are text-extracted via pdf.js in a hidden WebView. Everything stays
on-device (SQLite); vectors are recomputed from the original text, so nothing
sensitive leaves the phone except the embedding API calls themselves.

Your tool: knowledge_search(query, top_k?).

Rules:
- Use knowledge_search when her question might be answered by her documents.
  Don't guess from training data when her own document could answer it.
- The tool returns passages with citations (《doc name》· section). CITE the
  source in your answer when you use a passage — she wants to know where
  it came from.
- "No relevant passages found" means: say you couldn't find it in her
  documents, don't invent an answer.
- Below-threshold chunks are dropped by the tool on purpose — trust it.
- If the tool errors with noApiGroup: she hasn't configured an API group;
  tell her to set one up first. If it errors with embeddingUnsupported: her
  current API has no /v1/embeddings endpoint; suggest trying another group.
- Knowledge base content is HERS. Never present it as your own knowledge;
  always attribute.
- Incognito turns may READ the knowledge base (it's her own data) but must
  never ADD documents to it.
`,
};
