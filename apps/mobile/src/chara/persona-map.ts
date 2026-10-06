/**
 * chara_card <-> Dudu Persona field mapping.
 *
 * PURE module: no React Native imports.
 *
 * Import mapping (card -> persona):
 *   name                -> name (trimmed, max 50 per validatePersona)
 *   description         -> background (labeled) + short picker description
 *   scenario            -> background (labeled [Scenario] section)
 *   personality         -> personality
 *   first_mes           -> greeting
 *   mes_example         -> exampleDialogue
 *   system_prompt       -> systemPrompt
 *   tags                -> PersonaTag entries (created on demand)
 *   character_book      -> WorldBook (created DISABLED — Dudu world books are
 *                         global, so enabling it would leak lore into other
 *                         personas' chats; she can enable it herself)
 *   creator/creator_notes/character_version/alternate_greetings/
 *   post_history_instructions/nickname/group_only_greetings/assets/
 *   extensions/regex_scripts -> preserved verbatim in persona.importedCardJson
 *                         and shown in the "card extras" UI section
 *
 * Export mapping (persona -> card): Dudu-modeled fields are written from the
 * live persona; anything Dudu doesn't model is carried over from the
 * imported original card when present (lossless round-trip).
 */

import type { Persona, PersonaTag } from "../persona/types";
import { blankPersona, newPersonaId } from "../persona/types";
import type { WorldBook } from "../persona/world-book";
import { blankWorldBook, newWorldBookEntryId } from "../persona/world-book";
import type { CharaCard, CharaCardData, LorebookEntry } from "./card";

/** Marker separating the scenario block inside persona.background. */
export const SCENARIO_MARKER = "\n\n―― Scenario ――\n";

export interface MappedPersona {
  persona: Persona;
  /** Tag names that need creating (not already present). */
  newTags: string[];
  /** World book to create (disabled), or null when the card has no lorebook. */
  worldBook: WorldBook | null;
  /** Human-readable notes about what was mapped where (for the UI). */
  notes: string[];
}

/** Split an imported background back into description + scenario. */
export function splitBackground(background: string): { description: string; scenario: string } {
  const idx = background.indexOf(SCENARIO_MARKER);
  if (idx < 0) return { description: background, scenario: "" };
  return {
    description: background.slice(0, idx),
    scenario: background.slice(idx + SCENARIO_MARKER.length),
  };
}

function shortPickerDescription(data: CharaCardData): string {
  const nick = data.nickname?.trim();
  if (nick) return nick.slice(0, 60);
  const firstLine = (data.description || "").split("\n")[0].trim();
  if (firstLine.length <= 80) return firstLine;
  return `${firstLine.slice(0, 77)}…`;
}

function mapLorebookEntry(e: LorebookEntry, index: number): WorldBook["entries"][number] {
  return {
    id: newWorldBookEntryId(),
    name: e.keys.length > 0 ? e.keys.slice(0, 3).join(", ") : `entry ${index + 1}`,
    enabled: e.enabled !== false,
    priority: 100 - index,
    position: e.position === "after_char" ? "afterSystem" : "beforeSystem",
    role: "system",
    content: e.content,
    keywords: [...e.keys, ...(e.secondary_keys ?? [])],
    useRegex: false,
    caseSensitive: false,
    scanDepth: 10,
    constantActive: e.constant === true,
    sticky: 0,
    cooldown: 0,
    delay: 0,
  };
}

