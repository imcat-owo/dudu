/**
 * chara_card AI tools — let her move character cards in/out by voice.
 * "凡事儿我能对他喊话，他能做到的，都能在对话框里完成。"
 *
 * PURE module: no React Native imports. File I/O and store access are
 * injected via CharaToolDeps; the real wiring lives in local-agent.ts.
 */

import type { LocalTool } from "../api-groups/local-tools";
import { ToolError } from "../api-groups/local-tools";
import type { Persona, PersonaTag } from "../persona/types";
import type { WorldBook } from "../persona/world-book";
import { exportCharaCardPng } from "./export";
import { importCharaCard, previewCharaCard } from "./import";

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

export interface CharaToolDeps {
  personaStore: {
    upsert(p: Persona): Promise<string | null>;
    get(id: string): Promise<Persona | null>;
    list(): Promise<Persona[]>;
    listTags(): Promise<PersonaTag[]>;
    createTag(name: string): Promise<PersonaTag>;
  };
  worldBookStore: {
    upsert(book: WorldBook): Promise<void>;
  };
  /** Persist the card PNG bytes as the new persona's avatar; returns the avatar path. */
  saveAvatarPng?: (bytes: Uint8Array, name: string) => Promise<string | null>;
  /** Resolve a persona avatar to PNG bytes for export embedding. */
  resolveAvatarPng?: (avatar: string | null) => Promise<Uint8Array | null>;
  /** Persist the exported card PNG somewhere she can reach; returns a human hint. */
  saveCardFile: (filename: string, pngBase64: string) => Promise<string>;
}

const IMPORT_CODE_HINTS: Record<string, string> = {
  empty: "The file is empty.",
  "not-png": "That doesn't look like a PNG file.",
  "no-card-chunk": "This PNG has no character card inside (no chara/ccv3 chunk).",
  "compressed-unsupported":
    "This card uses compressed metadata, which isn't supported — ask her for a standard card PNG.",
  "bad-base64": "The file data is corrupt.",
  "not-json": "The card data isn't valid JSON.",
  "unsupported-spec": "This card uses a newer spec version — update the app first.",
  "invalid-shape": "The card file is corrupt.",
  "no-name": "The card has no character name.",
  "store-failed": "Couldn't save the new persona.",
};

function looksLikePngBase64(text: string): boolean {
  // PNG files start with the 8-byte signature 89 50 4E 47 0D 0A 1A 0A.
  return text.startsWith("iVBORw0KGgo");
}

