/**
 * Outfit / dress-up system （换装系统） — tool tests.
 *
 * Under test:
 *  1. outfit_add → outfit_list round-trip (visible, who-added shown).
 *  2. outfit_set_active: REFUSED without context (no unilateral change
 *     in normal chat); accepted with "her-confirmed" and "roleplay";
 *     refused with any other context value.
 *  3. outfit_delete round-trip; deleting the worn outfit clears it.
 *  4. Validation: missing personaId, unknown persona, unknown outfit id.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OutfitStore } from "../src/outfit/store.js";
import { createOutfitTools, type OutfitToolEnv } from "../src/outfit/tools.js";

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

interface Harness {
  tools: ReturnType<typeof createOutfitTools>;
  store: OutfitStore;
}

function makeHarness(): Harness {
  const store = new OutfitStore(fakeKv(), { nowMs: () => NOW });
  const env: OutfitToolEnv = {
    outfitStore: store,
    getPersona: async (id) => (id === "p1" ? { id: "p1", name: "小梦" } : null),
    nowMs: () => NOW,
  };
  return { tools: createOutfitTools(env), store };
}

function tool(h: Harness, name: string) {
  const t = h.tools.find((x) => x.name === name);
  assert.ok(t, `tool ${name} exists`);
  if (!t) throw new Error("missing");
  return t;
}

const CTX = { authorize: async () => true } as never;

async function run(t: ReturnType<typeof tool>, args: Record<string, unknown>): Promise<string> {
  return (await t.run(args, CTX)) as string;
}

async function runErr(t: ReturnType<typeof tool>, args: Record<string, unknown>): Promise<string> {
  try {
    await t.run(args, CTX);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error("expected tool to throw");
}

describe("outfit tools", () => {
  it("add → list round-trip", async () => {
    const h = makeHarness();
    const out = await run(tool(h, "outfit_add"), {
      personaId: "p1",
      name: "奶油白卫衣",
      description: "oversized cream sweater, plaid skirt",
    });
    assert.ok(out.includes("奶油白卫衣"));
    const list = await run(tool(h, "outfit_list"), { personaId: "p1" });
    assert.ok(list.includes("奶油白卫衣"));
    assert.ok(list.includes("oversized cream sweater"));
    assert.ok(list.includes("added by you"), "AI-added outfits are marked");
  });

  it("set_active without context is REFUSED (no unilateral change)", async () => {
    const h = makeHarness();
    await run(tool(h, "outfit_add"), {
      personaId: "p1",
      name: "卫衣",
      description: "cream sweater",
    });
    const w = await h.store.getWardrobe("p1");
    const id = w.outfits[0].id;
    const err = await runErr(tool(h, "outfit_set_active"), { personaId: "p1", outfitId: id });
    assert.ok(err.includes("Refused"), `got: ${err}`);
    assert.equal(await h.store.getActiveOutfit("p1"), null, "nothing changed");
  });

  it("set_active with her-confirmed / roleplay works; other values refused", async () => {
    const h = makeHarness();
    await run(tool(h, "outfit_add"), {
      personaId: "p1",
      name: "卫衣",
      description: "cream sweater",
    });
    const id = (await h.store.getWardrobe("p1")).outfits[0].id;

    const bad = await runErr(tool(h, "outfit_set_active"), {
      personaId: "p1",
      outfitId: id,
      context: "because-cute",
    });
    assert.ok(bad.includes("Refused"), `got: ${bad}`);
    assert.equal(await h.store.getActiveOutfit("p1"), null);

    const ok1 = await run(tool(h, "outfit_set_active"), {
      personaId: "p1",
      outfitId: id,
      context: "her-confirmed",
    });
    assert.ok(ok1.includes("卫衣"));
    assert.equal((await h.store.getActiveOutfit("p1"))?.id, id);

    const ok2 = await run(tool(h, "outfit_set_active"), {
      personaId: "p1",
      context: "roleplay",
    });
    assert.ok(ok2.includes("cleared"));
    assert.equal(await h.store.getActiveOutfit("p1"), null);
  });

  it("delete round-trip; deleting the worn outfit clears it", async () => {
    const h = makeHarness();
    await run(tool(h, "outfit_add"), {
      personaId: "p1",
      name: "卫衣",
      description: "cream sweater",
    });
    const id = (await h.store.getWardrobe("p1")).outfits[0].id;
    await run(tool(h, "outfit_set_active"), {
      personaId: "p1",
      outfitId: id,
      context: "her-confirmed",
    });
    assert.ok((await h.store.getActiveOutfit("p1")) !== null);
    await run(tool(h, "outfit_delete"), { personaId: "p1", outfitId: id });
    assert.equal(await h.store.getActiveOutfit("p1"), null);
    assert.ok((await run(tool(h, "outfit_list"), { personaId: "p1" })).includes("empty"));
  });

  it("validation: unknown persona / outfit / missing fields", async () => {
    const h = makeHarness();
    const e1 = await runErr(tool(h, "outfit_list"), { personaId: "nope" });
    assert.ok(e1.includes("Persona not found"));
    const e2 = await runErr(tool(h, "outfit_add"), { personaId: "p1", name: "", description: "x" });
    assert.ok(e2.includes("name-required"));
    const e3 = await runErr(tool(h, "outfit_delete"), { personaId: "p1", outfitId: "nope" });
    assert.ok(e3.includes("not found"));
    const e4 = await runErr(tool(h, "outfit_set_active"), {
      personaId: "p1",
      outfitId: "nope",
      context: "her-confirmed",
    });
    assert.ok(e4.includes("not found"));
  });
});
