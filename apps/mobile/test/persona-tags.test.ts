/**
 * Persona tag wiring tests (Batch 5 review P1 fix).
 *
 * The UI (persona-ui.tsx) cannot be imported in node (react-native),
 * so these tests prove the exact data flow the UI depends on:
 *  1. tags can be created and assigned to personas (editor toggle writes tagIds)
 *  2. tagIds resolve to tag objects for the card chips (same expression as the UI)
 *  3. filtering by tag returns the right personas (same predicate as the UI filter)
 *  4. deleting a tag cleans it off personas (cards never show stale chips)
 *  5. the new filter/pick i18n keys exist in all three packs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createPersonaStore } from "../src/persona/store";
import { blankPersona, type Persona, type PersonaTag } from "../src/persona/types";
import { zhHansStrings } from "../src/i18n/zh-Hans";
import { enStrings } from "../src/i18n/en";

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

/** Mirrors resolvePersonaTags() in persona-ui.tsx. */
function resolvePersonaTags(p: Persona, tagsById: Map<string, PersonaTag>): PersonaTag[] {
  const out: PersonaTag[] = [];
  for (const id of p.tagIds) {
    const tag = tagsById.get(id);
    if (tag) out.push(tag);
  }
  return out;
}

/** Mirrors the card filter predicate in persona-ui.tsx. */
function filterByTag(personas: Persona[], filterTagId: string | null): Persona[] {
  return filterTagId ? personas.filter((p) => p.tagIds.includes(filterTagId)) : personas;
}

async function seed() {
  const store = createPersonaStore(memKV());
  const gentle = await store.createTag("温柔", "#ff9db0");
  const work = await store.createTag("工作");
  const mk = async (name: string, tagIds: string[]) => {
    const p = { ...blankPersona(), name, tagIds };
    assert.equal(await store.upsert(p), null);
    return p;
  };
  const p1 = await mk("小梦", [gentle.id]);
  const p2 = await mk("助理", [gentle.id, work.id]);
  const p3 = await mk("路人", []);
  return { store, gentle, work, p1, p2, p3 };
}

describe("persona tag assignment (editor toggle)", () => {
  it("persists tagIds on upsert", async () => {
    const { store, gentle, p1 } = await seed();
    const got = await store.get(p1.id);
    assert.deepEqual(got?.tagIds, [gentle.id]);
  });

  it("toggling a tag off removes only that id", async () => {
    const { store, gentle, work, p2 } = await seed();
    const toggled = { ...p2, tagIds: p2.tagIds.filter((id) => id !== gentle.id) };
    assert.equal(await store.upsert(toggled), null);
    const got = await store.get(p2.id);
    assert.deepEqual(got?.tagIds, [work.id]);
  });
});

describe("persona tag chips on cards (tagIds -> tag objects)", () => {
  it("resolves tag names and colors for a persona", async () => {
    const { store, gentle, work, p2 } = await seed();
    const tags = await store.listTags();
    const byId = new Map(tags.map((t) => [t.id, t]));
    const resolved = resolvePersonaTags(p2, byId);
    assert.equal(resolved.length, 2);
    assert.deepEqual(
      resolved.map((t) => t.name).sort(),
      ["工作", "温柔"],
    );
    assert.equal(resolved.find((t) => t.id === gentle.id)?.color, "#ff9db0");
    assert.equal(work.color, undefined);
  });

  it("drops stale tag ids instead of crashing", async () => {
    const { p1 } = await seed();
    const ghost = { ...p1, tagIds: ["nope"] };
    assert.deepEqual(resolvePersonaTags(ghost, new Map()), []);
  });

  it("persona with no tags resolves to no chips", async () => {
    const { store, p3 } = await seed();
    const tags = await store.listTags();
    const byId = new Map(tags.map((t) => [t.id, t]));
    assert.deepEqual(resolvePersonaTags(p3, byId), []);
  });
});

describe("persona tag filter", () => {
  it("byTag returns only matching personas", async () => {
    const { store, gentle, work } = await seed();
    const g = await store.byTag(gentle.id);
    assert.deepEqual(
      g.map((p) => p.name).sort(),
      ["助理", "小梦"],
    );
    const w = await store.byTag(work.id);
    assert.deepEqual(w.map((p) => p.name), ["助理"]);
  });

  it("null filter shows everything (the 'all' chip)", async () => {
    const { store } = await seed();
    const all = await store.list();
    assert.equal(filterByTag(all, null).length, 3);
  });

  it("filtering by a tag narrows the list", async () => {
    const { store, work } = await seed();
    const all = await store.list();
    const filtered = filterByTag(all, work.id);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].name, "助理");
  });

  it("filtering by an unused tag shows empty (noMatch message)", async () => {
    const { store } = await seed();
    const all = await store.list();
    assert.deepEqual(filterByTag(all, "unused-tag"), []);
  });
});

describe("tag deletion cleans personas", () => {
  it("removeTag strips the id from every persona", async () => {
    const { store, gentle, work, p1, p2 } = await seed();
    await store.removeTag(gentle.id);
    assert.deepEqual((await store.get(p1.id))?.tagIds, []);
    assert.deepEqual((await store.get(p2.id))?.tagIds, [work.id]);
    assert.deepEqual(
      await store.listTags().then((ts) => ts.map((t) => t.id)),
      [work.id],
    );
  });
});

describe("tag filter i18n keys", () => {
  it("new keys exist in zh-Hans and en (zh-Hant covered by i18n.test.ts parity)", async () => {
    const { zhHantStrings } = await import("../src/i18n/zh-Hant.js");
    for (const key of [
      "persona.tags.filterBy",
      "persona.tags.filterAll",
      "persona.tags.noMatch",
      "persona.tags.pick",
    ]) {
      for (const [packName, pack] of [
        ["zh-Hans", zhHansStrings],
        ["en", enStrings],
        ["zh-Hant", zhHantStrings],
      ] as const) {
        const v = (pack as Record<string, string>)[key];
        assert.ok(typeof v === "string" && v.length > 0, `${packName} missing ${key}`);
      }
    }
  });

  it("has no emoji", () => {
    const emojiRe = /\p{Extended_Pictographic}/u;
    for (const key of [
      "persona.tags.filterBy",
      "persona.tags.filterAll",
      "persona.tags.noMatch",
      "persona.tags.pick",
    ]) {
      assert.ok(!emojiRe.test(zhHansStrings[key as keyof typeof zhHansStrings]), key);
      assert.ok(!emojiRe.test(enStrings[key as keyof typeof enStrings]), key);
    }
  });
});
