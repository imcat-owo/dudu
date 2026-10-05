/**
 * B13 slot wiring tests: every model slot must be consumed by a real
 * caller, or removed. translate/ocr have no consumers and were removed.
 */
import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  MODEL_SLOT_IDS,
  defaultSlots,
  withSlotModel,
  type ModelSlotId,
} from "../src/api-groups/model-slots.js";
import { blankGroup } from "../src/api-groups/types.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../src");

function srcFile(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8");
}

/** Stub AsyncStorage with the given slot models. */
function stubSlots(models: Partial<Record<ModelSlotId, string>>) {
  const slots = defaultSlots();
  for (const [id, model] of Object.entries(models)) {
    slots[id as ModelSlotId] = { ...slots[id as ModelSlotId], model };
  }
  (AsyncStorage as any).getItem = async () => JSON.stringify(slots);
}

describe("B13 model slots", () => {
  before(() => {
    // Baseline: empty storage
    (AsyncStorage as any).getItem = async () => null;
  });

  it("has exactly 5 slots — translate/ocr removed (no consumers)", () => {
    assert.deepEqual([...MODEL_SLOT_IDS].sort(), [
      "compress",
      "memory",
      "suggest",
      "summary",
      "title",
    ]);
    assert.ok(!MODEL_SLOT_IDS.includes("translate" as ModelSlotId));
    assert.ok(!MODEL_SLOT_IDS.includes("ocr" as ModelSlotId));
  });

  it("withSlotModel returns group unchanged when no slot model set", async () => {
    (AsyncStorage as any).getItem = async () => null;
    const group = { ...blankGroup(), model: "gpt-4o" };
    for (const id of MODEL_SLOT_IDS) {
      const out = await withSlotModel(group, id);
      assert.equal(out.model, "gpt-4o", `slot ${id} should not change model`);
    }
  });

  it("withSlotModel swaps in the slot model for each of the 5 slots", async () => {
    stubSlots({
      title: "title-model",
      summary: "summary-model",
      suggest: "suggest-model",
      memory: "memory-model",
      compress: "compress-model",
    });
    const group = { ...blankGroup(), model: "gpt-4o" };
    const gid = group.id;
    for (const id of MODEL_SLOT_IDS) {
      const out = await withSlotModel(group, id);
      assert.equal(out.model, `${id}-model`, `slot ${id} should swap model`);
      assert.equal(out.id, gid, "group id preserved");
    }
  });

  it("title slot is consumed by auto-title generation (chat.tsx)", () => {
    const src = srcFile("chat.tsx");
    assert.ok(
      src.includes('withSlotModel(activeGroup, "title")'),
      "maybeAutoTitle must route through the title slot",
    );
  });

  it("suggest slot is consumed by follow-up generation (chat.tsx)", () => {
    const src = srcFile("chat.tsx");
    assert.ok(
      src.includes('withSlotModel(activeGroup, "suggest")'),
      "makeFollowUps must route through the suggest slot",
    );
  });

  it("memory slot is consumed by memory extraction (local-agent.ts)", () => {
    const src = srcFile("api-groups/local-agent.ts");
    assert.ok(
      src.includes('withSlotModel(activeGroup, "memory")'),
      "extractMemoriesAsync caller must route through the memory slot",
    );
  });

  it("summary and compress slots are consumed by local-agent.ts", () => {
    const src = srcFile("api-groups/local-agent.ts");
    assert.ok(
      src.includes('withSlotModel(group, "summary")'),
      "summarization must route through the summary slot",
    );
    assert.ok(
      src.includes('withSlotModel(group, "compress")'),
      "auto-compression must route through the compress slot",
    );
  });

  it("no dead slot settings in api-settings.tsx", () => {
    const src = srcFile("api-groups/api-settings.tsx");
    // UI renders from MODEL_SLOT_IDS — if the IDs are right, the UI is right.
    // Just verify it doesn't hardcode the removed slots.
    assert.ok(!src.includes('"translate"'), "translate input must be gone");
    assert.ok(!src.includes('"ocr"'), "ocr input must be gone");
  });
});
