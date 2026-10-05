/**
 * chara_card import engine: PNG card / raw JSON -> real Dudu persona.
 *
 * PURE module: no React Native imports. Storage side-effects are injected,
 * and NOTHING is written until the card is fully parsed and validated
 * (corrupt input = clean error, zero writes).
 */

import type { Persona, PersonaTag } from "../persona/types.js";
import type { WorldBook } from "../persona/world-book.js";
import { type CardParseResult, type CharaCard, parseCharaCardJson } from "./card.js";
import { cardToPersona } from "./persona-map.js";
import {
  base64ToBytes,
  type PngChunk,
  PngError,
  parsePngChunks,
  scanCardChunks,
  utf8Decode,
} from "./png.js";

export type CharaImportCode =
  | "empty"
  | "not-png"
  | "no-card-chunk"
  | "compressed-unsupported"
  | "bad-base64"
  | "not-json"
  | "unsupported-spec"
  | "invalid-shape"
  | "no-name"
  | "store-failed";

export interface CharaImportSuccess {
  ok: true;
  personaId: string;
  personaName: string;
  spec: string;
  /** Field mapping summary for the UI ("mapped X, kept Y in card"). */
  tagsCreated: number;
  lorebookEntries: number;
  notes: string[];
  /** The source PNG bytes (for avatar saving), if input was a PNG. */
  pngBytes: Uint8Array | null;
}

export type CharaImportResult =
  | CharaImportSuccess
  | { ok: false; code: CharaImportCode; detail?: string };

export interface CharaImportDeps {
  personaStore: {
    upsert(p: Persona): Promise<string | null>;
    listTags(): Promise<PersonaTag[]>;
    createTag(name: string): Promise<PersonaTag>;
  };
  worldBookStore: {
    upsert(book: WorldBook): Promise<void>;
  };
  nowMs?: () => number;
}

/** Extract card JSON text from raw input. Pure; no writes. */
export function extractCardJson(input: {
  pngBase64?: string;
  jsonText?: string;
}):
  | { ok: true; json: string; spec: "png" | "json"; pngBytes: Uint8Array | null }
  | { ok: false; code: CharaImportCode; detail?: string } {
  const rawPng = (input.pngBase64 ?? "").trim();
  const rawJson = (input.jsonText ?? "").trim();
  if (!rawPng && !rawJson) return { ok: false, code: "empty" };

  if (rawPng) {
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(rawPng);
    } catch {
      return { ok: false, code: "bad-base64" };
    }
    let chunks: PngChunk[];
    try {
      chunks = parsePngChunks(bytes);
    } catch (e) {
      if (e instanceof PngError) return { ok: false, code: "not-png", detail: e.code };
      return { ok: false, code: "not-png" };
    }
    const scan = scanCardChunks(chunks);
    // v3 (ccv3) takes precedence on read, per ST's parser.
    const b64 = scan.ccv3 ?? scan.chara;
    if (b64 === null) {
      if (scan.compressedFound) return { ok: false, code: "compressed-unsupported" };
      return { ok: false, code: "no-card-chunk" };
    }
    let jsonBytes: Uint8Array;
    try {
      jsonBytes = base64ToBytes(b64);
    } catch {
      return { ok: false, code: "bad-base64", detail: "card chunk" };
    }
    let json: string;
    try {
      json = utf8Decode(jsonBytes);
    } catch {
      return { ok: false, code: "not-json", detail: "card chunk is not UTF-8" };
    }
    return { ok: true, json, spec: "png", pngBytes: bytes };
  }
  return { ok: true, json: rawJson, spec: "json", pngBytes: null };
}

/** Parse + validate only (no writes) — used for the preview step. */
export function previewCharaCard(input: {
  pngBase64?: string;
  jsonText?: string;
}):
  | { ok: true; card: CharaCard; fromPng: boolean }
  | { ok: false; code: CharaImportCode; detail?: string } {
  const extracted = extractCardJson(input);
  if (!extracted.ok) return extracted;
  const parsed: CardParseResult = parseCharaCardJson(extracted.json);
  if (!parsed.ok) return { ok: false, code: parsed.code, detail: parsed.detail };
  return { ok: true, card: parsed.card, fromPng: extracted.spec === "png" };
}

/**
 * Full import: parse, validate, then create the persona (+ tags +
 * disabled lorebook). Zero writes happen before validation passes.
 */
export async function importCharaCard(
  input: { pngBase64?: string; jsonText?: string },
  deps: CharaImportDeps,
): Promise<CharaImportResult> {
  const preview = previewCharaCard(input);
  if (!preview.ok) return preview;
  const { card } = preview;
  const nowMs = deps.nowMs ? deps.nowMs() : Date.now();

  const mapped = cardToPersona(card, nowMs);
  const persona = mapped.persona;

  try {
    // Tags: reuse existing ones by name (case-insensitive), create the rest.
    const existing = await deps.personaStore.listTags();
    const byName = new Map(existing.map((t) => [t.name.toLowerCase(), t]));
    let tagsCreated = 0;
    for (const name of mapped.newTags) {
      const hit = byName.get(name.toLowerCase());
      if (hit) {
        if (!persona.tagIds.includes(hit.id)) persona.tagIds.push(hit.id);
      } else {
        const created = await deps.personaStore.createTag(name);
        byName.set(name.toLowerCase(), created);
        persona.tagIds.push(created.id);
        tagsCreated++;
      }
    }

    const err = await deps.personaStore.upsert(persona);
    if (err) return { ok: false, code: "store-failed", detail: err };

    let lorebookEntries = 0;
    if (mapped.worldBook) {
      await deps.worldBookStore.upsert(mapped.worldBook);
      lorebookEntries = mapped.worldBook.entries.length;
    }

    const extracted = extractCardJson(input);
    return {
      ok: true,
      personaId: persona.id,
      personaName: persona.name,
      spec: card.spec,
      tagsCreated,
      lorebookEntries,
      notes: mapped.notes,
      pngBytes: extracted.ok ? extracted.pngBytes : null,
    };
  } catch (e) {
    return { ok: false, code: "store-failed", detail: e instanceof Error ? e.message : String(e) };
  }
}
