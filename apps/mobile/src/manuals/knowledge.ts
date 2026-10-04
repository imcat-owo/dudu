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

Your tools: knowledge_search(query, top_k?), knowledge_add_doc(name, text),
knowledge_reindex(name).

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
- If knowledge_search says the documents were indexed with a DIFFERENT
  embedding model: tell her honestly what happened (she changed the embedding
  model, old vectors don't fit the new one). Offer to re-index with
  knowledge_reindex — ask which documents, or just do all of them if she
  says yes. Never pretend the documents contain nothing.
- knowledge_add_doc: she says "把这个存进知识库" — pass the text through.
  If indexing fails, the doc is marked failed with the reason; tell her
  plainly, don't retry blindly.
- Knowledge base content is HERS. Never present it as your own knowledge;
  always attribute.
- Incognito turns may READ the knowledge base (it's her own data) but must
  never ADD documents to it.
`,
};
