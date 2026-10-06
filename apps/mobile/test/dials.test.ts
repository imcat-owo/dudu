import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDialsSection } from "../src/dials/prompt.js";
import { createDialsStore, DIALS_KEYS } from "../src/dials/store.js";
import {
  bucketOf,
  clampDial,
  DIAL_DEFS,
  DIAL_IDS,
  describeDial,
  getDialDef,
  isDialId,
  normalizeDialValues,
} from "../src/dials/types.js";

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      m.set(k, v);
    },
  };
}

describe("dial types", () => {
  it("has exactly 5 honest dimensions", () => {
    assert.deepEqual([...DIAL_IDS], ["clingy", "playful", "romantic", "proactive", "humor"]);
    assert.equal(DIAL_DEFS.length, 5);
  });

  it("clamps and rounds values", () => {
    assert.equal(clampDial(-5), 0);
    assert.equal(clampDial(105), 100);
    assert.equal(clampDial(42.6), 43);
    assert.equal(clampDial("nope"), 50);
    assert.equal(clampDial(NaN), 50);
  });

  it("buckets 0-33 low, 34-66 mid, 67-100 high", () => {
    assert.equal(bucketOf(0), "low");
    assert.equal(bucketOf(33), "low");
    assert.equal(bucketOf(34), "mid");
    assert.equal(bucketOf(66), "mid");
    assert.equal(bucketOf(67), "high");
    assert.equal(bucketOf(100), "high");
  });

  it("粘人度=90 describes high clinginess", () => {
    const d = describeDial("clingy", 90);
    assert.ok(d.includes("很黏人"), d);
    assert.ok(d.includes("贴贴"), d);
  });

  it("粘人度=10 describes independence", () => {
    const d = describeDial("clingy", 10);
    assert.ok(d.includes("独立"), d);
    assert.ok(d.includes("不查岗"), d);
  });

  it("粘人度=50 is the balanced middle", () => {
    const d = describeDial("clingy", 50);
    assert.ok(d.includes("有分寸"), d);
  });

  it("every dimension has distinct low/mid/high text", () => {
    for (const def of DIAL_DEFS) {
      assert.notEqual(def.low, def.mid, def.id);
      assert.notEqual(def.mid, def.high, def.id);
      assert.ok(def.low.length > 0 && def.mid.length > 0 && def.high.length > 0);
    }
  });

  it("throws on unknown dial id", () => {
    assert.throws(() => getDialDef("nope" as never), /unknown dial/);
    assert.equal(isDialId("clingy"), true);
    assert.equal(isDialId("nope"), false);
  });

  it("normalize fills defaults and clamps", () => {
    const v = normalizeDialValues({ clingy: 90, humor: 500 });
    assert.equal(v.clingy, 90);
    assert.equal(v.humor, 100);
    assert.equal(v.playful, 50);
    assert.equal(v.romantic, 50);
    assert.equal(v.proactive, 50);
  });
});

describe("dial prompt section", () => {
  it("renders value + behavior per dial", () => {
    const s = buildDialsSection({ clingy: 80, playful: 30 }, { enabled: true });
    assert.ok(s.includes("粘人度 80"), s);
    assert.ok(s.includes("很黏人"), s);
    assert.ok(s.includes("活泼度 30"), s);
    assert.ok(s.includes("沉稳话少"), s);
    // all five dims always present
    for (const def of DIAL_DEFS) assert.ok(s.includes(def.name), def.id);
  });

  it("states the precedence rule: dials override evolution notes", () => {
    const s = buildDialsSection({}, { enabled: true });
    assert.ok(s.includes("OVERRIDE"), s);
    assert.ok(s.includes("evolution note"), s);
    assert.ok(s.includes("follow the DIAL"), s);
  });

  it("returns empty when disabled", () => {
    assert.equal(buildDialsSection({ clingy: 90 }, { enabled: false }), "");
  });
});

