/**
 * chara_card spec types + parser (SillyTavern character cards).
 *
 * Spec sources (2026-10-06): SillyTavern's src/character-card-parser.js
 * (via community docs) — PNG tEXt chunk keyword "chara" (v2 canonical,
 * base64 JSON), optional second tEXt chunk "ccv3" (v3, takes precedence
 * on read; ST writes it as a copy of v2 with mutated spec fields).
 * v1 cards are raw top-level fields with no spec wrapper.
 *
 * PURE module: no React Native imports.
 */

export type CharaSpec = "chara_card_v2" | "chara_card_v3" | "chara_card_v1";

export interface LorebookEntry {
  keys: string[];
  secondary_keys?: string[];
  content: string;
  enabled: boolean;
  constant?: boolean;
  selective?: boolean;
  position?: string;
  /** Unknown extra keys are preserved, not dropped. */
  [k: string]: unknown;
}

export interface CharacterBook {
  name?: string;
  entries: LorebookEntry[];
  [k: string]: unknown;
}

export interface CharaCardData {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creator_notes: string;
  system_prompt: string;
  post_history_instructions: string;
  alternate_greetings: string[];
  tags: string[];
  creator: string;
  character_version: string;
  character_book?: CharacterBook | null;
  extensions: Record<string, unknown>;
  /** v3 additions (may also appear on v2 files in the wild). */
  nickname?: string;
  group_only_greetings?: string[];
  assets?: unknown[];
  create_date?: string;
}

export interface CharaCard {
  spec: CharaSpec;
  spec_version: string;
  data: CharaCardData;
}

export type CardParseCode = "not-json" | "unsupported-spec" | "invalid-shape" | "no-name";

export type CardParseResult =
  | { ok: true; card: CharaCard }
  | { ok: false; code: CardParseCode; detail?: string };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function parseLorebookEntry(raw: unknown): LorebookEntry | null {
  if (!isObj(raw)) return null;
  const content = str(raw.content);
  if (!content) return null;
  const entry: LorebookEntry = {
    keys: strArr(raw.keys),
    content,
    enabled: raw.enabled !== false,
  };
  if (Array.isArray(raw.secondary_keys)) entry.secondary_keys = strArr(raw.secondary_keys);
  if (typeof raw.constant === "boolean") entry.constant = raw.constant;
  if (typeof raw.selective === "boolean") entry.selective = raw.selective;
  if (typeof raw.position === "string") entry.position = raw.position;
  for (const k of Object.keys(raw)) {
    if (!(k in entry)) entry[k] = raw[k];
  }
  return entry;
}

function parseData(raw: unknown): CharaCardData | null {
  if (!isObj(raw)) return null;
  const data: CharaCardData = {
    name: str(raw.name).trim(),
    description: str(raw.description),
    personality: str(raw.personality),
    scenario: str(raw.scenario),
    first_mes: str(raw.first_mes),
    mes_example: str(raw.mes_example),
    creator_notes: str(raw.creator_notes),
    system_prompt: str(raw.system_prompt),
    post_history_instructions: str(raw.post_history_instructions),
    alternate_greetings: strArr(raw.alternate_greetings),
    tags: strArr(raw.tags),
    creator: str(raw.creator),
    character_version: str(raw.character_version) || "1.0",
    extensions: isObj(raw.extensions) ? (raw.extensions as Record<string, unknown>) : {},
  };
  if (isObj(raw.character_book) && Array.isArray(raw.character_book.entries)) {
    const entries = raw.character_book.entries
      .map(parseLorebookEntry)
      .filter((e): e is LorebookEntry => e !== null);
    data.character_book = {
      ...(typeof raw.character_book.name === "string" ? { name: raw.character_book.name } : {}),
      entries,
    };
    for (const k of Object.keys(raw.character_book)) {
      if (k !== "name" && k !== "entries")
        (data.character_book as Record<string, unknown>)[k] = raw.character_book[k];
    }
  } else if (raw.character_book != null && raw.character_book !== undefined) {
    // Present but malformed — keep the marker, drop the broken body.
    data.character_book = { entries: [] };
  }
  if (typeof raw.nickname === "string") data.nickname = raw.nickname;
  if (Array.isArray(raw.group_only_greetings))
    data.group_only_greetings = strArr(raw.group_only_greetings);
  if (Array.isArray(raw.assets)) data.assets = raw.assets;
  if (typeof raw.create_date === "string") data.create_date = raw.create_date;
  return data;
}

/**
 * Parse chara_card JSON (already decoded from base64 / file text).
 * Accepts v2, v3, and v1 (raw top-level fields). Never half-parses:
 * unknown spec strings are rejected cleanly.
 */
export function parseCharaCardJson(text: string): CardParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, code: "not-json" };
  }
  if (!isObj(raw))
    return { ok: false, code: "invalid-shape", detail: "top level is not an object" };

  const specRaw = typeof raw.spec === "string" ? raw.spec : "";
  if (specRaw === "chara_card_v2" || specRaw === "chara_card_v3") {
    const data = parseData(raw.data);
    if (!data) return { ok: false, code: "invalid-shape", detail: "data is not an object" };
    if (!data.name) return { ok: false, code: "no-name", detail: "data.name is empty" };
    return {
      ok: true,
      card: {
        spec: specRaw,
        spec_version:
          typeof raw.spec_version === "string"
            ? raw.spec_version
            : specRaw === "chara_card_v3"
              ? "3.0"
              : "2.0",
        data,
      },
    };
  }
  if (specRaw) {
    return { ok: false, code: "unsupported-spec", detail: `spec=${specRaw}` };
  }
  // v1: raw fields at top level, no spec wrapper.
  if (typeof raw.name === "string" || typeof raw.first_mes === "string") {
    const data = parseData(raw);
    if (!data?.name) return { ok: false, code: "no-name", detail: "v1 card has no name" };
    return { ok: true, card: { spec: "chara_card_v1", spec_version: "1.0", data } };
  }
  return { ok: false, code: "invalid-shape", detail: "not a character card" };
}

/** Serialize a card to canonical JSON (v2 wrapper). */
export function serializeCharaCard(card: CharaCard): string {
  return JSON.stringify({ spec: card.spec, spec_version: card.spec_version, data: card.data });
}

/** v3 view of a card: same data, mutated spec fields (ST's ccv3 convention). */
export function toV3(card: CharaCard): CharaCard {
  return { spec: "chara_card_v3", spec_version: "3.0", data: card.data };
}
