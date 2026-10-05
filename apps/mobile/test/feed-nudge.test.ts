/**
 * feed_nudge (C3) — the AI no longer ignores her feed.
 *
 * Hard guarantees under test:
 *  1. 24h rule: no nudge before 24h have passed (never instant).
 *  2. Exactly once per post: a second run does nothing (idempotent).
 *  3. A post the AI already liked/replied to (by any path) is never nudged.
 *  4. AI-authored posts are never nudged.
 *  5. Image-only / blank posts get like-only (no hollow reply).
 *  6. Sleep window is respected.
 *  7. Reply copy is warm, restrained, zero emoji.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateOutreachTriggers, type OutreachEvalInput } from "../src/outreach/engine.js";
import {
  evaluateFeedNudge,
  FEED_NUDGE_WINDOW_MS,
  type FeedNudgePost,
  pickFeedNudgeReply,
  runFeedNudge,
} from "../src/outreach/feed-nudge.js";
import { buildOutreachSection } from "../src/outreach/prompt.js";
import { OutreachStore } from "../src/outreach/store.js";

const NOW = 1_780_000_000_000;
const H = 3_600_000;

function post(over: Partial<FeedNudgePost> = {}): FeedNudgePost {
  return {
    id: "p1",
    author: "her",
    text: "今天做了很好吃的蛋糕",
    createdAt: NOW - 25 * H,
    likedByAi: false,
    hasAiReply: false,
    ...over,
  };
}

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      m.set(k, v);
    },
  };
}

interface CallLog {
  like: string[];
  reply: { postId: string; text: string }[];
}

function testPorts(posts: FeedNudgePost[], log: CallLog, opts: { likeThrows?: boolean } = {}) {
  return {
    likePost: async (postId: string) => {
      if (opts.likeThrows) throw new Error("store exploded");
      log.like.push(postId);
    },
    replyToPost: async (postId: string, text: string) => {
      log.reply.push({ postId, text });
    },
    getPost: async (postId: string) => posts.find((p) => p.id === postId) ?? null,
  };
}

describe("evaluateFeedNudge", () => {
  it("picks her 25h-old unacknowledged post", () => {
    const c = evaluateFeedNudge({ now: NOW, posts: [post()], nudgedPostIds: [] });
    assert.ok(c);
    assert.equal(c.postId, "p1");
    assert.equal(c.hasReadableText, true);
    assert.ok(c.snippet.length > 0);
  });

  it("stays silent before 24h (never instant)", () => {
    const c = evaluateFeedNudge({
      now: NOW,
      posts: [post({ createdAt: NOW - 1 * H })],
      nudgedPostIds: [],
    });
    assert.equal(c, null);
  });

  it("skips posts the AI already liked", () => {
    const c = evaluateFeedNudge({
      now: NOW,
      posts: [post({ likedByAi: true })],
      nudgedPostIds: [],
    });
    assert.equal(c, null);
  });

  it("skips posts the AI already replied to", () => {
    const c = evaluateFeedNudge({
      now: NOW,
      posts: [post({ hasAiReply: true })],
      nudgedPostIds: [],
    });
    assert.equal(c, null);
  });

  it("never nudges AI-authored posts", () => {
    const c = evaluateFeedNudge({
      now: NOW,
      posts: [post({ author: "ai" })],
      nudgedPostIds: [],
    });
    assert.equal(c, null);
  });

  it("never nudges an already-nudged post", () => {
    const c = evaluateFeedNudge({
      now: NOW,
      posts: [post()],
      nudgedPostIds: ["p1"],
    });
    assert.equal(c, null);
  });

  it("ignores future-dated posts", () => {
    const c = evaluateFeedNudge({
      now: NOW,
      posts: [post({ createdAt: NOW + H })],
      nudgedPostIds: [],
    });
    assert.equal(c, null);
  });

  it("picks the oldest eligible post first", () => {
    const c = evaluateFeedNudge({
      now: NOW,
      posts: [
        post({ id: "new", createdAt: NOW - 26 * H }),
        post({ id: "old", createdAt: NOW - 50 * H }),
      ],
      nudgedPostIds: [],
    });
    assert.equal(c?.postId, "old");
  });

  it("image-only post is like-only (no hollow reply)", () => {
    const c = evaluateFeedNudge({
      now: NOW,
      posts: [post({ text: "  ", imageUri: "file:///img.jpg" })],
      nudgedPostIds: [],
    });
    assert.ok(c);
    assert.equal(c.hasReadableText, false);
  });

  it("sanitizes the snippet (no newlines, capped)", () => {
    const c = evaluateFeedNudge({
      now: NOW,
      posts: [post({ text: "a\nb\nc".repeat(100) })],
      nudgedPostIds: [],
    });
    assert.ok(c);
    assert.ok(!c.snippet.includes("\n"));
    assert.ok(c.snippet.length <= 120);
  });
});

describe("pickFeedNudgeReply", () => {
  it("is deterministic per post and warm without emoji", () => {
    const a = pickFeedNudgeReply("post-1");
    const b = pickFeedNudgeReply("post-1");
    assert.equal(a, b);
    assert.ok(a.length > 0 && a.length <= 60);
    // Zero emoji: only CJK text and everyday punctuation survive.
    assert.ok(/^[\u4e00-\u9fff\u3000-\u303fa-zA-Z0-9，。！？、「」『』…—·\s]+$/.test(a));
  });

  it("rotates across posts (not the same line every time)", () => {
    const seen = new Set(["x1", "x2", "x3", "x4", "x5", "x6"].map(pickFeedNudgeReply));
    assert.ok(seen.size > 1);
  });
});

describe("runFeedNudge", () => {
  it("likes once + replies once for a 25h-old post", async () => {
    const posts = [post()];
    const log: CallLog = { like: [], reply: [] };
    const nudged: string[] = [];
    const r = await runFeedNudge({
      now: NOW,
      posts,
      nudgedPostIds: nudged,
      actions: testPorts(posts, log),
      recordNudged: async (id) => {
        nudged.push(id);
      },
      trace: async () => {},
      isSleepTime: () => false,
    });
    assert.equal(r.nudged, true);
    assert.equal(r.postId, "p1");
    assert.deepEqual(log.like, ["p1"]);
    assert.equal(log.reply.length, 1);
    assert.equal(log.reply[0].postId, "p1");
    assert.ok(log.reply[0].text.length > 0);
    assert.deepEqual(nudged, ["p1"]);
  });

  it("is idempotent: a second run does nothing", async () => {
    const posts = [post()];
    const log: CallLog = { like: [], reply: [] };
    const nudged: string[] = [];
    const deps = {
      now: NOW,
      posts,
      nudgedPostIds: nudged,
      actions: testPorts(posts, log),
      recordNudged: async (id: string) => {
        if (!nudged.includes(id)) nudged.push(id);
      },
      trace: async () => {},
      isSleepTime: () => false,
    };
    const r1 = await runFeedNudge(deps);
    assert.equal(r1.nudged, true);
    // Second run sees the persisted nudged-set.
    const r2 = await runFeedNudge({ ...deps, nudgedPostIds: [...nudged] });
    assert.equal(r2.nudged, false);
    assert.deepEqual(log.like, ["p1"]);
    assert.equal(log.reply.length, 1);
  });

  it("does nothing for a 1h-old post", async () => {
    const posts = [post({ createdAt: NOW - H })];
    const log: CallLog = { like: [], reply: [] };
    const r = await runFeedNudge({
      now: NOW,
      posts,
      nudgedPostIds: [],
      actions: testPorts(posts, log),
      recordNudged: async () => {},
      trace: async () => {},
      isSleepTime: () => false,
    });
    assert.equal(r.nudged, false);
    assert.equal(r.reason, "no-candidate");
    assert.deepEqual(log.like, []);
    assert.deepEqual(log.reply, []);
  });

  it("does nothing when already liked or AI-authored", async () => {
    for (const p of [post({ likedByAi: true }), post({ author: "ai" })]) {
      const log: CallLog = { like: [], reply: [] };
      const r = await runFeedNudge({
        now: NOW,
        posts: [p],
        nudgedPostIds: [],
        actions: testPorts([p], log),
        recordNudged: async () => {},
        trace: async () => {},
        isSleepTime: () => false,
      });
      assert.equal(r.nudged, false, JSON.stringify(p));
      assert.deepEqual(log.like, []);
    }
  });

  it("like-only for image-only posts (no forced reply)", async () => {
    const posts = [post({ text: " ", imageUri: "file:///img.jpg" })];
    const log: CallLog = { like: [], reply: [] };
    const r = await runFeedNudge({
      now: NOW,
      posts,
      nudgedPostIds: [],
      actions: testPorts(posts, log),
      recordNudged: async () => {},
      trace: async () => {},
      isSleepTime: () => false,
    });
    assert.equal(r.nudged, true);
    assert.equal(r.liked, true);
    assert.equal(r.replied, false);
    assert.deepEqual(log.like, ["p1"]);
    assert.deepEqual(log.reply, []);
  });

  it("respects the sleep window", async () => {
    const posts = [post()];
    const log: CallLog = { like: [], reply: [] };
    const r = await runFeedNudge({
      now: NOW,
      posts,
      nudgedPostIds: [],
      actions: testPorts(posts, log),
      recordNudged: async () => {},
      trace: async () => {},
      isSleepTime: () => true,
    });
    assert.equal(r.nudged, false);
    assert.equal(r.reason, "sleep-window");
    assert.deepEqual(log.like, []);
  });

  it("never throws: a failing like degrades to failed", async () => {
    const posts = [post()];
    const log: CallLog = { like: [], reply: [] };
    const r = await runFeedNudge({
      now: NOW,
      posts,
      nudgedPostIds: [],
      actions: testPorts(posts, log, { likeThrows: true }),
      recordNudged: async () => {},
      trace: async () => {},
      isSleepTime: () => false,
    });
    assert.equal(r.nudged, false);
    assert.equal(r.reason, "failed");
  });

  it("does not toggle off a like that appeared mid-flight", async () => {
    const p = post();
    const log: CallLog = { like: [], reply: [] };
    // getPost reports already-liked even though the evaluated snapshot said not.
    const r = await runFeedNudge({
      now: NOW,
      posts: [p],
      nudgedPostIds: [],
      actions: {
        ...testPorts([p], log),
        getPost: async () => ({ ...p, likedByAi: true }),
      },
      recordNudged: async () => {},
      trace: async () => {},
      isSleepTime: () => false,
    });
    assert.equal(r.nudged, true);
    assert.deepEqual(log.like, []); // no toggle → never unlikes
  });
});

describe("OutreachStore feed-nudge bookkeeping", () => {
  it("records and reads nudged post ids, deduplicated", async () => {
    const store = new OutreachStore(memStorage());
    assert.deepEqual(await store.getNudgedFeedPostIds(), []);
    await store.recordFeedNudge("p1");
    await store.recordFeedNudge("p1");
    await store.recordFeedNudge("p2");
    assert.deepEqual(await store.getNudgedFeedPostIds(), ["p1", "p2"]);
  });

  it("junk storage degrades to empty", async () => {
    const storage = memStorage();
    await storage.setItem("dudu.outreach.v1.feedNudges", "not-json{{{");
    const store = new OutreachStore(storage);
    assert.deepEqual(await store.getNudgedFeedPostIds(), []);
  });
});

describe("engine: feed_nudge trigger", () => {
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

  function feedInput(posts: FeedNudgePost[], nudgedPostIds: string[] = []) {
    return {
      posts: posts.map((p) => ({
        id: p.id,
        author: p.author,
        text: p.text,
        imageUri: p.imageUri,
        createdAt: p.createdAt,
        likedByAi: p.likedByAi,
        hasAiReply: p.hasAiReply,
      })),
      nudgedPostIds,
    };
  }

  it("fires for her 25h-old unacknowledged post with the postId", () => {
    const triggers = evaluateOutreachTriggers(baseInput({ feedNudge: feedInput([post()]) }));
    assert.equal(triggers[0].kind, "feed_nudge");
    assert.equal(triggers[0].postId, "p1");
    assert.ok(triggers[0].detail.length > 0);
  });

  it("stays off without feed input, and under quiet frequency", () => {
    assert.deepEqual(evaluateOutreachTriggers(baseInput()), []);
    assert.deepEqual(
      evaluateOutreachTriggers(baseInput({ frequency: "quiet", feedNudge: feedInput([post()]) })),
      [],
    );
  });

  it("respects the per-kind 24h cooldown", () => {
    const triggers = evaluateOutreachTriggers(
      baseInput({
        feedNudge: feedInput([post()]),
        lastOutreachAt: { feed_nudge: NOW - H },
      }),
    );
    assert.deepEqual(triggers, []);
  });

  it("ranks below anniversary/tell_later, above diary_nudge", () => {
    const triggers = evaluateOutreachTriggers(
      baseInput({
        anniversaries: [{ title: "纪念日", daysUntil: 1 }],
        feedNudge: feedInput([post()]),
        diaryNudge: { lastEntryAt: NOW - 30 * 86_400_000, anchor: "看电影" },
      }),
    );
    const kinds = triggers.map((t) => t.kind);
    assert.deepEqual(kinds, ["anniversary", "feed_nudge", "diary_nudge"]);
  });
});

describe("prompt: feed_nudge section", () => {
  it("tells him to like + reply once via tools, with the post id", () => {
    const s = buildOutreachSection([
      { kind: "feed_nudge", priority: 4, detail: "好吃的蛋糕", postId: "p1" },
    ]);
    assert.ok(s.includes("feed_like"));
    assert.ok(s.includes("feed_reply"));
    assert.ok(s.includes("p1"));
    assert.ok(!s.includes("在吗"));
  });
});

describe("constants", () => {
  it("the nudge window is 24h", () => {
    assert.equal(FEED_NUDGE_WINDOW_MS, 24 * 3_600_000);
  });
});
