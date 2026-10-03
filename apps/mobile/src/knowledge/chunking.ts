/**
 * Knowledge base — text chunking. PURE module: no React Native / expo imports.
 *
 * Splits documents into retrieval-friendly chunks:
 * - Markdown: split on headers (# / ##), keep the header path as context.
 * - Plain text: split on paragraphs, sliding window within long paragraphs.
 * - Defaults: 800 chars per chunk, 120 chars overlap.
 *
 * Chunk ids are deterministic: hash(docId + index + text slice) so re-indexing
 * the same document produces the same ids (diff-friendly).
 */

/** One retrieval unit. */
export interface TextChunk {
  /** Deterministic id: hash of docId + index. */
  id: string;
  /** Owning document id. */
  docId: string;
  /** 0-based chunk index within the document. */
  index: number;
  /** The chunk text (includes header context for markdown). */
  text: string;
  /** Markdown header path, e.g. "Guide > Install". Empty for plain text. */
  headingPath: string;
}

export const DEFAULT_CHUNK_SIZE = 800;
export const DEFAULT_CHUNK_OVERLAP = 120;

/**
 * Deterministic 53-bit string hash (cyrb53). No crypto dependency — works in
 * Hermes, node, and browsers. Not for security, just stable ids.
 */
export function hashString(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function chunkId(docId: string, index: number): string {
  return `kb_${hashString(`${docId}::${index}`)}`;
}

export interface ChunkOptions {
  chunkSize?: number;
  chunkOverlap?: number;
}

interface Section {
  headingPath: string;
  text: string;
}

/** Split markdown into sections by headers, tracking the header path. */
function splitMarkdownSections(text: string): Section[] {
  const lines = text.split("\n");
  const sections: Section[] = [];
  let path: string[] = [];
  let current: string[] = [];

  const flush = () => {
    const body = current.join("\n").trim();
    if (body) sections.push({ headingPath: path.join(" > "), text: body });
    current = [];
  };

  for (const line of lines) {
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (m) {
      flush();
      const level = m[1].length;
      const title = m[2];
      path = path.slice(0, level - 1);
      path.push(title);
    } else {
      current.push(line);
    }
  }
  flush();
  // Document with no headers at all -> one section, no path.
  if (sections.length === 0 && text.trim()) {
    return [{ headingPath: "", text: text.trim() }];
  }
  return sections;
}

/** Sliding-window split of a long string into ~chunkSize pieces. */
function windowSplit(text: string, chunkSize: number, overlap: number): string[] {
  const out: string[] = [];
  let start = 0;
  const clean = text.replace(/[ \t]+/g, " ").trim();
  if (!clean) return out;
  while (start < clean.length) {
    let end = Math.min(start + chunkSize, clean.length);
    // Prefer to break at a sentence/word boundary near the end.
    if (end < clean.length) {
      const slice = clean.slice(start, end);
      const lastBreak = Math.max(
        slice.lastIndexOf("。"),
        slice.lastIndexOf("."),
        slice.lastIndexOf("\n"),
        slice.lastIndexOf(" "),
      );
      if (lastBreak > chunkSize * 0.5) end = start + lastBreak + 1;
    }
    out.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return out.filter(Boolean);
}

/**
 * Chunk a document's full text. Markdown-aware when isMarkdown is true.
 * Header context is prepended to each chunk so retrieval keeps its bearings.
 */
export function chunkDocument(
  docId: string,
  text: string,
  isMarkdown: boolean,
  opts: ChunkOptions = {},
): TextChunk[] {
  const chunkSize = opts.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = opts.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;
  const sections = isMarkdown ? splitMarkdownSections(text) : [{ headingPath: "", text }];
  const chunks: TextChunk[] = [];
  let index = 0;
  for (const section of sections) {
    const prefix = section.headingPath ? `\n` : "";
    const pieces = windowSplit(section.text, chunkSize - prefix.length, overlap);
    for (const piece of pieces) {
      chunks.push({
        id: chunkId(docId, index),
        docId,
        index,
        text: prefix + piece,
        headingPath: section.headingPath,
      });
      index++;
    }
  }
  return chunks;
}
