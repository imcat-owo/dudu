/**
 * AI display name tests (B4c): no hardcoded personal names.
 *
 * Contract:
 *  - resolveAiDisplayName: active persona's name (trimmed) wins; blank/null
 *    falls back to the neutral default (ai.defaultName).
 *  - getAiDisplayName: reads the active persona via the store; never throws;
 *    falls back to the default on any failure.
 *  - i18n: ai.defaultName exists in all three packs; every formerly-hardcoded
 *    string now carries a {name} slot.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { getAiDisplayName, resolveAiDisplayName } from "../src/persona/ai-name.js";
import { createPersonaStore } from "../src/persona/store.js";
import { blankPersona } from "../src/persona/types.js";
import { zhHansStrings } from "../src/i18n/zh-Hans.js";
import { enStrings } from "../src/i18n/en.js";
import { zhHantStrings } from "../src/i18n/zh-Hant.js";

function memKV() {
  const m = new Map<string, string>();
  return {
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: async (k: string) => {
      m.delete(k);
    },
  };
}

const resolve = (k: string) => `[${k}]`;

describe("resolveAiDisplayName", () => {
  it("uses the persona name when set", () => {
    assert.equal(resolveAiDisplayName("阿茶", resolve as never), "阿茶");
  });
  it("trims the persona name", () => {
    assert.equal(resolveAiDisplayName("  阿茶  ", resolve as never), "阿茶");
  });
  it("falls back to ai.defaultName on blank/null", () => {
    assert.equal(resolveAiDisplayName("", resolve as never), "[ai.defaultName]");
    assert.equal(resolveAiDisplayName("   ", resolve as never), "[ai.defaultName]");
    assert.equal(resolveAiDisplayName(null, resolve as never), "[ai.defaultName]");
    assert.equal(resolveAiDisplayName(undefined, resolve as never), "[ai.defaultName]");
  });
});

describe("getAiDisplayName", () => {
  it("returns the active persona name", async () => {
    const store = createPersonaStore(memKV());
    const p = { ...blankPersona(), name: "阿茶" };
    await store.upsert(p);
    await store.setActiveId(p.id);
    assert.equal(await getAiDisplayName(resolve as never, store), "阿茶");
  });
  it("falls back when no persona is active", async () => {
    const store = createPersonaStore(memKV());
    assert.equal(await getAiDisplayName(resolve as never, store), "[ai.defaultName]");
  });
  it("falls back when the active persona has a blank name", async () => {
    const store = createPersonaStore(memKV());
    const p = { ...blankPersona(), name: "   " };
    await store.upsert(p);
    await store.setActiveId(p.id);
    assert.equal(await getAiDisplayName(resolve as never, store), "[ai.defaultName]");
  });
  it("never throws on storage failure", async () => {
    const bad = {
      getActiveId: async () => {
        throw new Error("boom");
      },
      get: async () => {
        throw new Error("boom");
      },
    };
    assert.equal(await getAiDisplayName(resolve as never, bad), "[ai.defaultName]");
  });
});

describe("ai.defaultName i18n", () => {
  it("exists in all three packs with the spec values", () => {
    assert.equal(zhHansStrings["ai.defaultName"], "嘟嘟");
    assert.equal(zhHantStrings["ai.defaultName"], "嘟嘟");
    assert.equal(enStrings["ai.defaultName"], "Dudu");
  });
  it("formerly-hardcoded strings now carry a {name} slot", () => {
    for (const pack of [zhHansStrings, enStrings, zhHantStrings]) {
      for (const key of [
        "music.djWorking",
        "apigroup.noActive",
        "sandbox.relayNote",
        "sandbox.relayMissing",
        "persona.pickerNone",
      ] as const) {
        assert.ok(
          pack[key].includes("{name}"),
          `${key} is missing its {name} slot`,
        );
        assert.ok(!pack[key].includes("小梦") && !pack[key].includes("小夢"), `${key} still hardcoded`);
      }
    }
  });
});
