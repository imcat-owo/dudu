import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sweepMilestoneCelebrations } from "../src/romance/milestone-sweeper.js";
import {
  buildMilestoneTopic,
  detectNewMilestones,
  emptyLedger,
  type KeyValueStorage,
  loadMilestoneCelebrationsEnabled,
  loadMilestoneLedger,
  type MilestoneLedger,
  milestoneId,
  nextCelebrationTimeMs,
  saveMilestoneCelebrationsEnabled,
  saveMilestoneLedger,
  TOGETHER_MILESTONE_DAYS,
} from "../src/romance/milestones.js";
import { createMilestoneTools } from "../src/romance/tools.js";

function memStorage(seed: Record<string, string> = {}): KeyValueStorage {
  const m = new Map(Object.entries(seed));
  return {
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => {
      m.set(k, v);
    },
  };
}

/** YYYY-MM-DD, `n` local days before nowMs's local date. */
function daysAgoStr(n: number, nowMs: number): string {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  const p = (x: number) => `${x}`.padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function shanghaiLabel(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

describe("milestone ids + detection", () => {
  it("milestone list is fixed and short (the restraint bar)", () => {
    assert.deepEqual([...TOGETHER_MILESTONE_DAYS], [7, 30, 100, 365]);
  });
  it("milestoneId is stable", () => {
    assert.equal(milestoneId(100), "together-days-100");
  });
  it("fires at each boundary, all newly-hit at once", () => {
    assert.deepEqual(detectNewMilestones(6, []), []);
    assert.deepEqual(detectNewMilestones(7, []), [7]);
    assert.deepEqual(detectNewMilestones(29, []), [7]);
    assert.deepEqual(detectNewMilestones(30, []), [7, 30]);
    assert.deepEqual(detectNewMilestones(99, []), [7, 30]);
    assert.deepEqual(detectNewMilestones(100, []), [7, 30, 100]);
    assert.deepEqual(detectNewMilestones(364, []), [7, 30, 100]);
    assert.deepEqual(detectNewMilestones(365, []), [7, 30, 100, 365]);
    assert.deepEqual(detectNewMilestones(1000, []), [7, 30, 100, 365]);
  });
  it("never refires celebrated or skipped milestones", () => {
    assert.deepEqual(
      detectNewMilestones(400, ["together-days-7", "together-days-30", "together-days-100"]),
      [365],
    );
    assert.deepEqual(detectNewMilestones(400, ["together-days-365"]), [7, 30, 100]);
  });
  it("null / invalid days -> no milestones (never invent)", () => {
    assert.deepEqual(detectNewMilestones(null, []), []);
    assert.deepEqual(detectNewMilestones(NaN, []), []);
    assert.deepEqual(detectNewMilestones(-3, []), []);
  });
});

describe("nextCelebrationTimeMs", () => {
  it("is 20:00 Shanghai today when still ahead", () => {
    // 2026-10-06 10:00 Shanghai
    const now = Date.UTC(2026, 9, 6, 2, 0, 0);
    const at = nextCelebrationTimeMs(now);
    assert.equal(shanghaiLabel(at), "2026-10-06, 20:00");
    assert.ok(at > now);
  });
  it("rolls to tomorrow 20:00 Shanghai when past", () => {
    // 2026-10-06 21:00 Shanghai
    const now = Date.UTC(2026, 9, 6, 13, 0, 0);
    const at = nextCelebrationTimeMs(now);
    assert.equal(shanghaiLabel(at), "2026-10-07, 20:00");
    assert.ok(at > now);
  });
});

describe("buildMilestoneTopic", () => {
  it("carries days, since date, and real memories", () => {
    const topic = buildMilestoneTopic(100, "2026-06-28", ["第一次一起听歌", "她说想吃火锅"]);
    assert.match(topic, /100 days together/);
    assert.match(topic, /2026-06-28/);
    assert.match(topic, /第一次一起听歌/);
    assert.match(topic, /never invent/i);
  });
  it("is honest when no memories were sampled", () => {
    const topic = buildMilestoneTopic(30, "2026-09-06", []);
    assert.match(topic, /no specific sampled memories/i);
    assert.match(topic, /never invent shared events/i);
  });
  it("contains no emoji", () => {
    const topic = buildMilestoneTopic(365, "2025-10-06", ["m1", "m2", "m3"]);
    // eslint-disable-next-line no-control-regex
    assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u.test(topic));
  });
});

describe("ledger + enabled storage", () => {
  it("round-trips the ledger", async () => {
    const s = memStorage();
    const ledger: MilestoneLedger = {
      celebrated: ["together-days-7"],
      skipped: [],
      pending: { "together-days-30": "ir_abc" },
    };
    await saveMilestoneLedger(s, ledger);
    assert.deepEqual(await loadMilestoneLedger(s), ledger);
  });
  it("returns an empty ledger on corrupt data", async () => {
    const s = memStorage({ "dudu.romance.together-milestones.v1": "not json{{" });
    assert.deepEqual(await loadMilestoneLedger(s), emptyLedger());
  });
  it("enabled defaults to true, round-trips", async () => {
    const s = memStorage();
    assert.equal(await loadMilestoneCelebrationsEnabled(s), true);
    await saveMilestoneCelebrationsEnabled(s, false);
    assert.equal(await loadMilestoneCelebrationsEnabled(s), false);
    await saveMilestoneCelebrationsEnabled(s, true);
    assert.equal(await loadMilestoneCelebrationsEnabled(s), true);
  });
});

describe("no dark patterns in the module surface", () => {
  it("exports nothing streak/decay/energy/punishment-shaped", async () => {
    const mod = await import("../src/romance/milestones.js");
    const names = Object.keys(mod);
    for (const n of names) {
      assert.ok(
        !/streak|decay|energy|punish|xp|level|tier|leaderboard/i.test(n),
        `dark-pattern-shaped export: ${n}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Sweeper
// ---------------------------------------------------------------------------

interface CreatedRule {
  personaId: string;
  title: string;
  topic: string;
  atMs: number;
}

function makeSweepDeps(
  overrides: {
    since?: string | null;
    enabled?: boolean;
    personaId?: string | null;
    ledger?: MilestoneLedger;
    memories?: string[];
    failCreate?: boolean;
    nowMs?: number;
  } = {},
) {
  const nowMs = overrides.nowMs ?? Date.UTC(2026, 9, 6, 2, 0, 0); // 2026-10-06 10:00 Shanghai
  const since = overrides.since !== undefined ? overrides.since : daysAgoStr(99, nowMs); // exactly 100 days together
  const created: CreatedRule[] = [];
  let ruleSeq = 0;
  const ledger: MilestoneLedger = overrides.ledger ?? emptyLedger();
  return {
    created,
    deps: {
      resolveSince: async () => since,
      isEnabled: async () => overrides.enabled ?? true,
      getActivePersonaId: async () =>
        overrides.personaId !== undefined ? overrides.personaId : "persona-main",
      loadLedger: async () => ({ ...ledger, pending: { ...ledger.pending } }),
      saveLedger: async (l: MilestoneLedger) => {
        ledger.celebrated = [...l.celebrated];
        ledger.skipped = [...l.skipped];
        ledger.pending = { ...l.pending };
      },
      sampleMemories: async () => overrides.memories ?? ["第一次一起听歌"],
      createRule: async (input: CreatedRule) => {
        if (overrides.failCreate) throw new Error("boom");
        created.push(input);
        ruleSeq += 1;
        return { id: `ir_test_${ruleSeq}` };
      },
      onRuleCreated: async () => {},
      nowMs: () => nowMs,
    },
    get ledger() {
      return ledger;
    },
  };
}

describe("sweepMilestoneCelebrations", () => {
  it("schedules each newly-hit milestone once, then never again", async () => {
    const { deps, created, ledger } = makeSweepDeps();
    const r1 = await sweepMilestoneCelebrations(deps);
    assert.deepEqual(r1.fired, [7, 30, 100]);
    assert.equal(r1.skipped, "ok");
    assert.equal(created.length, 3);
    // scheduled at 20:00 Shanghai today, in the active persona's voice
    for (const c of created) {
      assert.equal(c.personaId, "persona-main");
      assert.equal(shanghaiLabel(c.atMs), "2026-10-06, 20:00");
      assert.match(c.topic, /第一次一起听歌/);
    }
    assert.deepEqual(ledger.celebrated, [
      "together-days-7",
      "together-days-30",
      "together-days-100",
    ]);
    assert.equal(Object.keys(ledger.pending).length, 3);

    // second sweep: nothing new
    const before = created.length;
    const r2 = await sweepMilestoneCelebrations(deps);
    assert.deepEqual(r2.fired, []);
    assert.equal(r2.skipped, "none-due");
    assert.equal(created.length, before);
  });

  it("fires only the 7-day milestone at day 7", async () => {
    const nowMs = Date.UTC(2026, 9, 6, 2, 0, 0);
    const { deps, created } = makeSweepDeps({ since: daysAgoStr(6, nowMs), nowMs });
    const r = await sweepMilestoneCelebrations(deps);
    assert.deepEqual(r.fired, [7]);
    assert.equal(created.length, 1);
    assert.match(created[0].title, /在一起7天/);
  });

  it("stays silent when disabled", async () => {
    const { deps, created } = makeSweepDeps({ enabled: false });
    const r = await sweepMilestoneCelebrations(deps);
    assert.deepEqual(r.fired, []);
    assert.equal(r.skipped, "disabled");
    assert.equal(created.length, 0);
  });

  it("stays silent with no together date", async () => {
    const { deps, created } = makeSweepDeps({ since: null });
    const r = await sweepMilestoneCelebrations(deps);
    assert.equal(r.skipped, "no-together-date");
    assert.equal(created.length, 0);
  });

  it("stays silent with no active persona (never invents a speaker)", async () => {
    const { deps, created } = makeSweepDeps({ personaId: null });
    const r = await sweepMilestoneCelebrations(deps);
    assert.equal(r.skipped, "no-active-persona");
    assert.equal(created.length, 0);
  });

  it("a failed create is not marked celebrated and retries next sweep", async () => {
    const box = makeSweepDeps({ failCreate: true });
    const r1 = await sweepMilestoneCelebrations(box.deps);
    assert.deepEqual(r1.fired, []);
    assert.equal(r1.skipped, "create-failed");
    assert.deepEqual(box.ledger.celebrated, []);

    // next sweep with a working backend fires
    const box2 = makeSweepDeps({});
    const r2 = await sweepMilestoneCelebrations(box2.deps);
    assert.deepEqual(r2.fired, [7, 30, 100]);
  });

  it("one failing milestone does not block the others", async () => {
    let calls = 0;
    const { deps, created } = makeSweepDeps({});
    const origCreate = deps.createRule;
    deps.createRule = async (input: CreatedRule) => {
      calls += 1;
      if (calls === 2) throw new Error("boom");
      return origCreate(input);
    };
    const r = await sweepMilestoneCelebrations(deps);
    assert.deepEqual(r.fired, [7, 100]);
    assert.equal(created.length, 2);
  });
});

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

function makeToolEnv(
  overrides: { ledger?: MilestoneLedger; since?: string | null; personaId?: string | null } = {},
) {
  const storage = memStorage();
  const ledger: MilestoneLedger = overrides.ledger ?? emptyLedger();
  const archived: string[] = [];
  const initiativeStore = {
    setStatus: async () => true,
    get: async () => null,
    create: async () => ({ id: "ir_x" }),
  };
  const tools = createMilestoneTools({
    storage,
    initiativeStore: initiativeStore as never,
    getActivePersonaId: async () => overrides.personaId ?? "persona-main",
    archiveRule: async (ruleId: string) => {
      archived.push(ruleId);
    },
    getDaysTogether: async () => ({
      since: overrides.since ?? "2026-06-28",
      days: overrides.since === null ? null : 100,
    }),
  });
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  return { storage, ledger, archived, byName };
}

describe("milestone tools", () => {
  it("set_enabled(false) persists the flag and archives pending rules", async () => {
    const ledger: MilestoneLedger = {
      celebrated: ["together-days-7"],
      skipped: [],
      pending: { "together-days-30": "ir_pending_1" },
    };
    const { storage, archived, byName } = makeToolEnv({ ledger });
    await saveMilestoneLedger(storage, ledger);
    const out = await byName.milestone_celebration_set_enabled.run({ enabled: false }, {} as never);
    assert.match(out, /turned off/i);
    assert.deepEqual(archived, ["ir_pending_1"]);
    const after = await loadMilestoneLedger(storage);
    assert.deepEqual(after.pending, {});
    assert.equal(await loadMilestoneCelebrationsEnabled(storage), false);
  });

  it("cancel moves a pending milestone to skipped (never comes back)", async () => {
    const ledger: MilestoneLedger = {
      celebrated: [],
      skipped: [],
      pending: { "together-days-100": "ir_pending_2" },
    };
    const { storage, archived, byName } = makeToolEnv({ ledger });
    await saveMilestoneLedger(storage, ledger);
    const out = await byName.milestone_celebration_cancel.run({ days: 100 }, {} as never);
    assert.match(out, /cancelled/i);
    assert.deepEqual(archived, ["ir_pending_2"]);
    const after = await loadMilestoneLedger(storage);
    assert.ok(after.skipped.includes("together-days-100"));

    // the sweeper will not resurrect it
    const fresh = (await import("../src/romance/milestones.js")).detectNewMilestones(100, [
      ...after.celebrated,
      ...after.skipped,
    ]);
    assert.deepEqual(fresh, [7, 30]);
  });

  it("cancel rejects non-milestone days", async () => {
    const { byName } = makeToolEnv();
    await assert.rejects(
      () => byName.milestone_celebration_cancel.run({ days: 50 }, {} as never),
      /7, 30, 100, 365/,
    );
  });

  it("status is read-only and informative", async () => {
    const { byName } = makeToolEnv();
    const out = await byName.milestone_celebration_status.run({}, {} as never);
    assert.match(out, /Enabled: yes/);
    assert.match(out, /100 days together/);
  });
});
