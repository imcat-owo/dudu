/**
 * Outfit / dress-up system （换装系统） — store tests.
 *
 * Under test:
 *  1. add → wardrobe lists it; getWardrobe is per-persona.
 *  2. setActive → getActiveOutfit / getActiveOutfitDescription return it.
 *  3. Persona isolation: personaA's wardrobe never leaks to personaB;
 *     cross-persona outfit ids are refused by setActive.
 *  4. remove: deleting the active outfit clears the worn slot (null),
 *     never a random replacement; unknown ids return false.
 *  5. Validation via validateOutfitInput.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OutfitStore } from "../src/outfit/store.js";
import { validateOutfitInput } from "../src/outfit/types.js";

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

describe("outfit store", () => {
  it("add → wardrobe lists it, active starts empty", async () => {
    const s = new OutfitStore(fakeKv(), { nowMs: () => NOW });
    const o = await s.add("p1", {
      name: "奶油白卫衣",
      description: "oversized cream sweater, plaid skirt",
      createdBy: "her",
    });
    assert.ok(o.id.startsWith("outfit_"));
    const w = await s.getWardrobe("p1");
    assert.equal(w.outfits.length, 1);
    assert.equal(w.outfits[0].name, "奶油白卫衣");
    assert.equal(w.activeId, null);
    assert.equal(await s.getActiveOutfit("p1"), null);
    assert.equal(await s.getActiveOutfitDescription("p1"), null);
  });

  it("setActive → getActiveOutfit + description resolve it", async () => {
    const s = new OutfitStore(fakeKv(), { nowMs: () => NOW });
    const o = await s.add("p1", {
      name: "奶油白卫衣",
      description: "oversized cream sweater, plaid skirt",
      createdBy: "her",
    });
    const worn = await s.setActive("p1", o.id);
    assert.equal(worn?.id, o.id);
    assert.equal((await s.getActiveOutfit("p1"))?.name, "奶油白卫衣");
    assert.equal(await s.getActiveOutfitDescription("p1"), "oversized cream sweater, plaid skirt");
    // Clear: worn slot goes back to null.
    assert.equal(await s.setActive("p1", null), null);
    assert.equal(await s.getActiveOutfitDescription("p1"), null);
  });

  it("persona isolation: wardrobes never cross, ids never cross", async () => {
    const s = new OutfitStore(fakeKv(), { nowMs: () => NOW });
    const oA = await s.add("pA", {
      name: "卫衣A",
      description: "cream sweater",
      createdBy: "her",
    });
    await s.add("pB", { name: "衬衫B", description: "white shirt", createdBy: "her" });
    await s.setActive("pA", oA.id);
    const wB = await s.getWardrobe("pB");
    assert.equal(wB.outfits.length, 1);
    assert.equal(wB.outfits[0].name, "衬衫B");
    assert.equal(wB.activeId, null);
    assert.equal(await s.getActiveOutfitDescription("pB"), null);
    // Cross-persona outfit id is refused, not silently applied.
    await assert.rejects(() => s.setActive("pB", oA.id), /outfit-not-found/);
  });

  it("remove: deleting the active outfit clears the worn slot", async () => {
    const s = new OutfitStore(fakeKv(), { nowMs: () => NOW });
    const o1 = await s.add("p1", { name: "卫衣", description: "sweater", createdBy: "her" });
    const o2 = await s.add("p1", { name: "衬衫", description: "shirt", createdBy: "ai" });
    await s.setActive("p1", o1.id);
    assert.equal(await s.remove("p1", o1.id), true);
    // Worn slot falls back to null — never a random replacement.
    assert.equal(await s.getActiveOutfit("p1"), null);
    assert.equal((await s.getWardrobe("p1")).outfits.length, 1);
    assert.equal((await s.getWardrobe("p1")).outfits[0].id, o2.id);
    assert.equal(await s.remove("p1", "nope"), false);
  });

  it("validateOutfitInput rejects bad input", () => {
    assert.equal(validateOutfitInput({ name: "", description: "x" }), "name-required");
    assert.equal(validateOutfitInput({ name: "x".repeat(41), description: "x" }), "name-too-long");
    assert.equal(validateOutfitInput({ name: "ok", description: "" }), "description-required");
    assert.equal(
      validateOutfitInput({ name: "ok", description: "x".repeat(301) }),
      "description-too-long",
    );
    assert.equal(validateOutfitInput({ name: "ok", description: "sweater" }), null);
  });
});
