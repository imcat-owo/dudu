import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type CharaCard, parseCharaCardJson, serializeCharaCard, toV3 } from "../src/chara/card.js";
import { decodeExportedPng, exportCharaCardPng } from "../src/chara/export.js";
import { importCharaCard, previewCharaCard } from "../src/chara/import.js";
import {
  cardToPersona,
  getImportedCard,
  personaToCardData,
  splitBackground,
} from "../src/chara/persona-map.js";
import {
  base64ToBytes,
  bytesToBase64,
  decodeTextChunk,
  encodePng,
  encodeTextChunk,
  insertBeforeIend,
  minimalPng,
  PngError,
  parsePngChunks,
  scanCardChunks,
  stripCardChunks,
  utf8Decode,
  utf8Encode,
} from "../src/chara/png.js";
import type { Persona, PersonaTag } from "../src/persona/types.js";
import { blankPersona } from "../src/persona/types.js";
import type { WorldBook } from "../src/persona/world-book.js";

const V2_CARD = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Elena",
    description: "A starship navigator with silver hair.",
    personality: "Curious, brave, a little reckless.",
    scenario: "On the bridge of the starship Aurora.",
    first_mes: "Welcome aboard, traveler.",
    mes_example: "<START>\n{{user}}: Hi\n{{char}}: Hello there!",
    creator_notes: "v1 release",
    system_prompt: "You are Elena.",
    post_history_instructions: "Stay in character.",
    alternate_greetings: ["Hey.", "Oh, a visitor!"],
    character_book: {
      name: "Aurora lore",
      entries: [
        {
          keys: ["Aurora"],
          secondary_keys: ["starship"],
          content: "The Aurora is fast.",
          enabled: true,
          position: "before_char",
        },
        { keys: ["Xenon"], content: "A fuel.", enabled: false },
      ],
    },
    tags: ["sci-fi", "navigator"],
    creator: "tester",
    character_version: "1.0",
    extensions: { talkativeness: 0.7, fav: true },
  },
};

function cardPng(cardJson: string, withV3: boolean): Uint8Array {
  const b64 = bytesToBase64(utf8Encode(cardJson));
  const chunks = insertBeforeIend(parsePngChunks(minimalPng()), [
    encodeTextChunk("chara", b64),
    ...(withV3
      ? [
          encodeTextChunk(
            "ccv3",
            bytesToBase64(
              utf8Encode(
                JSON.stringify({
                  ...JSON.parse(cardJson),
                  spec: "chara_card_v3",
                  spec_version: "3.0",
                }),
              ),
            ),
          ),
        ]
      : []),
  ]);
  return encodePng(chunks);
}

function fakeStores() {
  const personas: Persona[] = [];
  const tags: PersonaTag[] = [];
  const books: WorldBook[] = [];
  const writes: string[] = [];
  return {
    writes,
    personaStore: {
      async upsert(p: Persona) {
        writes.push(`persona:${p.id}`);
        const i = personas.findIndex((x) => x.id === p.id);
        if (i >= 0) personas[i] = p;
        else personas.push(p);
        return null;
      },
      async listTags() {
        return tags;
      },
      async createTag(name: string) {
        writes.push(`tag:${name}`);
        const t: PersonaTag = { id: `tag_${tags.length}`, name, createdAt: 1 };
        tags.push(t);
        return t;
      },
    },
    worldBookStore: {
      async upsert(b: WorldBook) {
        writes.push(`book:${b.id}`);
        books.push(b);
      },
    },
    personas,
    tags,
    books,
  };
}

describe("png chunk layer", () => {
  it("round-trips a tEXt card chunk through parse/encode", () => {
    const png = cardPng(JSON.stringify(V2_CARD), false);
    const chunks = parsePngChunks(png);
    const scan = scanCardChunks(chunks);
    assert.ok(scan.chara);
    assert.equal(scan.ccv3, null);
    const json = utf8Decode(base64ToBytes(scan.chara));
    assert.equal(JSON.parse(json).data.name, "Elena");
  });

  it("prefers ccv3 over chara on read", () => {
    const v3 = {
      ...V2_CARD,
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: { ...V2_CARD.data, nickname: "El" },
    };
    const png = cardPng(JSON.stringify(V2_CARD), true);
    // overwrite the ccv3 chunk text with the v3 variant
    const chunks = parsePngChunks(png);
    const stripped = stripCardChunks(chunks);
    const withBoth = insertBeforeIend(stripped, [
      encodeTextChunk("chara", bytesToBase64(utf8Encode(JSON.stringify(V2_CARD)))),
      encodeTextChunk("ccv3", bytesToBase64(utf8Encode(JSON.stringify(v3)))),
    ]);
    const scan = scanCardChunks(parsePngChunks(encodePng(withBoth)));
    assert.ok(scan.ccv3);
    assert.equal(JSON.parse(utf8Decode(base64ToBytes(scan.ccv3))).data.nickname, "El");
  });

  it("rejects non-PNG bytes", () => {
    assert.throws(
      () => parsePngChunks(new Uint8Array([1, 2, 3])),
      (e: unknown) => e instanceof PngError && e.code === "not-png",
    );
  });

  it("rejects truncated PNG", () => {
    const png = cardPng(JSON.stringify(V2_CARD), false);
    assert.throws(
      () => parsePngChunks(png.slice(0, 20)),
      (e: unknown) => e instanceof PngError,
    );
  });

  it("decodeTextChunk round-trips keyword/text", () => {
    const ch = encodeTextChunk("chara", "aGVsbG8=");
    const d = decodeTextChunk(ch.data);
    assert.equal(d.keyword, "chara");
    assert.equal(d.text, "aGVsbG8=");
  });

  it("minimalPng is a structurally valid PNG", () => {
    const chunks = parsePngChunks(minimalPng());
    assert.deepEqual(
      chunks.map((c) => c.type),
      ["IHDR", "IDAT", "IEND"],
    );
  });
});

