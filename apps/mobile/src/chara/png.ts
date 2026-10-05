/**
 * Minimal PNG chunk reader/writer for chara_card embedding.
 *
 * PURE module: no React Native imports, no Buffer dependency (Hermes-safe).
 * Implements just enough of the PNG spec to find/replace tEXt chunks:
 *   signature (8) | chunk* : length u32BE | type ascii4 | data | crc32 u32BE
 *
 * tEXt chunk data: keyword (1-79 latin-1 bytes) + 0x00 + text (latin-1).
 * chara_card stores base64 (ASCII) in the text field, so latin-1 is exact.
 */

export interface PngChunk {
  type: string;
  data: Uint8Array;
}

export type PngErrorCode =
  | "not-png"
  | "truncated"
  | "bad-chunk"
  | "no-idat"
  | "compressed-unsupported";

export class PngError extends Error {
  code: PngErrorCode;
  constructor(code: PngErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** IEEE CRC32 table. */
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function readU32BE(b: Uint8Array, off: number): number {
  return (b[off] * 0x1000000 + (b[off + 1] << 16) + (b[off + 2] << 8) + b[off + 3]) >>> 0;
}

function writeU32BE(out: number[], v: number): void {
  out.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
}

/** latin-1 bytes -> string (exact for 0x00-0xFF). */
export function latin1Decode(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

/** string -> latin-1 bytes (chars above 0xFF are replaced with '?'). */
export function latin1Encode(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[i] = c <= 0xff ? c : 0x3f;
  }
  return out;
}

const B64CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64REV: Record<string, number> = {};
for (let i = 0; i < B64CHARS.length; i++) B64REV[B64CHARS[i]] = i;

/** bytes -> base64 (Hermes has no btoa for binary). */
export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    s += B64CHARS[(n >> 18) & 0x3f] + B64CHARS[(n >> 12) & 0x3f];
    s += i + 1 < bytes.length ? B64CHARS[(n >> 6) & 0x3f] : "=";
    s += i + 2 < bytes.length ? B64CHARS[n & 0x3f] : "=";
  }
  return s;
}

/** base64 -> bytes (whitespace-tolerant). Throws on invalid length. */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, "");
  if (clean.length % 4 !== 0) throw new PngError("bad-chunk", "bad base64 length");
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64REV[clean[i]] ?? 0;
    const b = B64REV[clean[i + 1]] ?? 0;
    const c = clean[i + 2] === "=" ? 0 : (B64REV[clean[i + 2]] ?? 0);
    const d = clean[i + 3] === "=" ? 0 : (B64REV[clean[i + 3]] ?? 0);
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    out.push((n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
  }
  let pad = 0;
  if (clean.endsWith("==")) pad = 2;
  else if (clean.endsWith("=")) pad = 1;
  return new Uint8Array(out.slice(0, out.length - pad));
}

/** UTF-8 encode (TextEncoder-free, Hermes-safe). */
export function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const lo = s.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else
      out.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f),
      );
  }
  return new Uint8Array(out);
}

/** UTF-8 decode (TextDecoder-free, Hermes-safe). Throws on invalid sequences. */
export function utf8Decode(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; ) {
    const c = b[i];
    if (c < 0x80) {
      s += String.fromCharCode(c);
      i++;
    } else if ((c & 0xe0) === 0xc0) {
      if (i + 1 >= b.length) throw new PngError("bad-chunk", "bad utf8");
      s += String.fromCharCode(((c & 0x1f) << 6) | (b[i + 1] & 0x3f));
      i += 2;
    } else if ((c & 0xf0) === 0xe0) {
      if (i + 2 >= b.length) throw new PngError("bad-chunk", "bad utf8");
      s += String.fromCharCode(((c & 0x0f) << 12) | ((b[i + 1] & 0x3f) << 6) | (b[i + 2] & 0x3f));
      i += 3;
    } else if ((c & 0xf8) === 0xf0) {
      if (i + 3 >= b.length) throw new PngError("bad-chunk", "bad utf8");
      const cp =
        ((c & 0x07) << 18) |
        ((b[i + 1] & 0x3f) << 12) |
        ((b[i + 2] & 0x3f) << 6) |
        (b[i + 3] & 0x3f);
      const hi = 0xd800 + (((cp - 0x10000) >> 10) & 0x3ff);
      const lo = 0xdc00 + ((cp - 0x10000) & 0x3ff);
      s += String.fromCharCode(hi, lo);
      i += 4;
    } else {
      throw new PngError("bad-chunk", "bad utf8");
    }
  }
  return s;
}

/** Parse PNG chunk list. Throws PngError on invalid input. Never half-parses. */
export function parsePngChunks(bytes: Uint8Array): PngChunk[] {
  if (bytes.length < 8) throw new PngError("not-png", "too short");
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIG[i]) throw new PngError("not-png", "bad signature");
  }
  const chunks: PngChunk[] = [];
  let off = 8;
  let sawIend = false;
  while (off < bytes.length) {
    if (off + 8 > bytes.length) throw new PngError("truncated", "chunk header");
    const len = readU32BE(bytes, off);
    const type = latin1Decode(bytes.slice(off + 4, off + 8));
    if (!/^[A-Za-z]{4}$/.test(type)) throw new PngError("bad-chunk", `bad type ${type}`);
    if (off + 12 + len > bytes.length) throw new PngError("truncated", `chunk ${type}`);
    const data = bytes.slice(off + 8, off + 8 + len);
    // CRC is verified on write; on read we only require structural validity
    // (many real-world card PNGs have been re-saved by tools with lazy CRCs).
    chunks.push({ type, data });
    off += 12 + len;
    if (type === "IEND") {
      sawIend = true;
      break;
    }
  }
  if (!sawIend) throw new PngError("truncated", "missing IEND");
  return chunks;
}

