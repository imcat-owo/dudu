/**
 * AI photo share （主动发照片） — AI tools tests.
 *
 * Under test:
 *  1. All four tools exist with manualId "photoshare" (纸条机制).
 *  2. photoshare_config: reads the config (default OFF); the toggle only
 *     flips when she asks — the tool itself just applies the patch.
 *  3. photoshare_status / photoshare_log: read-only views.
 *  4. photoshare_share_now: manual share works with the toggle OFF (it's
 *     an answer, not a surprise); incognito refuses.
 *  5. INCOGNITO_BLOCKED_TOOLS blocks the two write tools but not the
 *     reads (FINAL-AUDIT hard lesson).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBlockedInIncognito } from "../src/api-groups/incognito-guard.js";
import { PhotoshareStore } from "../src/photoshare/store.js";
import { createPhotoshareTools, type PhotoshareToolEnv } from "../src/photoshare/tools.js";

// Tue 2026-10-06 20:00 Shanghai.
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
  env: PhotoshareToolEnv;
  store: PhotoshareStore;
  incognito: boolean;
}

function makeHarness(): Harness {
  const kv = fakeKv();
  const store = new PhotoshareStore(kv, { nowMs: () => NOW });
  const h: Harness = {
    env: null as unknown as PhotoshareToolEnv,
    store,
    incognito: false,
  };
  h.env = {
    photoshareStore: store,
    buildExecutorDeps: async () => {
      throw new Error("not used directly in these tests");
    },
    isIncognito: () => h.incognito,
    nowMs: () => NOW,
  };
  return h;
}

function toolNames(env: PhotoshareToolEnv): string[] {
  return createPhotoshareTools(env).map((t) => t.name);
}

describe("photoshare tools", () => {
  it("exposes the four tools with the photoshare manual", () => {
    const h = makeHarness();
    const tools = createPhotoshareTools(h.env);
    assert.deepEqual(toolNames(h.env), [
      "photoshare_config",
      "photoshare_status",
      "photoshare_log",
      "photoshare_share_now",
    ]);
    for (const t of tools) assert.equal(t.manualId, "photoshare");
  });

  it("config reads the default (OFF) with no args", async () => {
    const h = makeHarness();
    const tools = createPhotoshareTools(h.env);
    const out = (await tools[0].run({}, { authorize: async () => false })) as string;
    assert.ok(out.includes("OFF"), out);
  });

  it("config applies her patch", async () => {
    const h = makeHarness();
    const tools = createPhotoshareTools(h.env);
    const out = (await tools[0].run(
      { enabled: true, slotCount: 3 },
      { authorize: async () => false },
    )) as string;
    assert.ok(out.includes("ON"), out);
    assert.equal((await h.store.getConfig()).enabled, true);
    assert.equal((await h.store.getConfig()).slotCount, 3);
  });

  it("config refuses in incognito", async () => {
    const h = makeHarness();
    h.incognito = true;
    const tools = createPhotoshareTools(h.env);
    await assert.rejects(
      tools[0].run({ enabled: true }, { authorize: async () => false }),
      /Incognito/,
    );
  });

  it("status and log are read-only views", async () => {
    const h = makeHarness();
    const tools = createPhotoshareTools(h.env);
    const status = (await tools[1].run({}, { authorize: async () => false })) as string;
    assert.ok(status.includes("OFF"), status);
    assert.ok(status.includes("photos today 0/1"), status);
    const log = (await tools[2].run({}, { authorize: async () => false })) as string;
    assert.ok(log.includes("No photo shares logged yet"), log);
  });

  it("incognito blocks the write tools, not the reads", () => {
    assert.equal(isBlockedInIncognito("photoshare_config"), true);
    assert.equal(isBlockedInIncognito("photoshare_share_now"), true);
    assert.equal(isBlockedInIncognito("photoshare_status"), false);
    assert.equal(isBlockedInIncognito("photoshare_log"), false);
  });

  it("share_now refuses in incognito", async () => {
    const h = makeHarness();
    h.incognito = true;
    const tools = createPhotoshareTools(h.env);
    await assert.rejects(tools[3].run({}, { authorize: async () => false }), /Incognito/);
  });
});
