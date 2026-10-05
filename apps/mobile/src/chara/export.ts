/**
 * chara_card export engine: Dudu persona -> PNG card (chara_card v2 + v3).
 *
 * PURE module: no React Native imports. Follows SillyTavern's write
 * process: strip existing chara/ccv3 chunks, insert a "chara" tEXt chunk
 * (v2 canonical, base64 JSON) before IEND, then a "ccv3" chunk (same data
 * with spec mutated to chara_card_v3/3.0).
 */

import type { Persona, PersonaTag } from "../persona/types.js";
import { type CharaCard, serializeCharaCard, toV3 } from "./card.js";
import { personaToCardData, withExportedCard } from "./persona-map.js";
import {
  base64ToBytes,
  bytesToBase64,
  encodePng,
  encodeTextChunk,
  insertBeforeIend,
  minimalPng,
  PngError,
  parsePngChunks,
  stripCardChunks,
  utf8Encode,
} from "./png.js";

export interface CharaExportDeps {
  /** Resolve the persona's avatar to PNG bytes (local path/URL -> bytes). Null = no usable PNG. */
  resolveAvatarPng?: (avatar: string | null) => Promise<Uint8Array | null>;
}

export interface CharaExportResult {
  /** The exported PNG file bytes. */
  pngBytes: Uint8Array;
  /** Base64 of the PNG (for sharing/saving). */
  pngBase64: string;
  /** The canonical v2 card JSON (what's inside the chara chunk). */
  cardJson: string;
  /** Suggested filename. */
  filename: string;
  /** Persona with its stored card refreshed (for the caller to persist). */
  updatedPersona: Persona;
}

function safeFilename(name: string): string {
  let clean = "";
  for (const ch of name) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || '\\/:*?"<>|'.includes(ch)) continue;
    clean += ch;
  }
  clean = clean.trim() || "persona";
  return clean.slice(0, 60);
}

/**
 * Build the export card + PNG. Never throws for missing avatar — falls
 * back to a generated 1x1 canvas.
 */
export async function exportCharaCardPng(
  persona: Persona,
  tags: PersonaTag[],
  deps: CharaExportDeps = {},
): Promise<CharaExportResult> {
  const data = personaToCardData(persona, tags);
  const card: CharaCard = { spec: "chara_card_v2", spec_version: "2.0", data };
  const v2json = serializeCharaCard(card);
  const v3json = serializeCharaCard(toV3(card));

  let canvas: Uint8Array | null = null;
  if (deps.resolveAvatarPng) {
    try {
      canvas = await deps.resolveAvatarPng(persona.avatar);
    } catch {
      canvas = null;
    }
  }
  let chunks = null as null | ReturnType<typeof parsePngChunks>;
  if (canvas) {
    try {
      chunks = parsePngChunks(canvas);
    } catch (e) {
      if (e instanceof PngError) chunks = null;
      else throw e;
    }
  }
  const base = chunks ?? parsePngChunks(minimalPng());
  const stripped = stripCardChunks(base);
  const withCard = insertBeforeIend(stripped, [
    encodeTextChunk("chara", bytesToBase64(utf8Encode(v2json))),
    encodeTextChunk("ccv3", bytesToBase64(utf8Encode(v3json))),
  ]);
  const pngBytes = encodePng(withCard);
  return {
    pngBytes,
    pngBase64: bytesToBase64(pngBytes),
    cardJson: v2json,
    filename: `${safeFilename(persona.name)}-chara-card.png`,
    updatedPersona: withExportedCard(persona, data),
  };
}

/** Sanity helper used by tests: decode what an export wrote. */
export function decodeExportedPng(pngBase64: string): { chara: string; ccv3: string | null } {
  const bytes = base64ToBytes(pngBase64);
  const chunks = parsePngChunks(bytes);
  let chara: string | null = null;
  let ccv3: string | null = null;
  for (const ch of chunks) {
    if (ch.type !== "tEXt") continue;
    const nul = ch.data.indexOf(0);
    if (nul < 0) continue;
    let kw = "";
    for (let i = 0; i < nul; i++) kw += String.fromCharCode(ch.data[i]);
    let text = "";
    for (let i = nul + 1; i < ch.data.length; i++) text += String.fromCharCode(ch.data[i]);
    if (kw.toLowerCase() === "chara" && chara === null) chara = text;
    if (kw.toLowerCase() === "ccv3" && ccv3 === null) ccv3 = text;
  }
  if (!chara) throw new Error("exported PNG has no chara chunk");
  return { chara, ccv3 };
}