describe("card parser", () => {
  it("parses v2", () => {
    const r = parseCharaCardJson(JSON.stringify(V2_CARD));
    assert.ok(r.ok);
    assert.equal(r.card.spec, "chara_card_v2");
    assert.equal(r.card.data.name, "Elena");
    assert.equal(r.card.data.character_book?.entries.length, 2);
  });

  it("parses v3 with v3-only fields", () => {
    const v3 = {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        ...V2_CARD.data,
        nickname: "El",
        assets: [{ type: "sprite" }],
        group_only_greetings: ["Hi all"],
      },
    };
    const r = parseCharaCardJson(JSON.stringify(v3));
    assert.ok(r.ok);
    assert.equal(r.card.spec, "chara_card_v3");
    assert.equal(r.card.data.nickname, "El");
    assert.equal(r.card.data.assets?.length, 1);
  });

  it("parses v1 raw fields", () => {
    const v1 = { name: "Bob", first_mes: "Hi", description: "d" };
    const r = parseCharaCardJson(JSON.stringify(v1));
    assert.ok(r.ok);
    assert.equal(r.card.spec, "chara_card_v1");
  });

  it("rejects unknown spec cleanly", () => {
    const r = parseCharaCardJson(JSON.stringify({ spec: "chara_card_v9", data: { name: "X" } }));
    assert.ok(!r.ok && r.code === "unsupported-spec");
  });

  it("rejects nameless cards", () => {
    const r = parseCharaCardJson(JSON.stringify({ spec: "chara_card_v2", data: { name: " " } }));
    assert.ok(!r.ok && r.code === "no-name");
  });

  it("rejects non-JSON", () => {
    const r = parseCharaCardJson("not json{");
    assert.ok(!r.ok && r.code === "not-json");
  });

  it("toV3 mutates only spec fields", () => {
    const r = parseCharaCardJson(JSON.stringify(V2_CARD));
    assert.ok(r.ok);
    const v3 = toV3(r.card);
    assert.equal(v3.spec, "chara_card_v3");
    assert.equal(v3.spec_version, "3.0");
    assert.deepEqual(v3.data, r.card.data);
    assert.equal(serializeCharaCard(r.card).includes("chara_card_v2"), true);
  });
});

describe("import engine", () => {
  it("imports a PNG card into a real persona with mapped fields", async () => {
    const stores = fakeStores();
    const pngB64 = bytesToBase64(cardPng(JSON.stringify(V2_CARD), false));
    const out = await importCharaCard({ pngBase64: pngB64 }, stores);
    assert.ok(out.ok);
    assert.equal(out.personaName, "Elena");
    assert.equal(out.spec, "chara_card_v2");
    const p = stores.personas[0];
    assert.equal(p.greeting, "Welcome aboard, traveler.");
    assert.equal(p.personality, "Curious, brave, a little reckless.");
    assert.ok(p.background.includes("On the bridge of the starship Aurora."));
    assert.equal(p.exampleDialogue, V2_CARD.data.mes_example);
    assert.equal(p.systemPrompt, "You are Elena.");
    assert.deepEqual(
      p.tagIds,
      stores.tags.map((t) => t.id),
    );
    assert.deepEqual(
      stores.tags.map((t) => t.name),
      ["sci-fi", "navigator"],
    );
    // lorebook -> disabled world book
    assert.equal(stores.books.length, 1);
    assert.equal(stores.books[0].enabled, false);
    assert.equal(stores.books[0].entries.length, 2);
    assert.deepEqual(stores.books[0].entries[0].keywords, ["Aurora", "starship"]);
    // original card preserved for extras/export
    const back = getImportedCard(p);
    assert.ok(back);
    assert.equal((back.data.extensions as Record<string, unknown>).talkativeness, 0.7);
  });

  it("imports raw JSON cards", async () => {
    const stores = fakeStores();
    const out = await importCharaCard({ jsonText: JSON.stringify(V2_CARD) }, stores);
    assert.ok(out.ok);
    assert.equal(out.personaName, "Elena");
    assert.equal(out.pngBytes, null);
  });

  it("zero writes on corrupt input", async () => {
    const cases: Array<{ pngBase64?: string; jsonText?: string }> = [
      { pngBase64: "" },
      { pngBase64: "aGVsbG8=" }, // valid base64, not a PNG
      { pngBase64: bytesToBase64(minimalPng()) }, // PNG without card
      { jsonText: "{oops" },
      { jsonText: JSON.stringify({ spec: "chara_card_v9", data: {} }) },
    ];
    for (const input of cases) {
      const stores = fakeStores();
      const out = await importCharaCard(input, stores);
      assert.ok(!out.ok, JSON.stringify(input).slice(0, 40));
      assert.equal(
        stores.writes.length,
        0,
        `writes happened for ${out.ok ? "ok" : (out as { code: string }).code}`,
      );
    }
  });

  it("preview does not write", async () => {
    const stores = fakeStores();
    const pv = previewCharaCard({ jsonText: JSON.stringify(V2_CARD) });
    assert.ok(pv.ok);
    assert.equal(pv.card.data.name, "Elena");
    assert.equal(stores.writes.length, 0);
  });

  it("splitBackground round-trips the scenario marker", () => {
    const { persona } = cardToPersona(
      parseCharaCardJson(JSON.stringify(V2_CARD)).ok
        ? (parseCharaCardJson(JSON.stringify(V2_CARD)) as { ok: true; card: CharaCard }).card
        : ({} as CharaCard),
      1,
    );
    const { description, scenario } = splitBackground(persona.background);
    assert.equal(description, V2_CARD.data.description);
    assert.equal(scenario, V2_CARD.data.scenario);
  });
});