describe("dial store", () => {
  it("defaults every dial to 50", async () => {
    const s = createDialsStore(memStorage());
    const v = await s.get("p1");
    for (const id of DIAL_IDS) assert.equal(v[id], 50, id);
  });

  it("set persists, clamps, and applies immediately", async () => {
    const st = memStorage();
    const s = createDialsStore(st);
    const v = await s.set("p1", "clingy", 90);
    assert.equal(v.clingy, 90);
    assert.equal((await s.get("p1")).clingy, 90);
    // clamp on the way in
    await s.set("p1", "humor", 140);
    assert.equal((await s.get("p1")).humor, 100);
    // persisted to the right key
    const raw = JSON.parse((await st.getItem(DIALS_KEYS.values)) ?? "{}");
    assert.equal(raw.p1.clingy, 90);
  });

  it("isolates personas", async () => {
    const s = createDialsStore(memStorage());
    await s.set("p1", "clingy", 90);
    assert.equal((await s.get("p2")).clingy, 50);
  });

  it("reset restores defaults", async () => {
    const s = createDialsStore(memStorage());
    await s.set("p1", "clingy", 90);
    await s.reset("p1");
    assert.equal((await s.get("p1")).clingy, 50);
  });

  it("throws on unknown dial id", async () => {
    const s = createDialsStore(memStorage());
    await assert.rejects(() => s.set("p1", "nope" as never, 10), /unknown dial/);
  });

  it("master toggle defaults true", async () => {
    const s = createDialsStore(memStorage());
    assert.equal(await s.isEnabled(), true);
    await s.setEnabled(false);
    assert.equal(await s.isEnabled(), false);
  });
});

describe("active dials section (instances)", () => {
  it("returns the section with her values for the persona", async () => {
    // Injectable factory: same logic as production, Map-backed fake storage.
    const { createDialsInstances } = await import("../src/dials/instances.js");
    const { store, buildActiveDialsSection: build } = createDialsInstances(memStorage());
    await store.set("test-persona-dials", "clingy", 90);
    const s = await build("test-persona-dials", { incognito: false });
    assert.ok(s.includes("粘人度 90"), s);
    assert.ok(s.includes("很黏人"), s);
    await store.reset("test-persona-dials");
    const after = await build("test-persona-dials", { incognito: false });
    assert.ok(after.includes("粘人度 50"), after);
  });

  it("is empty in incognito", async () => {
    const { createDialsInstances } = await import("../src/dials/instances.js");
    const { buildActiveDialsSection: build } = createDialsInstances(memStorage());
    const s = await build("any-persona", { incognito: true });
    assert.equal(s, "");
  });

  it("is empty without a persona", async () => {
    const { createDialsInstances } = await import("../src/dials/instances.js");
    const { buildActiveDialsSection: build } = createDialsInstances(memStorage());
    const s = await build(null, { incognito: false });
    assert.equal(s, "");
  });

  it("never throws on storage failure", async () => {
    const { createDialsInstances } = await import("../src/dials/instances.js");
    const bad = {
      getItem: async () => {
        throw new Error("disk gone");
      },
      setItem: async () => {
        throw new Error("disk gone");
      },
    };
    const { buildActiveDialsSection: build } = createDialsInstances(bad);
    const s = await build("p1", { incognito: false });
    assert.equal(s, "");
  });
});

describe("honest simulation: she drags 粘人度 to 90", () => {
  it("next turn's section carries the new descriptors; reset restores", async () => {
    const s = createDialsStore(memStorage());
    // she drags the slider
    await s.set("her-persona", "clingy", 90);
    const values = await s.get("her-persona");
    const section = buildDialsSection(values, { enabled: await s.isEnabled() });
    assert.ok(section.includes("粘人度 90：很黏人"), section);
    // she hits reset
    await s.reset("her-persona");
    const after = buildDialsSection(await s.get("her-persona"), { enabled: true });
    assert.ok(!after.includes("粘人度 90"), after);
    assert.ok(after.includes("粘人度 50"), after);
  });
});
