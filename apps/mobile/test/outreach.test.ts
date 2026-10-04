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
  isNegativeMoodWord,
  isOutreachFrequency,
  isRecentNegativeMood,
  LOVE_LETTER_NUDGE_CAP,
  OUTREACH_COOLDOWN_MS,
  type OutreachEvalInput,
} from "../src/outreach/engine.js";
import { buildOutreachSection } from "../src/outreach/prompt.js";
import { DEFAULT_FREQUENCY, OutreachStore } from "../src/outreach/store.js";
import {
  clampFireOutOfSleepWindow,
  evaluateAndScheduleOutreach,
  notificationDeepLink,
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
    const scheduled: {
      identifier: string;
      title: string;
      body: string;
      data?: Record<string, string>;
      seconds: number;
    }[] = [];
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
          content: { title: string; body: string; data?: Record<string, string> };
          trigger: { seconds: number };
        }) => {
          scheduled.push({
            identifier: req.identifier,
            title: req.content.title,
            body: req.content.body,
            data: req.content.data,
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

describe("notificationDeepLink (user P2-1)", () => {
  it("routes every trigger kind to a real screen", () => {
    assert.deepEqual(notificationDeepLink("love_letter"), {
      section: "space",
      page: "loveLetters",
    });
    assert.deepEqual(notificationDeepLink("diary_nudge"), {
      section: "space",
      page: "diary",
      compose: true,
    });
    assert.deepEqual(notificationDeepLink("anniversary"), {
      section: "space",
      page: "anniversary",
    });
    assert.deepEqual(notificationDeepLink("tell_later"), {
      section: "space",
      page: "tellLater",
    });
    assert.deepEqual(notificationDeepLink("silence"), { section: "chat" });
    assert.deepEqual(notificationDeepLink("on_this_day"), {
      section: "space",
      page: "anniversary",
    });
  });

  it("carries the trigger kind in the notification data payload", async () => {
    const { d, scheduled } = deps({
      data: {
        listAnniversaries: async () => [] as { title: string; date: string }[],
        listPendingTellLater: async () => [] as { id: string; text: string }[],
        countUnreadLoveLetters: async () => 1,
      },
    });
    const r = await evaluateAndScheduleOutreach(d as never);
    assert.equal(r.scheduled, true);
    assert.equal(r.trigger, "love_letter");
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].data?.kind, "love_letter");
  });
});
});

/**
 * Standalone deps builder for the round-3 integration tests (the shared
 * `deps` helper lives inside the evaluateAndScheduleOutreach describe).
 */