export function cardToPersona(card: CharaCard, nowMs: number): MappedPersona {
  const data = card.data;
  const notes: string[] = [];
  const p = blankPersona();
  p.id = newPersonaId();

  let name = data.name.trim();
  if (name.length > 50) {
    name = `${name.slice(0, 49)}…`;
    notes.push("name-truncated");
  }
  p.name = name;
  p.description = shortPickerDescription(data);
  p.background = data.description + (data.scenario ? SCENARIO_MARKER + data.scenario : "");
  p.personality = data.personality;
  p.greeting = data.first_mes;
  p.exampleDialogue = data.mes_example;
  p.systemPrompt = data.system_prompt;
  p.createdAt = nowMs;
  p.updatedAt = nowMs;

  const newTags = [...new Set(data.tags.map((t) => t.trim()).filter((t) => t.length > 0))];

  let worldBook: WorldBook | null = null;
  const book = data.character_book;
  if (book && book.entries.length > 0) {
    const wb = blankWorldBook();
    wb.name = `${data.name} · lorebook`;
    wb.description = `Imported from character card (${card.spec}). Disabled by default — enable it if you want this lore in chats.`;
    wb.enabled = false;
    wb.entries = book.entries.map(mapLorebookEntry);
    wb.createdAt = nowMs;
    wb.updatedAt = nowMs;
    worldBook = wb;
    notes.push(`lorebook:${book.entries.length}`);
  }

  if (data.alternate_greetings.length > 0)
    notes.push(`alt-greetings:${data.alternate_greetings.length}`);
  if (data.post_history_instructions) notes.push("post-history-instructions:kept-in-card");
  if (Object.keys(data.extensions).length > 0) notes.push("extensions:kept-in-card");
  if (data.assets && data.assets.length > 0)
    notes.push(`assets:${data.assets.length}:kept-in-card`);
  if (data.group_only_greetings && data.group_only_greetings.length > 0)
    notes.push(`group-only-greetings:${data.group_only_greetings.length}:kept-in-card`);

  // The full original card travels with the persona: lossless export + extras UI.
  p.importedCardJson = JSON.stringify({
    spec: card.spec,
    spec_version: card.spec_version,
    data: card.data,
  });

  return { persona: p, newTags, worldBook, notes };
}

/** Read back the stored original card, if any. */
export function getImportedCard(p: Persona): CharaCard | null {
  const raw = p.importedCardJson;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CharaCard;
    if (typeof parsed?.data?.name === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

function tagNames(tags: PersonaTag[], ids: string[]): string[] {
  const byId = new Map(tags.map((t) => [t.id, t.name]));
  return ids.map((id) => byId.get(id)).filter((n): n is string => !!n);
}

/**
 * Build export card data from a live persona. Dudu-modeled fields come from
 * the persona; unmodeled fields ride along from the imported original card.
 */
export function personaToCardData(p: Persona, tags: PersonaTag[]): CharaCardData {
  const orig = getImportedCard(p)?.data;
  const { description, scenario } = splitBackground(p.background || "");
  const data: CharaCardData = {
    name: p.name,
    description: description || p.description || "",
    personality: p.personality || "",
    scenario,
    first_mes: p.greeting || "",
    mes_example: p.exampleDialogue || "",
    creator_notes: orig?.creator_notes ?? "",
    system_prompt: p.systemPrompt || "",
    post_history_instructions: orig?.post_history_instructions ?? "",
    alternate_greetings: orig?.alternate_greetings ?? [],
    tags: tagNames(tags, p.tagIds),
    creator: orig?.creator ?? "",
    character_version: orig?.character_version ?? "1.0",
    extensions: orig?.extensions ?? {},
  };
  if (orig?.character_book) data.character_book = orig.character_book;
  if (orig?.nickname) data.nickname = orig.nickname;
  if (orig?.group_only_greetings) data.group_only_greetings = orig.group_only_greetings;
  if (orig?.assets) data.assets = orig.assets;
  if (orig?.create_date) data.create_date = orig.create_date;
  return data;
}

/** Update the stored original card after an export (keeps extras in sync). */
export function withExportedCard(p: Persona, data: CharaCardData): Persona {
  const next: Persona = {
    ...p,
    importedCardJson: JSON.stringify({ spec: "chara_card_v2", spec_version: "2.0", data }),
  };
  return next;
}