export function createCharaTools(deps: CharaToolDeps): LocalTool[] {
  return [
    {
      name: "chara_import",
      description:
        "Import a SillyTavern character card (chara_card v2/v3 PNG, or raw card JSON) as a new Dudu persona. Use when she says '导入角色卡' / '把这张卡变成人设'. Pass the file content in file_content: base64 for a PNG card, raw text for a .json card (auto-detected). The card's name/personality/scenario/greeting become a real persona; its lorebook is saved as a DISABLED world book she can enable herself. Importing never touches her existing personas.",
      parameters: {
        type: "object",
        properties: {
          file_content: {
            type: "string",
            description:
              "Full file content: base64 of the card PNG, or the raw JSON text of a .json card. Required.",
          },
          file_name: {
            type: "string",
            description: "Original filename (helps detection), e.g. 'elena.png'. Optional.",
          },
        },
        required: ["file_content"],
        additionalProperties: false,
      },
      manualId: "chara",
      run: async (args) => {
        const content = strArg(args, "file_content").trim();
        if (!content) {
          throw new ToolError("No file_content provided. Ask her for the character card file.");
        }
        const input = looksLikePngBase64(content) ? { pngBase64: content } : { jsonText: content };
        const outcome = await importCharaCard(input, {
          personaStore: deps.personaStore,
          worldBookStore: deps.worldBookStore,
        });
        if (!outcome.ok) {
          throw new ToolError(
            `Card import failed: ${IMPORT_CODE_HINTS[outcome.code] ?? outcome.code}${outcome.detail ? ` ${outcome.detail}` : ""} Nothing was changed.`,
          );
        }
        // The card art becomes the persona's avatar when we can save it.
        if (outcome.pngBytes && deps.saveAvatarPng) {
          try {
            const avatarPath = await deps.saveAvatarPng(outcome.pngBytes, outcome.personaName);
            if (avatarPath) {
              const p = await deps.personaStore.get(outcome.personaId);
              if (p) await deps.personaStore.upsert({ ...p, avatar: avatarPath });
            }
          } catch {
            // Avatar is a nice-to-have; the persona itself is already created.
          }
        }
        const lines = [
          `Imported character card as persona "${outcome.personaName}" (${outcome.spec}).`,
        ];
        if (outcome.tagsCreated > 0) lines.push(`${outcome.tagsCreated} new tag(s) created.`);
        if (outcome.lorebookEntries > 0) {
          lines.push(
            `${outcome.lorebookEntries} lorebook entries saved as a DISABLED world book — she can enable it in 人设 settings if she wants the lore in chats.`,
          );
        }
        return lines.join("\n");
      },
    },
    {
      name: "chara_export",
      description:
        "Export a Dudu persona as a SillyTavern character card PNG (chara_card v2 + v3 chunks embedded, readable by SillyTavern and other tavern apps). Use when she says '导出角色卡' / '把这个人设做成卡'. Pass the persona name or id in persona. The card art is the persona's avatar when it's a PNG, otherwise a blank canvas.",
      parameters: {
        type: "object",
        properties: {
          persona: {
            type: "string",
            description: "Persona name or id to export. Required.",
          },
        },
        required: ["persona"],
        additionalProperties: false,
      },
      manualId: "chara",
      run: async (args) => {
        const query = strArg(args, "persona").trim();
        if (!query) throw new ToolError("No persona given. Ask her which persona to export.");
        const all = await deps.personaStore.list();
        const persona =
          all.find((p) => p.id === query) ??
          all.find((p) => p.name === query) ??
          all.find((p) => p.name.toLowerCase() === query.toLowerCase());
        if (!persona) {
          throw new ToolError(`No persona named "${query}". List her personas and ask which one.`);
        }
        const tags = await deps.personaStore.listTags();
        const result = await exportCharaCardPng(persona, tags, {
          resolveAvatarPng: deps.resolveAvatarPng,
        });
        // Persist the refreshed stored card so a later export stays lossless.
        await deps.personaStore.upsert(result.updatedPersona).catch(() => {});
        const hint = await deps.saveCardFile(result.filename, result.pngBase64);
        return `Exported "${persona.name}" as a character card (${result.filename}) — ${hint}`;
      },
    },
    {
      name: "chara_preview",
      description:
        "Peek at a character card file WITHOUT importing it: shows the character name, spec version, and which fields would be mapped. Use when she asks '这张卡是什么' / wants to check a card before deciding. Same file_content convention as chara_import.",
      parameters: {
        type: "object",
        properties: {
          file_content: {
            type: "string",
            description: "Full file content: base64 of the card PNG, or raw JSON text. Required.",
          },
        },
        required: ["file_content"],
        additionalProperties: false,
      },
      manualId: "chara",
      run: async (args) => {
        const content = strArg(args, "file_content").trim();
        if (!content) throw new ToolError("No file_content provided.");
        const input = looksLikePngBase64(content) ? { pngBase64: content } : { jsonText: content };
        const preview = previewCharaCard(input);
        if (!preview.ok) {
          throw new ToolError(
            `Not a readable card: ${IMPORT_CODE_HINTS[preview.code] ?? preview.code}${preview.detail ? ` ${preview.detail}` : ""}`,
          );
        }
        const d = preview.card.data;
        const lines = [
          `Card: "${d.name}" (${preview.card.spec}${preview.fromPng ? ", from PNG" : ", from JSON"}).`,
          `Creator: ${d.creator || "unknown"}${d.character_version ? `, version ${d.character_version}` : ""}.`,
        ];
        const fields = [
          d.description && "description",
          d.personality && "personality",
          d.scenario && "scenario",
          d.first_mes && "first_mes",
          d.mes_example && "mes_example",
          d.system_prompt && "system_prompt",
          d.tags.length > 0 && `tags(${d.tags.length})`,
          d.alternate_greetings.length > 0 &&
            `alternate_greetings(${d.alternate_greetings.length})`,
          d.character_book && `lorebook(${d.character_book.entries.length})`,
        ].filter(Boolean);
        lines.push(`Fields: ${fields.join(", ") || "name only"}.`);
        return lines.join("\n");
      },
    },
  ];
}