function schedDeps(over: {
  now?: number;
  unread?: number;
  tellLater?: { id: string; text: string }[];
  anniversaries?: { title: string; date: string }[];
  onThisDay?: { title: string; subtitle: string; yearsAgo: number }[];
  mood?: { mood: string; updatedAt: number } | null;
  withMood?: boolean;
  diaryNudge?: { lastEntryAt: number | null; anchor: string } | null;
  copy?: (key: string, params?: Record<string, string | number>) => string;
  storage?: ReturnType<typeof memStorage>;
}) {
  const storage = over.storage ?? memStorage();
  const store = new OutreachStore(storage);
  const scheduled: {
    identifier: string;
    title: string;
    body: string;
    seconds: number;
    data?: { kind: string };
  }[] = [];
  const defaultCopy = (key: string, params?: Record<string, string | number>) => {
    let s = key;
    for (const [k, v] of Object.entries(params ?? {})) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
  const d = {
    store,
    notifications: {
      getPermissionsAsync: async () => ({ status: "granted" }),
      cancelScheduledNotificationAsync: async (_id: string) => {},
      scheduleNotificationAsync: async (req: {
        identifier: string;
        content: { title: string; body: string; data?: { kind: string } };
        trigger: { seconds: number };
      }) => {
        scheduled.push({
          identifier: req.identifier,
          title: req.content.title,
          body: req.content.body,
          seconds: req.trigger.seconds,
          data: req.content.data,
        });
        return req.identifier;
      },
    },
    trace: { append: async (e: unknown) => e },
    data: {
      listAnniversaries: async () => over.anniversaries ?? [],
      listPendingTellLater: async () => over.tellLater ?? [],
      countUnreadLoveLetters: async () => over.unread ?? 0,
      listOnThisDay: async () => over.onThisDay ?? [],
      getHerMood: async () => (over.withMood ? (over.mood ?? null) : null),
      ...(over.diaryNudge === null
        ? {}
        : {
            getDiaryNudgeInput: async () =>
              over.diaryNudge ?? {
                lastEntryAt: NOW - 30 * 86_400_000,
                anchor: "一起看的第一场电影",
              },
          }),
    },
    copy: over.copy ?? defaultCopy,
    now: over.now ?? NOW,
  };
  return { d, store, scheduled };
}

describe("on_this_day (round 3, xiaomeng P1-1)", () => {
  it("fires when a same-day memory exists and carries the old title", () => {
    const triggers = evaluateOutreachTriggers(
      baseInput({ onThisDay: { title: "第一次去海边", yearsAgo: 1 } }),
    );
    assert.equal(triggers.length, 1);
    assert.equal(triggers[0].kind, "on_this_day");
    assert.equal(triggers[0].detail, "第一次去海边");
    assert.equal(triggers[0].yearsAgo, 1);
  });

  it("stays silent with an empty title — never an empty ping", () => {
    assert.deepEqual(
      evaluateOutreachTriggers(baseInput({ onThisDay: { title: "   ", yearsAgo: 2 } })),
      [],
    );
    assert.deepEqual(evaluateOutreachTriggers(baseInput({ onThisDay: null })), []);
  });

  it("priority sits between tell_later and diary_nudge", () => {
    const triggers = evaluateOutreachTriggers(
      baseInput({
        unreadLoveLetters: 1,
        pendingTellLater: [{ id: "t1", text: "记得买牛奶" }],
        onThisDay: { title: "第一次去海边", yearsAgo: 1 },
        diaryNudge: { lastEntryAt: NOW - 30 * 86_400_000, anchor: "一起看的第一场电影" },
      }),
    );
    assert.deepEqual(
      triggers.map((t) => t.kind),
      ["love_letter", "tell_later", "on_this_day", "diary_nudge"],
    );
  });

  it("yields to anniversary but beats silence", () => {
    const triggers = evaluateOutreachTriggers(
      baseInput({
        anniversaries: [{ title: "相识纪念日", daysUntil: 1 }],
        onThisDay: { title: "第一次去海边", yearsAgo: 1 },
        lastOpenedAt: NOW - 30 * 86_400_000,
      }),
    );
    assert.deepEqual(
      triggers.map((t) => t.kind),
      ["anniversary", "on_this_day", "silence"],
    );
  });

  it("cools down for 24h like every other kind", () => {
    const otd = { title: "第一次去海边", yearsAgo: 1 };
    assert.equal(
      evaluateOutreachTriggers(baseInput({ onThisDay: otd }))[0].kind,
      "on_this_day",
    );
    assert.deepEqual(
      evaluateOutreachTriggers(baseInput({ onThisDay: otd, lastOutreachAt: { on_this_day: NOW - 1000 } })),
      [],
    );
  });

  it("the deep link lands on the anniversary page (where 去年今日 lives)", () => {
    assert.deepEqual(notificationDeepLink("on_this_day"), {
      section: "space",
      page: "anniversary",
    });
  });

  it("notify schedules it with copy carrying the old title", async () => {
    const { d, scheduled } = schedDeps({
      onThisDay: [{ title: "第一次去海边", subtitle: "…", yearsAgo: 1 }],
      diaryNudge: null,
      copy: (key: string, params?: Record<string, string | number>) =>
        `${key}:${params?.title ?? ""}:${params?.years ?? ""}`,
    });
    const r = await evaluateAndScheduleOutreach(d as never);
    assert.equal(r.scheduled, true);
    assert.equal(r.trigger, "on_this_day");
    assert.ok(scheduled[0].title.includes("outreach.notif.onThisDay.title"));
    assert.ok(scheduled[0].body.includes("第一次去海边"));
  });
});

describe("mood sensitivity (round 3, xiaomeng P2-4)", () => {
  it("isNegativeMoodWord reads her own words", () => {
    assert.equal(isNegativeMoodWord("累"), true);
    assert.equal(isNegativeMoodWord("难过"), true);
    assert.equal(isNegativeMoodWord("好累"), true);
    // "不开心" contains "开心" — negative is checked first.
    assert.equal(isNegativeMoodWord("不开心"), true);
    assert.equal(isNegativeMoodWord("开心"), false);
    assert.equal(isNegativeMoodWord("平静"), false);
    assert.equal(isNegativeMoodWord("tired"), true);
    assert.equal(isNegativeMoodWord("calm"), false);
    // Unknown word: no guessing, no suppression.
    assert.equal(isNegativeMoodWord("还行"), false);
    assert.equal(isNegativeMoodWord(""), false);
  });

  it("isRecentNegativeMood respects the 3-day freshness window", () => {
    assert.equal(
      isRecentNegativeMood({ mood: "累", updatedAt: NOW - 2 * 86_400_000 }, NOW),
      true,
    );
    assert.equal(
      isRecentNegativeMood({ mood: "累", updatedAt: NOW - 4 * 86_400_000 }, NOW),
      false,
    );
    assert.equal(isRecentNegativeMood({ mood: "开心", updatedAt: NOW - 1000 }, NOW), false);
    assert.equal(isRecentNegativeMood(null, NOW), false);
  });

  it("diary_nudge is suppressed when her mood is freshly negative", () => {
    const dn = { lastEntryAt: NOW - 30 * 86_400_000, anchor: "一起看的第一场电影" };
    assert.deepEqual(
      evaluateOutreachTriggers(baseInput({ diaryNudge: dn, recentMoodNegative: true })),
      [],
    );
    // Absent input = today's behavior (no suppression).
    assert.equal(
      evaluateOutreachTriggers(baseInput({ diaryNudge: dn }))[0].kind,
      "diary_nudge",
    );
  });

  it("real commitments still fire when her mood is bad", () => {
    const triggers = evaluateOutreachTriggers(
      baseInput({
        pendingTellLater: [{ id: "t1", text: "记得买牛奶" }],
        diaryNudge: { lastEntryAt: NOW - 30 * 86_400_000, anchor: "一起看的第一场电影" },
        recentMoodNegative: true,
      }),
    );
    assert.deepEqual(
      triggers.map((t) => t.kind),
      ["tell_later"],
    );
  });

  it("notify derives suppression from her recorded mood", async () => {
    const mk = (mood: string | null) =>
      schedDeps({
        withMood: true,
        mood: mood ? { mood, updatedAt: NOW - 86_400_000 } : null,
      });
    const sad = mk("难过");
    const r1 = await evaluateAndScheduleOutreach(sad.d as never);
    assert.equal(r1.scheduled, false);
    assert.equal(r1.reason, "no-trigger");
    const happy = mk("开心");
    const r2 = await evaluateAndScheduleOutreach(happy.d as never);
    assert.equal(r2.scheduled, true);
    assert.equal(r2.trigger, "diary_nudge");
  });
});

describe("love letter nudge cap (round 3, xiaomeng P2-3)", () => {
  it("the cap is 3", () => {
    assert.equal(LOVE_LETTER_NUDGE_CAP, 3);
  });

  it("engine suppresses the love_letter trigger at the cap", () => {
    assert.equal(
      evaluateOutreachTriggers(baseInput({ unreadLoveLetters: 1, loveLetterNudgeCount: 2 }))[0]
        .kind,
      "love_letter",
    );
    assert.deepEqual(
      evaluateOutreachTriggers(baseInput({ unreadLoveLetters: 1, loveLetterNudgeCount: 3 })),
      [],
    );
  });

  it("store counts fires and restarts the episode on reset", async () => {
    const store = new OutreachStore(memStorage());
    assert.equal(await store.getLoveLetterNudgeCount(), 0);
    await store.recordLoveLetterNudge();
    await store.recordLoveLetterNudge();
    assert.equal(await store.getLoveLetterNudgeCount(), 2);
    await store.resetLoveLetterNudgeCount();
    assert.equal(await store.getLoveLetterNudgeCount(), 0);
  });

  it("notify stops nudging after 3 fires until she reads the letter", async () => {
    // 22:00 Shanghai each round — awake, so the sleep check never interferes.
    const base = Date.UTC(2026, 9, 5, 14, 0, 0);
    const shared = memStorage();
    const mk = (now: number, unread: number) =>
      schedDeps({
        now,
        unread,
        diaryNudge: null,
        storage: shared,
      });
    for (let i = 0; i < 3; i++) {
      const { d } = mk(base + i * (OUTREACH_COOLDOWN_MS + 3600_000), 1);
      const r = await evaluateAndScheduleOutreach(d as never);
      assert.equal(r.scheduled, true, `fire ${i + 1} should schedule`);
      assert.equal(r.trigger, "love_letter");
    }
    const probe = new OutreachStore(shared);
    assert.equal(await probe.getLoveLetterNudgeCount(), 3);
    // 4th round: capped — no notification, no nagging.
    const capped = mk(base + 3 * (OUTREACH_COOLDOWN_MS + 3600_000), 1);
    const r4 = await evaluateAndScheduleOutreach(capped.d as never);
    assert.equal(r4.scheduled, false);
    assert.equal(r4.reason, "no-trigger");
    // She reads the letter → the episode restarts.
    const read = mk(base + 4 * (OUTREACH_COOLDOWN_MS + 3600_000), 0);
    const r5 = await evaluateAndScheduleOutreach(read.d as never);
    assert.equal(r5.scheduled, false);
    assert.equal(await probe.getLoveLetterNudgeCount(), 0);
  });
});

describe("sleep-window clamp (round 3, code P2-1)", () => {
  // 22:00 Shanghai 2026-10-05.
  const evening = Date.UTC(2026, 9, 5, 14, 0, 0);

  it("pushes a fire time inside 06:00-16:00 Shanghai to 16:00", () => {
    // 22:00 + 12h = 10:00 next day (asleep) → 16:00 next day = +18h.
    assert.equal(clampFireOutOfSleepWindow(evening, 12 * 3600), 18 * 3600);
  });

  it("leaves awake fire times alone", () => {
    assert.equal(clampFireOutOfSleepWindow(evening, 6 * 3600), 6 * 3600); // 04:00 — awake
    assert.equal(clampFireOutOfSleepWindow(evening, 3600), 3600); // 23:00 — awake
  });

  it("clamps at the window edges", () => {
    // Fire exactly at 06:00 → pushed to 16:00 same day (now was 05:00, +11h).
    const fire6 = Date.UTC(2026, 9, 5, 22, 0, 0); // 06:00 Shanghai 2026-10-06
    const now = fire6 - 3600_000;
    assert.equal(clampFireOutOfSleepWindow(now, 3600), 11 * 3600);
    // Fire at 15:59 → pushed to 16:00 (+1 min).
    const fire1559 = Date.UTC(2026, 9, 5, 7, 59, 0);
    assert.equal(clampFireOutOfSleepWindow(fire1559 - 60_000, 60), 60 + 60);
  });

  it("notify clamps the scheduled delay past her sleep window", async () => {
    const { d, scheduled } = schedDeps({
      now: evening,
      tellLater: [{ id: "t1", text: "记得买牛奶" }],
    });
    const r = await evaluateAndScheduleOutreach(d as never);
    assert.equal(r.scheduled, true);
    assert.equal(r.trigger, "tell_later");
    // 22:00 + 18h = 16:00 next day — never inside 06:00–16:00.
    assert.equal(scheduled[0].seconds, 18 * 3600);
  });

  it("anniversary keeps the raw delay (she approved those)", async () => {
    const { d, scheduled } = schedDeps({
      now: evening,
      anniversaries: [{ title: "相识纪念日", date: "2026-10-06" }],
    });
    const r = await evaluateAndScheduleOutreach(d as never);
    assert.equal(r.scheduled, true);
    assert.equal(r.trigger, "anniversary");
    assert.equal(scheduled[0].seconds, 12 * 3600);
  });
});