describe("export engine", () => {
  it("exports a persona to a valid card PNG and re-imports cleanly", async () => {
    const stores = fakeStores();
    const pngB64 = bytesToBase64(cardPng(JSON.stringify(V2_CARD), false));
    const imp = await importCharaCard({ pngBase64: pngB64 }, stores);
    assert.ok(imp.ok);
    const persona = stores.personas[0];

    const exp = await exportCharaCardPng(persona, stores.tags, {});
    const decoded = decodeExportedPng(exp.pngBase64);
    // v2 chunk parses, v3 chunk exists and takes precedence shape
    const v2 = parseCharaCardJson(utf8Decode(base64ToBytes(decoded.chara)));
    assert.ok(v2.ok && v2.card.spec === "chara_card_v2");
    assert.ok(decoded.ccv3);
    const v3 = parseCharaCardJson(utf8Decode(base64ToBytes(decoded.ccv3)));
    assert.ok(v3.ok && v3.card.spec === "chara_card_v3");

    // re-import the exported PNG
    const stores2 = fakeStores();
    const re = await importCharaCard({ pngBase64: exp.pngBase64 }, stores2);
    assert.ok(re.ok);
    const p2 = stores2.personas[0];
    assert.equal(p2.name, persona.name);
    assert.equal(p2.greeting, persona.greeting);
    assert.equal(p2.personality, persona.personality);
    assert.equal(p2.background, persona.background);
    assert.equal(p2.systemPrompt, persona.systemPrompt);
  });

  it("exports a native persona (no imported card) without crashing", async () => {
    const p = blankPersona();
    p.name = "Native";
    p.greeting = "Hi";
    const exp = await exportCharaCardPng(p, [], {});
    const decoded = decodeExportedPng(exp.pngBase64);
    const v2 = parseCharaCardJson(utf8Decode(base64ToBytes(decoded.chara)));
    assert.ok(v2.ok);
    assert.equal(v2.card.data.name, "Native");
    assert.equal(v2.card.data.creator, "");
  });

  it("embeds into an existing avatar PNG when resolvable", async () => {
    const p = blankPersona();
    p.name = "Av";
    const avatarPng = cardPng(JSON.stringify(V2_CARD), false); // any PNG works as canvas
    const exp = await exportCharaCardPng(p, [], { resolveAvatarPng: async () => avatarPng });
    const decoded = decodeExportedPng(exp.pngBase64);
    assert.ok(decoded.chara);
    // only one chara chunk (old stripped, new inserted)
    const chunks = parsePngChunks(base64ToBytes(exp.pngBase64));
    const charaCount = chunks.filter((c) => {
      if (c.type !== "tEXt") return false;
      try {
        return decodeTextChunk(c.data).keyword.toLowerCase() === "chara";
      } catch {
        return false;
      }
    }).length;
    assert.equal(charaCount, 1);
  });

  it("personaToCardData preserves unmodeled fields from the original card", () => {
    const r = parseCharaCardJson(JSON.stringify(V2_CARD));
    assert.ok(r.ok);
    const { persona } = cardToPersona(r.card, 1);
    const data = personaToCardData(persona, []);
    assert.equal(data.creator_notes, "v1 release");
    assert.equal(data.post_history_instructions, "Stay in character.");
    assert.deepEqual(data.alternate_greetings, ["Hey.", "Oh, a visitor!"]);
    assert.equal((data.extensions as Record<string, unknown>).fav, true);
  });
});
