/**
 * P1-10 regression: sendToDialog did an unlocked read-modify-write —
 * concurrent sends to the same dialog interleaved and one message was
 * silently lost while the trace claimed both were delivered. Writes are
 * now serialized per storage key.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type CrossDialogMarker,
  type CrossDialogStorage,
  readDialog,
  sendToDialog,
  setDialogName,
} from "../src/chat/cross-dialog.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Storage with real async latency so concurrent calls genuinely interleave. */
function racingStorage(): CrossDialogStorage & { __map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: async (k) => {
      await delay(5);
      return map.get(k) ?? null;
    },
    setItem: async (k, v) => {
      await delay(5);
      map.set(k, v);
    },
    getAllKeys: async () => [...map.keys()],
    __map: map,
  };
}

const marker = (from: string): CrossDialogMarker => ({
  fromThreadId: from,
  fromName: "test",
  at: Date.now(),
});
const noTag = async () => false;

describe("cross-dialog write serialization (P1-10)", () => {
  it("concurrent sends to the same dialog all land", async () => {
    const storage = racingStorage();
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        sendToDialog(storage, "target", `message ${i}`, marker("src"), noTag),
      ),
    );
    assert.equal(results.length, 5);
    const messages = await readDialog(storage, "target");
    const texts = messages.map((m) => m.text).sort();
    assert.deepEqual(texts, ["message 0", "message 1", "message 2", "message 3", "message 4"]);
  });

  it("sends to different dialogs do not block each other incorrectly", async () => {
    const storage = racingStorage();
    await Promise.all([
      sendToDialog(storage, "a", "to a", marker("src"), noTag),
      sendToDialog(storage, "b", "to b", marker("src"), noTag),
    ]);
    const ra = await readDialog(storage, "a");
    const rb = await readDialog(storage, "b");
    assert.equal(ra.length, 1);
    assert.equal(rb.length, 1);
  });

  it("concurrent renames keep every dialog's entry", async () => {
    const storage = racingStorage();
    await Promise.all([
      setDialogName(storage, "t1", "一号"),
      setDialogName(storage, "t2", "二号"),
      setDialogName(storage, "t3", "三号"),
    ]);
    const raw = storage.__map.get("dudu.dialog-registry.v1");
    assert.ok(raw, "registry written");
    const reg = JSON.parse(raw) as Record<string, { name?: string }>;
    assert.equal(reg.t1?.name, "一号");
    assert.equal(reg.t2?.name, "二号");
    assert.equal(reg.t3?.name, "三号");
  });

  it("a failed write does not wedge later writes", async () => {
    const storage = racingStorage();
    let failNext = true;
    const throwing: CrossDialogStorage = {
      ...storage,
      setItem: async (k, v) => {
        if (failNext) {
          failNext = false;
          throw new Error("disk full");
        }
        return storage.setItem(k, v);
      },
    };
    await assert.rejects(
      () => sendToDialog(throwing, "target", "boom", marker("src"), noTag),
      /disk full/,
    );
    // The chain survives: the next send still lands.
    await sendToDialog(throwing, "target", "after", marker("src"), noTag);
    const messages = await readDialog(throwing, "target");
    assert.equal(messages.length, 1);
    assert.equal(messages[0].text, "after");
  });
});