/** Serialize chunks back to a PNG file (fresh CRCs). */
export function encodePng(chunks: PngChunk[]): Uint8Array {
  const out: number[] = [...PNG_SIG];
  for (const ch of chunks) {
    writeU32BE(out, ch.data.length);
    const typeBytes = latin1Encode(ch.type);
    out.push(typeBytes[0], typeBytes[1], typeBytes[2], typeBytes[3]);
    for (let i = 0; i < ch.data.length; i++) out.push(ch.data[i]);
    const crcInput = new Uint8Array(4 + ch.data.length);
    crcInput.set(typeBytes, 0);
    crcInput.set(ch.data, 4);
    writeU32BE(out, crc32(crcInput));
  }
  return new Uint8Array(out);
}

export interface TextChunk {
  keyword: string;
  text: string;
}

/** Decode a tEXt chunk. Throws on malformed data. */
export function decodeTextChunk(data: Uint8Array): TextChunk {
  const nul = data.indexOf(0);
  if (nul < 1 || nul > 79) throw new PngError("bad-chunk", "bad tEXt keyword");
  return { keyword: latin1Decode(data.slice(0, nul)), text: latin1Decode(data.slice(nul + 1)) };
}

/** Encode a tEXt chunk (keyword must be 1-79 latin-1 chars). */
export function encodeTextChunk(keyword: string, text: string): PngChunk {
  const kw = latin1Encode(keyword);
  if (kw.length < 1 || kw.length > 79) throw new PngError("bad-chunk", "bad keyword length");
  const tx = latin1Encode(text);
  const data = new Uint8Array(kw.length + 1 + tx.length);
  data.set(kw, 0);
  data[kw.length] = 0;
  data.set(tx, kw.length + 1);
  return { type: "tEXt", data };
}

export interface CardChunkScan {
  /** "chara" (v2 canonical) text, if present. */
  chara: string | null;
  /** "ccv3" (v3) text, if present — takes precedence on read. */
  ccv3: string | null;
  /** True when a chara/ccv3 keyword was found in a compressed chunk (zTXt/iTXt). */
  compressedFound: boolean;
}

/** Find card chunks. Keyword match is case-insensitive (per ST's parser). */
export function scanCardChunks(chunks: PngChunk[]): CardChunkScan {
  const out: CardChunkScan = { chara: null, ccv3: null, compressedFound: false };
  for (const ch of chunks) {
    if (ch.type === "tEXt") {
      let tc: TextChunk;
      try {
        tc = decodeTextChunk(ch.data);
      } catch {
        continue;
      }
      const kw = tc.keyword.toLowerCase();
      if (kw === "ccv3" && out.ccv3 === null) out.ccv3 = tc.text;
      else if (kw === "chara" && out.chara === null) out.chara = tc.text;
    } else if (ch.type === "zTXt" || ch.type === "iTXt") {
      // Best-effort keyword sniff: these carry compressed text we can't
      // inflate without zlib (no Hermes-safe inflate in the app).
      try {
        const nul = ch.data.indexOf(0);
        if (nul > 0 && nul <= 79) {
          const kw = latin1Decode(ch.data.slice(0, nul)).toLowerCase();
          if (kw === "chara" || kw === "ccv3") out.compressedFound = true;
        }
      } catch {
        /* ignore */
      }
    }
  }
  return out;
}

/** Remove existing chara/ccv3 tEXt chunks (case-insensitive), like ST's writer. */
export function stripCardChunks(chunks: PngChunk[]): PngChunk[] {
  return chunks.filter((ch) => {
    if (ch.type !== "tEXt") return true;
    try {
      const kw = decodeTextChunk(ch.data).keyword.toLowerCase();
      return kw !== "chara" && kw !== "ccv3";
    } catch {
      return true;
    }
  });
}

/** Insert chunks right before IEND (ST's write position). */
export function insertBeforeIend(chunks: PngChunk[], insert: PngChunk[]): PngChunk[] {
  const idx = chunks.findIndex((c) => c.type === "IEND");
  const at = idx >= 0 ? idx : chunks.length;
  return [...chunks.slice(0, at), ...insert, ...chunks.slice(at)];
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/**
 * A valid 1x1 RGBA PNG, built from chunks (no compression needed — the
 * single scanline is stored uncompressed inside zlib). Used as the export
 * canvas when the persona has no PNG avatar to embed into.
 */
export function minimalPng(r = 0x2a, g = 0x2a, b = 0x35, a = 0xff): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, 1);
  dv.setUint32(4, 1);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const raw = new Uint8Array([0x00, r, g, b, a]); // filter byte + 1 pixel
  const zlib = new Uint8Array(2 + 5 + raw.length + 4);
  zlib[0] = 0x78;
  zlib[1] = 0x01;
  zlib[2] = 0x01; // BFINAL=1, BTYPE=00 (stored)
  zlib[3] = raw.length & 0xff;
  zlib[4] = (raw.length >> 8) & 0xff;
  zlib[5] = ~raw.length & 0xff;
  zlib[6] = (~raw.length >> 8) & 0xff;
  zlib.set(raw, 7);
  const ad = adler32(raw);
  zlib[7 + raw.length] = (ad >>> 24) & 0xff;
  zlib[8 + raw.length] = (ad >>> 16) & 0xff;
  zlib[9 + raw.length] = (ad >>> 8) & 0xff;
  zlib[10 + raw.length] = ad & 0xff;
  return encodePng([
    { type: "IHDR", data: ihdr },
    { type: "IDAT", data: zlib },
    { type: "IEND", data: new Uint8Array(0) },
  ]);
}
