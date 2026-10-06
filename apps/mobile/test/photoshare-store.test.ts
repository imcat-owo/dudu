/**
 * AI photo share （主动发照片） — store tests.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_PHOTOSHARE_CONFIG, PhotoshareStore } from "../src/photoshare/store.js";

function fakeKv() {
  const map = new Map<string, string>();
  return {
    getItem: async (k: string) => map.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

describe("photoshare store", () => {
  it("defaults to OFF (opt-in)", () => {
    assert.equal(DEFAULT_PHOTOSHARE_CONFIG.enabled, false);
  });

  it("returns the default config when nothing is stored", async () => {
    const store = new PhotoshareStore(fakeKv());
    const c = await store.getConfig();
    assert.equal(c.enabled, false);
    assert.equal(c.slotCount, 2);
    assert.equal(c.dailyCap, 1);
    assert.equal(c.personaId, "");
  });

  it("sanitizes ambiguous stored values to OFF", async () => {
    const kv = fakeKv();
    await kv.setItem("dudu.photoshare.v1.config", JSON.stringify({ enabled: "yes" }));
    const store = new PhotoshareStore(kv);
    const c = await store.getConfig();
    // Anything but an explicit true stays off.
    assert.equal(c.enabled, false);
  });

  it("persists config changes", async () => {
    const store = new PhotoshareStore(fakeKv());
    const next = await store.setConfig({ enabled: true, dailyCap: 2 });
    assert.equal(next.enabled, true);
    assert.equal(next.dailyCap, 2);
    assert.equal((await store.getConfig()).enabled, true);
  });

  it("clamps dailyCap to 0..2", async () => {
    const store = new PhotoshareStore(fakeKv());
    assert.equal((await store.setConfig({ dailyCap: 99 })).dailyCap, 2);
    assert.equal((await store.setConfig({ dailyCap: -5 })).dailyCap, 0);
  });

  it("tracks sends today and the slot ledger", async () => {
    const now = Date.UTC(2026, 9, 6, 12, 0, 0);
    const store = new PhotoshareStore(fakeKv(), { nowMs: () => now });
    assert.equal(await store.countSendsToday(now), 0);
    await store.recordSend(now);
    await store.recordSend(now);
    assert.equal(await store.countSendsToday(now), 2);
    // Yesterday's send doesn't count.
    assert.equal(await store.countSendsToday(now + 86_400_000), 0);

    const slot = { index: 0, atMs: now, label: "evening" };
    assert.equal(await store.wasSlotFired(slot, now), false);
    await store.markSlotFired(slot, now);
    assert.equal(await store.wasSlotFired(slot, now), true);
  });

  it("appends and lists the decision log", async () => {
    const now = Date.UTC(2026, 9, 6, 12, 0, 0);
    const store = new PhotoshareStore(fakeKv(), { nowMs: () => now });
    await store.appendLog({
      at: now,
      slotIndex: 0,
      slotAt: now,
      outcome: "shared",
      reason: "shared",
      captionPreview: "看，我刚到家",
    });
    const log = await store.listLog(10);
    assert.equal(log.length, 1);
    assert.equal(log[0].captionPreview, "看，我刚到家");
  });
});
