/**
 * Daily mood check-in （每日心情 check-in） — tool tests.
 *
 * Under test:
 *  1. moodcheck_record: stores the entry, updates her latest mood,
 *     writes a memory on rough days (not on clearly-good days), marks
 *     the check-in outcome "answered".
 *  2. Validation: empty mood / too-long mood rejected.
 *  3. One entry per day: recording twice updates, never duplicates.
 *  4. moodcheck_list / moodcheck_delete round-trip.
 *  5. moodcheck_set_config: hour validation (rejects 06:00–16:00 and
 *     out-of-range), toggle, persona validation, no-arg reports current.
 *  6. shouldRemember: rough/neutral/noted days remembered, clearly
 *     good days stay on the timeline only.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MoodcheckStore } from "../src/moodcheck/store.js";
import {
  createMoodcheckTools,
  shouldRemember,
  type MoodcheckToolEnv,
} from "../src/moodcheck/tools.js";

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

interface ToolHarness {
  tools: ReturnType<typeof createMoodcheckTools>;
  store: MoodcheckStore;
  herMoods: Array<{ mood: string; note: string }>;
  memories: Array<{ content: string; opts: unknown }>;
}

function makeHarness(): ToolHarness {
  const store = new MoodcheckStore(fakeKv(), { nowMs: () => NOW });
  const h: ToolHarness = {
    tools: null as unknown as ToolHarness["tools"],
    store,
    herMoods: [],
    memories: [],
  };
  const env: MoodcheckToolEnv = {
    moodcheckStore: store,
    setHerMood: async (mood, note) => {
      h.herMoods.push({ mood, note });
    },
    addMemory: async (content, opts) => {
      h.memories.push({ content, opts });
    },
    getPersona: async (id) => (id === "p1" ? { id: "p1", name: "小梦" } : null),
    listPersonas: async () => [{ id: "p1", name: "小梦" }],
    nowMs: () => NOW,
  };
  h.tools = createMoodcheckTools(env);
  return h;
}

function tool(h: ToolHarness, name: string) {
  const t = h.tools.find((x) => x.name === name);
  assert.ok(t, `tool ${name} exists`);
  return t!;
}

const CTX = { authorize: async () => true } as never;

async function run(t: ReturnType<typeof tool>, args: Record<string, unknown>): Promise<string> {
  return (await t.run(args, CTX)) as string;
}

describe("moodcheck tools", () => {
  it("record: stores entry + updates her mood + remembers a rough day", async () => {
    const h = makeHarness();
    await h.store.setLastCheckinDay("2026-10-06"); // today's check-in fired
    const out = await run(tool(h, "moodcheck_record"), {
      personaId: "p1",
      mood: "有点累",
      note: "加班到很晚",
    });
    assert.ok(out.includes("有点累"));

    const entry = await h.store.getDay("2026-10-06", "p1");
    assert.ok(entry);
    assert.equal(entry!.source, "checkin", "recorded on the check-in day → checkin source");
    assert.equal(h.herMoods.length, 1);
    assert.equal(h.herMoods[0].mood, "有点累");
    assert.equal(h.memories.length, 1, "rough day becomes a memory");
    assert.ok(h.memories[0].content.includes("10月6日"));
    assert.ok(h.memories[0].content.includes("有点累"));
    assert.equal(
      (h.memories[0].opts as { actor: string }).actor,
      "user",
      "her words, her memory",
    );
    assert.equal(await h.store.getLastOutcome(), "answered");
  });

  it("record: a clearly good day stays on the timeline only", async () => {
    const h = makeHarness();
    await run(tool(h, "moodcheck_record"), { personaId: "p1", mood: "挺好的" });
    assert.equal(h.memories.length, 0, "no memory card for a good day");
    assert.equal((await h.store.list()).length, 1, "timeline keeps it");
  });

  it("record: source is chat when no check-in fired today", async () => {
    const h = makeHarness();
    await run(tool(h, "moodcheck_record"), { personaId: "p1", mood: "还行" });
    const entry = await h.store.getDay("2026-10-06", "p1");
    assert.equal(entry!.source, "chat");
  });

  it("record: twice the same day updates, never duplicates", async () => {
    const h = makeHarness();
    await run(tool(h, "moodcheck_record"), { personaId: "p1", mood: "累" });
    await run(tool(h, "moodcheck_record"), { personaId: "p1", mood: "还行了" });
    assert.equal((await h.store.list()).length, 1);
    const entry = await h.store.getDay("2026-10-06", "p1");
    assert.equal(entry!.mood, "还行了");
  });

  it("record: validation", async () => {
    const h = makeHarness();
    const t = tool(h, "moodcheck_record");
    await assert.rejects(() => run(t, { personaId: "p1", mood: "   " }));
    await assert.rejects(() => run(t, { personaId: "p1", mood: "x".repeat(41) }));
    await assert.rejects(() => run(t, { personaId: "nope", mood: "好" }));
  });

  it("record: defaults to the configured persona", async () => {
    const h = makeHarness();
    await h.store.setConfig({ personaId: "p1" });
    await run(tool(h, "moodcheck_record"), { mood: "好" });
    assert.ok(await h.store.getDay("2026-10-06", "p1"));
  });

  it("list + delete round-trip", async () => {
    const h = makeHarness();
    await run(tool(h, "moodcheck_record"), { personaId: "p1", mood: "累" });
    const listed = await run(tool(h, "moodcheck_list"), {});
    assert.ok(listed.includes("累"));
    const entry = await h.store.getDay("2026-10-06", "p1");
    const del = await run(tool(h, "moodcheck_delete"), { entryId: entry!.id });
    assert.ok(del.includes("Deleted"));
    assert.equal((await h.store.list()).length, 0);
    await assert.rejects(() =>
      run(tool(h, "moodcheck_delete"), { entryId: entry!.id }),
    );
  });

  it("set_config: hour validation", async () => {
    const h = makeHarness();
    const t = tool(h, "moodcheck_set_config");
    // Sleep window hours are refused.
    await assert.rejects(() => run(t, { hour: 8 }));
    await assert.rejects(() => run(t, { hour: 6 }));
    await assert.rejects(() => run(t, { hour: 15 }));
    // Out of range refused.
    await assert.rejects(() => run(t, { hour: 24 }));
    await assert.rejects(() => run(t, { hour: -1 }));
    // Evening hours accepted.
    const out = await run(t, { hour: 21 });
    assert.ok(out.includes("21:00"));
    assert.equal((await h.store.getConfig()).hour, 21);
  });

  it("set_config: toggle + persona + report", async () => {
    const h = makeHarness();
    const t = tool(h, "moodcheck_set_config");
    const off = await run(t, { enabled: false });
    assert.ok(off.includes("off"));
    assert.equal((await h.store.getConfig()).enabled, false);
    await assert.rejects(() => run(t, { personaId: "nope" }));
    const ok = await run(t, { enabled: true, personaId: "p1" });
    assert.ok(ok.includes("on"));
    const report = await run(t, {});
    assert.ok(report.includes("20:00") || report.includes("on"));
  });

  it("shouldRemember: rough/neutral/noted days yes, clearly-good days no", () => {
    assert.equal(shouldRemember("很糟", ""), true);
    assert.equal(shouldRemember("有点累", ""), true);
    assert.equal(shouldRemember("还行", ""), true);
    assert.equal(shouldRemember("烦", ""), true);
    assert.equal(shouldRemember("挺好的", "升职了"), true, "a note always remembers");
    assert.equal(shouldRemember("挺好的", ""), false);
    assert.equal(shouldRemember("超开心", ""), false);
    assert.equal(shouldRemember("不错", ""), false);
  });
});
