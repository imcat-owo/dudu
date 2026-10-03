/**
 * Pet interaction video store + event log tests — PURE module, no React Native needed.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  clearInteractionEvents,
  INTERACTION_DEFAULT_CLIP,
  isOneShotInteraction,
  logInteraction,
  PET_INTERACTIONS,
  type PetInteractionVideoStorage,
  PetInteractionVideoStore,
  recentInteraction,
} from "../src/pet/interactions.js";

function memStorage(): PetInteractionVideoStorage {
  const m = new Map<string, string>();
  return {
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => {
      m.set(k, v);
    },
  };
}

test("defaults are all null (bundled clips)", async () => {
  const s = new PetInteractionVideoStore(memStorage());
  for (const i of PET_INTERACTIONS) assert.equal(s.get(i), null);
});

test("set stores a custom video URI per interaction", async () => {
  const s = new PetInteractionVideoStore(memStorage());
  await s.set("pinch", "file:///custom/pinch.mp4");
  assert.equal(s.get("pinch"), "file:///custom/pinch.mp4");
  assert.equal(s.get("reach"), null);
});

test("blank URI resets to default", async () => {
  const s = new PetInteractionVideoStore(memStorage());
  await s.set("headpat", "file:///custom/pat.mp4");
  await s.set("headpat", "   ");
  assert.equal(s.get("headpat"), null);
});

test("clear resets a single interaction; resetAll resets everything", async () => {
  const s = new PetInteractionVideoStore(memStorage());
  await s.set("pinch", "file:///a.mp4");
  await s.set("reach", "file:///b.mp4");
  await s.clear("pinch");
  assert.equal(s.get("pinch"), null);
  assert.equal(s.get("reach"), "file:///b.mp4");
  await s.resetAll();
  assert.equal(s.get("reach"), null);
});

test("persists and hydrates across instances; corrupt data keeps defaults", async () => {
  const storage = memStorage();
  const s1 = new PetInteractionVideoStore(storage);
  await s1.set("headphones", "file:///h.mp4");
  const s2 = new PetInteractionVideoStore(storage);
  await s2.load();
  assert.equal(s2.get("headphones"), "file:///h.mp4");
  assert.equal(s2.get("pinch"), null);

  const bad = memStorage();
  await bad.setItem("dudu.pet.interactions.v1.overrides", "{not json");
  const s3 = new PetInteractionVideoStore(bad);
  await s3.load();
  assert.equal(s3.get("headphones"), null);
});

test("only headpat is one-shot", () => {
  assert.equal(isOneShotInteraction("headpat"), true);
  assert.equal(isOneShotInteraction("pinch"), false);
  assert.equal(isOneShotInteraction("reach"), false);
  assert.equal(isOneShotInteraction("headphones"), false);
});

test("every interaction has a default clip", () => {
  for (const i of PET_INTERACTIONS) {
    assert.ok(INTERACTION_DEFAULT_CLIP[i], `missing default clip for ${i}`);
  }
});

test("event log: recent interaction within window, old ones fade", () => {
  clearInteractionEvents();
  assert.equal(recentInteraction(), null);
  // Only an old event → fades out
  logInteraction("reach", Date.now() - 10 * 60 * 1000);
  assert.equal(recentInteraction(), null);
  assert.equal(recentInteraction(20 * 60 * 1000)?.type, "reach");
  // Fresh event on top → visible again
  logInteraction("pinch");
  assert.equal(recentInteraction()?.type, "pinch");
  assert.equal(recentInteraction(60 * 1000)?.type, "pinch");
  clearInteractionEvents();
  assert.equal(recentInteraction(), null);
});

test("event log keeps the latest of several touches", () => {
  clearInteractionEvents();
  logInteraction("pinch");
  logInteraction("headpat");
  assert.equal(recentInteraction()?.type, "headpat");
  clearInteractionEvents();
});
