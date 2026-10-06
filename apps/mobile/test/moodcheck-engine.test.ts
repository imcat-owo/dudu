/**
 * Daily mood check-in （每日心情 check-in） — engine tests.
 *
 * Under test:
 *  1. Happy path: at her hour, enabled, no mood yet, she wasn't active →
 *     fires ONCE through the injected delivery path, ledger marked
 *     (lastCheckinDay + pending). A second tick the same day does not refire.
 *  2. Disabled → silent. Not yet her hour → silent.
 *  3. Smart skip: mood already recorded today → no nudge.
 *  4. Smart skip: she was active recently → no nudge.
 *  5. Don't nag: yesterday's check-in got no answer → today stays quiet,
 *     outcome becomes "skipped".
 *  6. First-run persona resolution: picks the first persona, persists it.
 *  7. Deleted persona → silent, never fires.
 *  8. A failed fire (e.g. capped) still marks the ledger — no retry, ever.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCheckinTitle,
  buildCheckinTopic,
  checkDueMoodcheck,
  RECENTLY_ACTIVE_MS,
  type MoodcheckEngineDeps,
  type MoodcheckTickResult,
} from "../src/moodcheck/engine.js";
import { MoodcheckStore } from "../src/moodcheck/store.js";
import type { FireOutcome } from "../src/initiative/executor.js";
import { InitiativeStore } from "../src/initiative/store.js";

// Tue 2026-10-06 20:00 Shanghai — exactly her default hour.
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
  deps: MoodcheckEngineDeps;
  moodcheckStore: MoodcheckStore;
  initiativeStore: InitiativeStore;
  fired: Array<{ ruleId: string; slotTime: number }>;
  mutated: string[];
  traces: Array<{ action: string }>;
  persona: { id: string; name: string } | null;
  personas: Array<{ id: string; name: string }>;
  lastOpenedAt: number;
  fireImpl: (ruleId: string, slotTime: number) => Promise<FireOutcome>;
}

function makeHarness(nowMs: number = NOW): Harness {
  const kv = fakeKv();
  const moodcheckStore = new MoodcheckStore(kv, { nowMs: () => nowMs });
  const initiativeStore = new InitiativeStore(kv, { nowMs: () => nowMs });
  const h: Harness = {
    deps: null as unknown as MoodcheckEngineDeps,
    moodcheckStore,
    initiativeStore,
    fired: [],
    mutated: [],
    traces: [],
    persona: { id: "p1", name: "小梦" },
    personas: [{ id: "p1", name: "小梦" }],
    lastOpenedAt: 0,
    fireImpl: async (ruleId, slotTime) => {
      h.fired.push({ ruleId, slotTime });
      return { fired: true } as FireOutcome;
    },
  };
  h.deps = {
    moodcheckStore,
    initiativeStore,
    listPersonas: async () => h.personas,
    getPersona: async (id) => (h.persona && h.persona.id === id ? (h.persona as never) : null),
    fireRule: (ruleId, slotTime) => h.fireImpl(ruleId, slotTime),
    onMutated: async (rule) => {
      h.mutated.push(rule.id);
    },
    lastOpenedAt: async () => h.lastOpenedAt,
    trace: {
      append: async (e: { action: string }) => {
        h.traces.push(e);
        return undefined as never;
      },
    } as unknown as Harness["deps"]["trace"],
    nowMs: () => nowMs,
  };
  return h;
}

async function tick(h: Harness, nowMs: number = NOW): Promise<MoodcheckTickResult> {
  return checkDueMoodcheck({ ...h.deps, nowMs: () => nowMs }, nowMs);
}

describe("moodcheck engine", () => {
  it("fires once at her hour, marks the ledger, never refires the same day", async () => {
    const h = makeHarness();
    const r1 = await tick(h);
    assert.equal(r1.fired, true);
    assert.equal(h.fired.length, 1);
    assert.equal(h.mutated.length, 1);
    assert.equal(await h.moodcheckStore.getLastCheckinDay(), "2026-10-06");
    assert.equal(await h.moodcheckStore.getLastOutcome(), "pending");
    assert.ok(h.traces.some((t) => t.action === "moodcheck_fired"));

    const r2 = await tick(h);
    assert.equal(r2.fired, false);
    assert.equal(r2.reason, "already-fired-today");
    assert.equal(h.fired.length, 1, "no second fire");
  });

  it("the fired rule is a one_time check-in rule for her persona", async () => {
    const h = makeHarness();
    await tick(h);
    const rule = await h.initiativeStore.get(h.fired[0].ruleId);
    assert.ok(rule);
    assert.equal(rule!.type, "one_time");
    assert.equal(rule!.personaId, "p1");
    // The topic names the forbidden words only inside a "never say" instruction.
    assert.ok(
      /不要出现.*"打卡".*"check-in".*"记录"/s.test(rule!.topic),
      "topic forbids form words",
    );
  });

  it("disabled → silent", async () => {
    const h = makeHarness();
    await h.moodcheckStore.setConfig({ enabled: false });
    const r = await tick(h);
    assert.equal(r.fired, false);
    assert.equal(r.reason, "disabled");
    assert.equal(h.fired.length, 0);
  });

  it("before her hour → silent", async () => {
    const h = makeHarness();
    // 19:00 Shanghai — an hour early.
    const r = await tick(h, Date.UTC(2026, 9, 6, 11, 0, 0));
    assert.equal(r.fired, false);
    assert.equal(r.reason, "not-yet-time");
  });

  it("smart skip: mood already recorded today → no nudge", async () => {
    const h = makeHarness();
    await h.moodcheckStore.setConfig({ personaId: "p1" });
    await h.moodcheckStore.record({ personaId: "p1", mood: "挺好的", source: "chat" });
    const r = await tick(h);
    assert.equal(r.fired, false);
    assert.equal(r.reason, "already-recorded");
    assert.ok(h.traces.some((t) => t.action === "moodcheck_skipped"));
  });

  it("smart skip: she was active recently → no nudge", async () => {
    const h = makeHarness();
    h.lastOpenedAt = NOW - RECENTLY_ACTIVE_MS + 60_000; // 1 minute inside the window
    const r = await tick(h);
    assert.equal(r.fired, false);
    assert.equal(r.reason, "recently-active");
  });

  it("active long ago does not block the check-in", async () => {
    const h = makeHarness();
    h.lastOpenedAt = NOW - RECENTLY_ACTIVE_MS - 60_000;
    const r = await tick(h);
    assert.equal(r.fired, true);
  });

  it("don't nag: yesterday fired with no answer → today stays quiet", async () => {
    const h = makeHarness();
    await h.moodcheckStore.setConfig({ personaId: "p1" });
    await h.moodcheckStore.setLastCheckinDay("2026-10-05"); // yesterday
    await h.moodcheckStore.setLastOutcome("pending"); // never answered
    const r = await tick(h);
    assert.equal(r.fired, false);
    assert.equal(r.reason, "no-reply-yesterday");
    assert.equal(await h.moodcheckStore.getLastOutcome(), "skipped");
  });

  it("answered yesterday → today fires normally", async () => {
    const h = makeHarness();
    await h.moodcheckStore.setConfig({ personaId: "p1" });
    await h.moodcheckStore.setLastCheckinDay("2026-10-05");
    await h.moodcheckStore.setLastOutcome("answered");
    const r = await tick(h);
    assert.equal(r.fired, true);
  });

  it("first run resolves the persona once and persists the choice", async () => {
    const h = makeHarness();
    await tick(h);
    const config = await h.moodcheckStore.getConfig();
    assert.equal(config.personaId, "p1");
  });

  it("deleted persona → silent, never fires", async () => {
    const h = makeHarness();
    await h.moodcheckStore.setConfig({ personaId: "p1" });
    h.persona = null;
    const r = await tick(h);
    assert.equal(r.fired, false);
    assert.equal(r.reason, "no-persona");
    assert.equal(h.fired.length, 0);
  });

  it("no personas at all → silent", async () => {
    const h = makeHarness();
    h.personas = [];
    const r = await tick(h);
    assert.equal(r.fired, false);
    assert.equal(r.reason, "no-persona");
  });

  it("a failed fire (capped) still marks the ledger — no retry ever", async () => {
    const h = makeHarness();
    h.fireImpl = async () => ({ fired: false, reason: "capped" }) as FireOutcome;
    const r = await tick(h);
    assert.equal(r.fired, true, "the attempt counts as fired");
    assert.equal(await h.moodcheckStore.getLastCheckinDay(), "2026-10-06");
    const r2 = await tick(h);
    assert.equal(r2.reason, "already-fired-today");
  });

  it("topic/title builders stay honest", () => {
    assert.equal(buildCheckinTitle(), "问问她今天怎么样");
    const topic = buildCheckinTopic();
    assert.ok(topic.includes("打卡") && topic.includes("不要"), "tells the model what NOT to say");
  });
});
