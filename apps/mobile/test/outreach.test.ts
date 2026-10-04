/**
 * Proactive outreach (主动触达) — regression tests.
 *
 * The hard guarantees under test:
 *  1. No trigger = no message, ever (engine returns [] → nothing schedules).
 *  2. 安静档 never schedules, never surfaces.
 *  3. Same kind never fires twice within 24h (cooldown).
 *  4. Triggers carry concrete content — empty "在吗"-style messages are
 *     impossible by construction.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateOutreachTriggers,
  isOutreachFrequency,
  OUTREACH_COOLDOWN_MS,
  type OutreachEvalInput,
} from "../src/outreach/engine.js";
import { buildOutreachSection } from "../src/outreach/prompt.js";
import { DEFAULT_FREQUENCY, OutreachStore } from "../src/outreach/store.js";
import {
  evaluateAndScheduleOutreach,
  OUTREACH_NOTIFICATION_ID,
} from "../src/outreach/notify.js";
import type { OutreachFrequency } from "../src/outreach/engine.js";

const NOW = 1_780_000_000_000;

function baseInput(over: Partial<OutreachEvalInput> = {}): OutreachEvalInput {
  return {
    frequency: "moderate",
    now: NOW,
    anniversaries: [],
    pendingTellLater: [],
    unreadLoveLetters: 0,
    lastOpenedAt: NOW - 86_400_000,
    lastOutreachAt: {},
    ...over,
  };
}

describe("evaluateOutreachTriggers", () => {
  it("stays silent when there is nothing: no trigger = no message", () => {
    assert.deepEqual(evaluateOutreachTriggers(baseInput()), []);
  });

  it("quiet frequency never yields triggers, even with real reasons", () => {
    const triggers = evaluateOutreachTriggers(
      baseInput({
        frequency: "quiet",
        anniversaries: [{ title: "纪念日", daysUntil: 1 }],
        unreadLoveLetters: 2,
        pendingTellLater: [{ id: "t1", text: "记得买牛奶" }],
        lastOpenedAt: NOW - 30 * 86_400_000,
        diaryNudge: { lastEntryAt: NOW - 30 * 86_400_000, anchor: "一起看的第一场电影" },
      }),
    );
    assert.deepEqual(triggers, []);
  });

  it("anniversary wins priority and carries the title", () => {
    const triggers = evaluateOutreachTriggers(
      baseInput({
        anniversaries: [{ title: "在一起一周年", daysUntil: 2 }],
        unreadLoveLetters: 1,
      }),
    );
    assert.equal(triggers[0].kind, "anniversary");
    assert.equal(triggers[0].detail, "在一起一周年");
  });

  it("moderate ignores anniversaries beyond 3 days; active sees 7", () => {
    const ann = [{ title: "生日", daysUntil: 5 }];
    assert.deepEqual(evaluateOutreachTriggers(baseInput({ frequency: "moderate", anniversaries: ann })), []);
    const active = evaluateOutreachTriggers(baseInput({ frequency: "active", anniversaries: ann }));
    assert.equal(active[0].kind, "anniversary");
  });

  it("love letter is a trigger by itself; tell_later carries its text", () => {
    const ll = evaluateOutreachTriggers(baseInput({ unreadLoveLetters: 1 }));
    assert.equal(ll[0].kind, "love_letter");
    const tl = evaluateOutreachTriggers(
      baseInput({ pendingTellLater: [{ id: "t1", text: "牙医预约改到周五了" }] }),
    );
    assert.equal(tl[0].kind, "tell_later");
    assert.equal(tl[0].detail, "牙医预约改到周五了");
  });

  it("empty tell_later text is not a trigger (no empty pings)", () => {
    const triggers = evaluateOutreachTriggers(
      baseInput({ pendingTellLater: [{ id: "t1", text: "   " }] }),
    );
    assert.deepEqual(triggers, []);
  });

  it("silence needs a real absence: moderate=4d, active=2d", () => {
    const gap3d = NOW - 3 * 86_400_000;
    assert.deepEqual(
      evaluateOutreachTriggers(baseInput({ frequency: "moderate", lastOpenedAt: gap3d })),
      [],
    );
    const active = evaluateOutreachTriggers(
      baseInput({ frequency: "active", lastOpenedAt: gap3d }),
    );
    assert.equal(active[0].kind, "silence");
  });

  it("fresh install (no baseline) never fires silence", () => {
    const triggers = evaluateOutreachTriggers(baseInput({ lastOpenedAt: null }));
    assert.deepEqual(triggers, []);
  });

  it("cooldown: same kind never fires twice within 24h", () => {
    const last = { love_letter: NOW - OUTREACH_COOLDOWN_MS + 1000 };
    assert.deepEqual(
      evaluateOutreachTriggers(baseInput({ unreadLoveLetters: 1, lastOutreachAt: last })),
      [],
    );
    const expired = { love_letter: NOW - OUTREACH_COOLDOWN_MS - 1000 };
    const ok = evaluateOutreachTriggers(
      baseInput({ unreadLoveLetters: 1, lastOutreachAt: expired }),
    );
    assert.equal(ok[0].kind, "love_letter");
  });

  it("isOutreachFrequency rejects junk", () => {
    assert.equal(isOutreachFrequency("active"), true);
    assert.equal(isOutreachFrequency("moderate"), true);
    assert.equal(isOutreachFrequency("quiet"), true);
    assert.equal(isOutreachFrequency("loud"), false);
    assert.equal(isOutreachFrequency(null), false);
  });
});

describe("diary_nudge (xiaomeng P2-1)", () => {
  it("fires when the diary is stale AND a real anchor exists", () => {
    const triggers = evaluateOutreachTriggers(
      baseInput({
        diaryNudge: { lastEntryAt: NOW - 10 * 86_400_000, anchor: "一起看的第一场电影" },
      }),
    );
    assert.equal(triggers.length, 1);
    assert.equal(triggers[0].kind, "diary_nudge");
    assert.equal(triggers[0].detail, "一起看的第一场电影");
  });

  it("stays silent when the anchor is empty — never random", () => {
    const triggers = evaluateOutreachTriggers(
      baseInput({ diaryNudge: { lastEntryAt: NOW - 30 * 86_400_000, anchor: "   " } }),
    );
    assert.deepEqual(triggers, []);
  });

  it("stays silent when the diary is fresh", () => {
    const triggers = evaluateOutreachTriggers(
      baseInput({ diaryNudge: { lastEntryAt: NOW - 2 * 86_400_000, anchor: "一起看的第一场电影" } }),
    );
    assert.deepEqual(triggers, []);
  });

  it("stays silent without diary input at all", () => {
    assert.deepEqual(evaluateOutreachTriggers(baseInput()), []);
  });

  it("yields to higher-priority triggers", () => {
    const triggers = evaluateOutreachTriggers(
      baseInput({
        pendingTellLater: [{ id: "t1", text: "记得买牛奶" }],
        diaryNudge: { lastEntryAt: NOW - 30 * 86_400_000, anchor: "一起看的第一场电影" },
      }),
    );
    assert.equal(triggers[0].kind, "tell_later");
    assert.equal(triggers[1].kind, "diary_nudge");
  });

  it("cools down for 24h like every other kind", () => {
    const dn = { lastEntryAt: NOW - 30 * 86_400_000, anchor: "一起看的第一场电影" };
    const first = evaluateOutreachTriggers(baseInput({ diaryNudge: dn }));
    assert.equal(first[0].kind, "diary_nudge");
    const second = evaluateOutreachTriggers(
      baseInput({ diaryNudge: dn, lastOutreachAt: { diary_nudge: NOW - 3_600_000 } }),
    );
    assert.deepEqual(second, []);
  });

  it("the prompt section tells him to write quietly, not announce", () => {
    const s = buildOutreachSection([{ kind: "diary_nudge", priority: 3, detail: "一起看的第一场电影" }]);
    assert.ok(s.includes("diary_write"));
    assert.ok(s.includes("一起看的第一场电影"));
    assert.ok(s.includes("quietly"));
  });
});

describe("buildOutreachSection", () => {
  it("empty string when no triggers — no noise in the prompt", () => {
    assert.equal(buildOutreachSection([]), "");
  });

  it("surfaces at most one trigger and forbids nagging/guilt", () => {
    const s = buildOutreachSection([
      { kind: "love_letter", priority: 1, detail: "" },
      { kind: "silence", priority: 3, detail: "" },
    ]);
    assert.ok(s.includes("love letter"));
    assert.ok(s.includes("NEVER ask"));
    assert.ok(!s.includes("silence"));
  });

  it("silence trigger forbids guilt-tripping", () => {
    const s = buildOutreachSection([{ kind: "silence", priority: 3, detail: "" }]);
    assert.ok(s.includes("missed you"));
    assert.ok(s.includes("forbidden"));
  });
});

function memStorage() {
  const map = new Map<string, string>();
  return {
    getItem: async (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: async (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

describe("OutreachStore", () => {
  it("defaults to moderate", async () => {
    const store = new OutreachStore(memStorage());
    assert.equal(await store.getFrequency(), DEFAULT_FREQUENCY);
    assert.equal(DEFAULT_FREQUENCY, "moderate");
  });

  it("round-trips frequency and rejects junk from storage", async () => {
    const st = memStorage();
    const store = new OutreachStore(st);
    await store.setFrequency("quiet");
    assert.equal(await store.getFrequency(), "quiet");
    await st.setItem("dudu.outreach.v1.frequency", "loud");
    assert.equal(await store.getFrequency(), "moderate");
  });

  it("markOpened / markOutreach bookkeeping", async () => {
    const store = new OutreachStore(memStorage());
    assert.equal(await store.getLastOpenedAt(), null);
    await store.markOpened(NOW);
    assert.equal(await store.getLastOpenedAt(), NOW);
    await store.markOutreach("love_letter", NOW);
    assert.deepEqual(await store.getLastOutreachAt(), { love_letter: NOW });
  });
});

describe("evaluateAndScheduleOutreach", () => {
  function deps(over: Record<string, unknown> = {}) {
    const storage = memStorage();
    const store = new OutreachStore(storage);
    const scheduled: { identifier: string; title: string; body: string; seconds: number }[] = [];
    const cancelled: string[] = [];
    const traces: unknown[] = [];
    const d = {
      store,
      notifications: {
        getPermissionsAsync: async () => ({ status: "granted" }),
        cancelScheduledNotificationAsync: async (id: string) => {
          cancelled.push(id);
        },
        scheduleNotificationAsync: async (req: {
          identifier: string;
          content: { title: string; body: string };
          trigger: { seconds: number };
        }) => {
          scheduled.push({
            identifier: req.identifier,
            title: req.content.title,
            body: req.content.body,
            seconds: req.trigger.seconds,
          });
          return req.identifier;
        },
      },
      trace: {
        append: async (e: unknown) => {
          traces.push(e);
          return e;
        },
      },
      data: {
        listAnniversaries: async () => [] as { title: string; date: string }[],
        listPendingTellLater: async () => [] as { id: string; text: string }[],
        countUnreadLoveLetters: async () => 0,
      },
      copy: (key: string, params?: Record<string, string | number>) => {
        let s = key;
        for (const [k, v] of Object.entries(params ?? {})) s = s.replaceAll(`{${k}}`, String(v));
        return s;
      },
      now: NOW,
      ...over,
    };
    return { d, store, scheduled, cancelled, traces };
  }

  it("schedules nothing when there is no trigger", async () => {
    const { d, scheduled } = deps();
    const r = await evaluateAndScheduleOutreach(d as never);
    assert.equal(r.scheduled, false);
    assert.equal(r.reason, "no-trigger");
    assert.equal(scheduled.length, 0);
  });

  it("quiet frequency never schedules", async () => {
    const { d, store, scheduled } = deps({
      data: {
        listAnniversaries: async () => [],
        listPendingTellLater: async () => [],
        countUnreadLoveLetters: async () => 1,
      },
    });
    await store.setFrequency("quiet");
    const r = await evaluateAndScheduleOutreach(d as never);
    assert.equal(r.scheduled, false);
    assert.equal(r.reason, "quiet");
    assert.equal(scheduled.length, 0);
  });

  it("schedules one notification for a love letter and leaves a trace", async () => {
    const { d, scheduled, traces, cancelled } = deps({
      data: {
        listAnniversaries: async () => [],
        listPendingTellLater: async () => [],
        countUnreadLoveLetters: async () => 1,
      },
    });
    const r = await evaluateAndScheduleOutreach(d as never);
    assert.equal(r.scheduled, true);
    assert.equal(r.trigger, "love_letter");
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].identifier, OUTREACH_NOTIFICATION_ID);
    assert.ok(cancelled.includes(OUTREACH_NOTIFICATION_ID));
    assert.equal(traces.length, 1);
    assert.equal((traces[0] as { action: string }).action, "proactive_send");
  });

  it("no permission = no schedule, no nag", async () => {
    const { d, scheduled } = deps({
      data: {
        listAnniversaries: async () => [],
        listPendingTellLater: async () => [],
        countUnreadLoveLetters: async () => 1,
      },
    });
    (d as { notifications: { getPermissionsAsync: () => Promise<{ status: string }> } }).notifications.getPermissionsAsync =
      async () => ({ status: "denied" });
    const r = await evaluateAndScheduleOutreach(d as never);
    assert.equal(r.scheduled, false);
    assert.equal(r.reason, "no-permission");
    assert.equal(scheduled.length, 0);
  });

  it("second evaluation within 24h stays silent (cooldown persisted)", async () => {
    const shared = memStorage();
    const mk = () =>
      deps({
        data: {
          listAnniversaries: async () => [],
          listPendingTellLater: async () => [],
          countUnreadLoveLetters: async () => 1,
        },
      });
    const a = mk();
    (a.d as { store: OutreachStore }).store = new OutreachStore(shared);
    const r1 = await evaluateAndScheduleOutreach(a.d as never);
    assert.equal(r1.scheduled, true);
    const b = mk();
    (b.d as { store: OutreachStore }).store = new OutreachStore(shared);
    const r2 = await evaluateAndScheduleOutreach(b.d as never);
    assert.equal(r2.scheduled, false);
    assert.equal(r2.reason, "no-trigger");
  });

  it("never throws on failing data sources", async () => {
    const { d } = deps({
      data: {
        listAnniversaries: async () => {
          throw new Error("db gone");
        },
        listPendingTellLater: async () => {
          throw new Error("db gone");
        },
        countUnreadLoveLetters: async () => {
          throw new Error("db gone");
        },
      },
    });
    const r = await evaluateAndScheduleOutreach(d as never);
    assert.equal(r.scheduled, false);
  });

  it("stays silent during her sleep window (06:00-16:00 Shanghai)", async () => {
    // 10:30 Shanghai — deep in her sleep window.
    const sleepyNow = Date.UTC(2026, 9, 5, 2, 30, 0);
    const { d, store, scheduled } = deps({ now: sleepyNow });
    await store.markOpened(sleepyNow - 10 * 86_400_000); // long silence → trigger exists
    const r = await evaluateAndScheduleOutreach(d as never);
    assert.equal(r.scheduled, false);
    assert.equal(r.reason, "sleep-window");
    assert.equal(r.trigger, "silence");
    assert.equal(scheduled.length, 0);
  });

  it("an anniversary still wakes the scheduler during her sleep window", async () => {
    const sleepyNow = Date.UTC(2026, 9, 5, 2, 30, 0);
    const { d, scheduled } = deps({
      now: sleepyNow,
      data: {
        listAnniversaries: async () => [{ title: "相识纪念日", date: "2026-10-05" }],
        listPendingTellLater: async () => [] as { id: string; text: string }[],
        countUnreadLoveLetters: async () => 0,
      },
    });
    const r = await evaluateAndScheduleOutreach(d as never);
    assert.equal(r.scheduled, true);
    assert.equal(r.trigger, "anniversary");
    assert.equal(scheduled.length, 1);
  });
});
