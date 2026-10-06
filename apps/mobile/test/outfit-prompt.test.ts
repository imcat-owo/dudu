/**
 * Outfit / dress-up system （换装系统） — honest end-to-end simulation.
 *
 * The chain under test (no mocks of the chain itself):
 *   she sets "奶油白卫衣" active
 *     → getActiveOutfitDescription returns "oversized cream sweater, ..."
 *     → buildCharacterRef(persona, outfit) pins it as "current outfit: ..."
 *   she deletes the outfit
 *     → the character ref no longer mentions it
 *
 * This is the prompt-level guarantee the whole system rests on: the
 * worn outfit REALLY flows into the photo prompt, and removing it
 * REALLY takes it back out.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OutfitStore } from "../src/outfit/store.js";
import type { Persona } from "../src/persona/types.js";
import { buildCharacterRef } from "../src/photoshare/decide.js";

const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);

function fakeKv() {
  const map = new Map<string, string>();
  return {
    getItem: async (k: string) => map.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

const PERSONA = {
  id: "p1",
  name: "小梦",
  description: "a young man with soft black hair",
  personality: "gentle, a little lazy",
  background: "",
} as unknown as Persona;

describe("outfit → photo prompt (honest simulation)", () => {
  it("active outfit is pinned into the character ref; deletion removes it", async () => {
    const store = new OutfitStore(fakeKv(), { nowMs: () => NOW });

    // No outfit: the ref has no outfit line.
    const bare = buildCharacterRef(PERSONA, await store.getActiveOutfitDescription("p1"));
    assert.ok(!bare.includes("current outfit"), `bare ref leaked an outfit: ${bare}`);

    // She sets the cream sweater active.
    const outfit = await store.add("p1", {
      name: "奶油白卫衣",
      description: "oversized cream sweater, plaid skirt, white socks",
      createdBy: "her",
    });
    await store.setActive("p1", outfit.id);

    const desc = await store.getActiveOutfitDescription("p1");
    assert.equal(desc, "oversized cream sweater, plaid skirt, white socks");
    const dressed = buildCharacterRef(PERSONA, desc);
    assert.ok(
      dressed.includes("current outfit: oversized cream sweater, plaid skirt, white socks"),
      `outfit missing from ref: ${dressed}`,
    );
    // The rest of the character ref still survives.
    assert.ok(dressed.includes("soft black hair"));

    // She deletes it: the prompt no longer mentions it.
    await store.remove("p1", outfit.id);
    const after = buildCharacterRef(PERSONA, await store.getActiveOutfitDescription("p1"));
    assert.ok(!after.includes("cream sweater"), `deleted outfit still in ref: ${after}`);
    assert.ok(!after.includes("current outfit"));
  });

  it("buildCharacterRef stays backward compatible without an outfit", () => {
    const ref = buildCharacterRef(PERSONA);
    assert.ok(ref.includes("soft black hair"));
    assert.ok(!ref.includes("current outfit"));
  });
});
