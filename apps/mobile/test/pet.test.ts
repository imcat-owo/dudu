/**
 * Desktop pet (桌宠） — pure logic tests. No react-native imports here;
 * the store and drop-zone geometry are plain TypeScript.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickDropZone, pointInRect } from "../src/pet/dropzones.js";
import {
  defaultPetState,
  normalizePetState,
  normalizeSkin,
  PET_DEFAULT_POS,
  type PetStorage,
  PetStore,
  resolvePetMood,
} from "../src/pet/store.js";

function fakeStorage(initial?: Record<string, string>): PetStorage {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v);
    },
  };
}

describe("resolvePetMood priority", () => {
  const base = {
    dragging: false,
    aiBusy: false,
    musicPlaying: false,
    lastHappyAt: -10000,
    lastInteractAt: 1000,
    now: 2000,
  };
  it("idle by default", () => {
    assert.equal(resolvePetMood(base), "idle");
  });
  it("dragging beats everything", () => {
    assert.equal(
      resolvePetMood({ ...base, dragging: true, aiBusy: true, musicPlaying: true }),
      "dragged",
    );
  });
  it("happy window (2.5s) beats busy/music", () => {
    assert.equal(
      resolvePetMood({ ...base, lastHappyAt: 1000, now: 2000, aiBusy: true, musicPlaying: true }),
      "happy",
    );
    assert.equal(resolvePetMood({ ...base, lastHappyAt: 1000, now: 4000, aiBusy: true }), "busy");
  });
  it("aiBusy beats musicPlaying", () => {
    assert.equal(resolvePetMood({ ...base, aiBusy: true, musicPlaying: true }), "busy");
    assert.equal(resolvePetMood({ ...base, aiBusy: true, musicPlaying: false }), "busy");
    assert.equal(resolvePetMood({ ...base, musicPlaying: true }), "bopping");
  });
  it("sleepy after 90s of no interaction", () => {
    assert.equal(resolvePetMood({ ...base, lastInteractAt: 0, now: 91000 }), "sleepy");
    assert.equal(
      resolvePetMood({ ...base, lastInteractAt: 0, now: 91000, musicPlaying: true }),
      "bopping",
    );
  });
});

describe("drop-zone geometry", () => {
  it("pointInRect", () => {
    assert.equal(pointInRect({ x: 0, y: 0, width: 10, height: 10 }, 5, 5), true);
    assert.equal(pointInRect({ x: 0, y: 0, width: 10, height: 10 }, 11, 5), false);
  });
  it("higher priority wins on overlap", () => {
    const zones = [
      { id: "dialog" as const, rect: { x: 0, y: 0, width: 300, height: 600 }, priority: 10 },
      { id: "input-top" as const, rect: { x: 0, y: 500, width: 300, height: 60 }, priority: 30 },
    ];
    assert.equal(pickDropZone(zones, 150, 530), "input-top");
    assert.equal(pickDropZone(zones, 150, 100), "dialog");
    assert.equal(pickDropZone(zones, 900, 900), null);
  });
});

describe("pet skin normalization", () => {
  it("defaults to sora", () => {
    assert.deepEqual(normalizeSkin(undefined), { kind: "sora" });
    assert.deepEqual(normalizeSkin({ kind: "weird" }), { kind: "sora" });
  });
  it("devil index is clamped", () => {
    assert.deepEqual(normalizeSkin({ kind: "devil", index: 3 }), { kind: "devil", index: 3 });
    assert.ok((normalizeSkin({ kind: "devil", index: 99 }) as { index: number }).index < 10);
  });
});

describe("pet store", () => {
  it("defaults: sora skin, chat location, free perch", async () => {
    const store = new PetStore(fakeStorage());
    const s = await store.load();
    assert.deepEqual(s.skin, { kind: "sora" });
    assert.equal(s.location, "chat");
    assert.equal(s.perch, "free");
  });
  it("drop on tab-space moves the pet home", async () => {
    const store = new PetStore(fakeStorage());
    await store.load();
    const next = await store.drop({ zone: "tab-space", fx: 0.1, fy: 0.1 });
    assert.equal(next.location, "space");
    assert.deepEqual(next.pos.space, PET_DEFAULT_POS.space);
    assert.deepEqual(next.pos.chat, PET_DEFAULT_POS.chat);
  });
  it("drop on tab-chat brings it back", async () => {
    const store = new PetStore(fakeStorage());
    await store.load();
    await store.drop({ zone: "tab-space", fx: 0.1, fy: 0.1 });
    const next = await store.drop({ zone: "tab-chat", fx: 0.9, fy: 0.9 });
    assert.equal(next.location, "chat");
  });
  it("drop on ai-bubble perches with message id", async () => {
    const store = new PetStore(fakeStorage());
    await store.load();
    const next = await store.drop({
      zone: "ai-bubble",
      fx: 0.5,
      fy: 0.5,
      bubbleMessageId: "msg-1",
    });
    assert.equal(next.perch, "ai-bubble");
    assert.equal(next.bubbleMessageId, "msg-1");
  });
  it("drop on input-top perches", async () => {
    const store = new PetStore(fakeStorage());
    await store.load();
    const next = await store.drop({ zone: "input-top", fx: 0.5, fy: 0.9 });
    assert.equal(next.perch, "input-top");
    assert.equal(next.bubbleMessageId, null);
  });
  it("drop on empty dialog saves free position", async () => {
    const store = new PetStore(fakeStorage());
    await store.load();
    const next = await store.drop({ zone: null, fx: 0.3, fy: 0.4 });
    assert.equal(next.perch, "free");
    assert.ok(Math.abs(next.pos.chat.fx - 0.3) < 0.001);
    assert.ok(Math.abs(next.pos.chat.fy - 0.4) < 0.001);
  });
  it("persists across instances", async () => {
    const storage = fakeStorage();
    const a = new PetStore(storage);
    await a.load();
    await a.setDevilSkin(4);
    await a.drop({ zone: "tab-space", fx: 0.1, fy: 0.1 });
    const b = new PetStore(storage);
    const s = await b.load();
    assert.deepEqual(s.skin, { kind: "devil", index: 4 });
    assert.equal(s.location, "space");
  });
  it("corrupted storage falls back to defaults", async () => {
    const storage = fakeStorage({ "dudu.pet.v1.state": "not-json{{" });
    const store = new PetStore(storage);
    const s = await store.load();
    assert.deepEqual({ ...s, updatedAt: 0 }, { ...defaultPetState(), updatedAt: 0 });
  });
  it("normalizePetState clamps positions", () => {
    const s = normalizePetState({ pos: { chat: { fx: 5, fy: -2 } } });
    assert.ok(s.pos.chat.fx <= 0.98);
    assert.ok(s.pos.chat.fy >= 0.02);
  });
  it("subscribe fires on change", async () => {
    const store = new PetStore(fakeStorage());
    await store.load();
    let calls = 0;
    const unsub = store.subscribe(() => calls++);
    await store.setSkin({ kind: "sora" });
    assert.equal(calls, 1);
    unsub();
    await store.setSkin({ kind: "sora" });
    assert.equal(calls, 1);
  });
});
