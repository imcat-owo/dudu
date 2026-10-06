/**
 * 图片表情包 store — tests.
 *
 * Under test (in-memory backend):
 *  1. create pack -> add stickers -> list (AI library always first).
 *  2. rename pack; validation errors (empty / too-long / pack-full).
 *  3. delete pack removes its stickers; AI pack is protected.
 *  4. Per-persona AI toggle: default on, off for one persona doesn't
 *     affect another (persona isolation).
 *  5. Honest simulation: she creates "我的表情", adds 2 stickers,
 *     deletes the pack — metadata is gone, ids never reused.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StickerStore, type StickerStoreBackend } from "../src/sticker/store.js";
import { AI_PACK_ID } from "../src/sticker/types.js";

function memBackend(): StickerStoreBackend {
  const m = new Map<string, string>();
  return {
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => void m.set(k, v),
    removeItem: async (k) => void m.delete(k),
  };
}

describe("StickerStore packs", () => {
  it("AI library is always listed first, even with no her-packs", async () => {
    const store = new StickerStore(memBackend());
    const packs = await store.listPacks();
    assert.equal(packs.length, 1);
    assert.equal(packs[0].id, AI_PACK_ID);
    assert.equal(packs[0].owner, "ai");
  });

  it("create -> rename -> list order", async () => {
    const store = new StickerStore(memBackend());
    const { pack, error } = await store.createPack("我的表情");
    assert.ok(!error && pack, "created");
    const packs = await store.listPacks();
    assert.equal(packs[0].id, AI_PACK_ID, "AI first");
    assert.equal(packs[1].name, "我的表情");

    const err = await store.renamePack(pack.id, "我的收藏");
    assert.equal(err, null);
    const renamed = (await store.listPacks()).find((p) => p.id === pack.id);
    assert.equal(renamed?.name, "我的收藏");

    assert.equal(await store.renamePack(pack.id, "  "), "empty");
    assert.equal(await store.renamePack("nope", "x"), "not-found");
  });

  it("rejects bad pack names and too many packs", async () => {
    const store = new StickerStore(memBackend());
    assert.equal((await store.createPack("  ")).error, "empty");
    assert.equal((await store.createPack("a".repeat(25))).error, "too-long");
  });

  it("delete pack removes its stickers; AI pack is protected", async () => {
    const store = new StickerStore(memBackend());
    const { pack } = await store.createPack("临时");
    assert.ok(pack);
    const s1 = await store.addSticker(pack.id, { name: "a", fileName: "a.png" });
    assert.ok(s1.sticker);
    assert.equal((await store.listStickers(pack.id)).length, 1);

    assert.equal(await store.deletePack(AI_PACK_ID), "protected");
    assert.equal(await store.deletePack(pack.id), null);
    assert.equal((await store.listStickers(pack.id)).length, 0, "stickers gone with the pack");
    assert.equal((await store.listPacks()).length, 1, "only AI pack left");
    assert.equal(await store.deletePack(pack.id), "not-found");
  });

  it("add sticker validates and caps at 100", async () => {
    const store = new StickerStore(memBackend());
    const { pack } = await store.createPack("p");
    assert.ok(pack);
    assert.equal((await store.addSticker(pack.id, { name: "", fileName: "a.png" })).error, "empty");
    assert.equal((await store.addSticker(pack.id, { name: "x", fileName: "" })).error, "no-file");
    assert.equal(
      (await store.addSticker("nope", { name: "x", fileName: "a.png" })).error,
      "pack-not-found",
    );

    // Fill to the cap by writing stickers directly through addSticker.
    for (let i = 0; i < 100; i++) {
      const r = await store.addSticker(pack.id, { name: `s${i}`, fileName: `s${i}.png` });
      assert.ok(!r.error, `add ${i}`);
    }
    assert.equal(
      (await store.addSticker(pack.id, { name: "overflow", fileName: "o.png" })).error,
      "pack-full",
    );
  });

  it("removeSticker only removes from the right pack", async () => {
    const store = new StickerStore(memBackend());
    const p1 = (await store.createPack("p1")).pack;
    const p2 = (await store.createPack("p2")).pack;
    assert.ok(p1 && p2);
    const s = (await store.addSticker(p1.id, { name: "a", fileName: "a.png" })).sticker;
    assert.ok(s);
    assert.equal(await store.removeSticker(p2.id, s.id), "not-found", "cross-pack id refused");
    assert.equal(await store.removeSticker(p1.id, s.id), null);
    assert.equal((await store.listStickers(p1.id)).length, 0);
  });
});

describe("StickerStore AI toggle (per persona)", () => {
  it("defaults on; per-persona off is isolated", async () => {
    const store = new StickerStore(memBackend());
    assert.equal(await store.isAiEnabled("personaA"), true);
    assert.equal(await store.isAiEnabled("personaB"), true);

    await store.setAiEnabled("personaA", false);
    assert.equal(await store.isAiEnabled("personaA"), false);
    assert.equal(await store.isAiEnabled("personaB"), true, "personaB unaffected");

    await store.setAiEnabled("personaA", true);
    assert.equal(await store.isAiEnabled("personaA"), true);
  });
});

describe("honest simulation: her pack lifecycle", () => {
  it("she creates a pack, adds 2, deletes it — clean", async () => {
    const store = new StickerStore(memBackend());
    const { pack } = await store.createPack("我的表情");
    assert.ok(pack);
    const a = await store.addSticker(pack.id, { name: "开心", fileName: "happy.png" });
    const b = await store.addSticker(pack.id, { name: "委屈", fileName: "sad.png" });
    assert.ok(a.sticker && b.sticker);
    assert.notEqual(a.sticker.id, b.sticker.id, "ids never reused");

    // She taps one: getSticker resolves it for sending.
    const tapped = await store.getSticker(a.sticker.id);
    assert.equal(tapped?.fileName, "happy.png");

    assert.equal(await store.deletePack(pack.id), null);
    assert.equal(await store.getSticker(a.sticker.id), null, "metadata gone after delete");
  });
});
