import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createToolRegistry, type ToolContext } from "../src/api-groups/local-tools.js";
import { getManual } from "../src/manuals/index.js";
import { buildAnniversarySection } from "../src/our-space/anniversary-section.js";
import { type OurSpaceStorage, OurSpaceStore } from "../src/our-space/store.js";
import { createOurSpaceTools } from "../src/our-space/tools.js";

function fakeStorage(): OurSpaceStorage {
  const map = new Map<string, string>();
  return {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v);
    },
  };
}

const ctx: ToolContext = { authorize: async () => true };

describe("our-space store", () => {
  it("diary: add, list newest-first, delete", async () => {
    const s = new OurSpaceStore(fakeStorage());
    assert.deepEqual(await s.listDiary(), []);
    const e1 = await s.addDiary("Morning", "Good morning text");
    await s.addDiary("Evening", "Good evening text");
    const list = await s.listDiary();
    assert.equal(list.length, 2);
    assert.equal(list[0].title, "Evening");
    assert.match(e1.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(await s.deleteDiary(e1.id), true);
    assert.equal(await s.deleteDiary("nope"), false);
    assert.equal((await s.listDiary()).length, 1);
  });

  it("diary: rejects empty title/content", async () => {
    const s = new OurSpaceStore(fakeStorage());
    await assert.rejects(() => s.addDiary("", "x"));
    await assert.rejects(() => s.addDiary("t", "   "));
  });

  it("timeline: add and list newest-first", async () => {
    const s = new OurSpaceStore(fakeStorage());
    await s.addTimeline("First", "desc", "moment");
    // Ensure distinct timestamps (same-ms ties are unordered).
    await new Promise((r) => setTimeout(r, 2));
    await s.addTimeline("Big day", "", "milestone");
    const list = await s.listTimeline();
    assert.equal(list.length, 2);
    assert.equal(list[0].kind, "milestone");
    assert.equal(list[1].kind, "moment");
  });

  it("memory garden: reads from canonical backend via gardenStateOf", async () => {
    // The garden UI reads from the canonical memory store (one truth source).
    const { MemoryStore } = await import("../src/memory/store.js");
    const { gardenStateOf } = await import("../src/memory/types.js");
    const ms = new MemoryStore(fakeStorage());
    await ms.addMemory("She likes gray", { confidence: "confident" });
    await ms.addMemory("Maybe she likes tea", { confidence: "unsure" });
    await ms.addMemory("Ask about the trip", { confidence: "question" });
    const all = await ms.listCurrent();
    assert.equal(all.length, 3);
    const states = all.map(gardenStateOf).sort();
    assert.deepEqual(states, ["ask", "blooming", "sprouting"]);
  });

  it("tell-later: queue, complete, filter", async () => {
    const s = new OurSpaceStore(fakeStorage());
    const a = await s.addTellLater("Tell her about the update");
    await s.addTellLater("Remind her to rest");
    assert.equal((await s.listTellLater()).length, 2);
    assert.equal((await s.listTellLater(false)).length, 2);
    await s.completeTellLater(a.id, true);
    assert.equal((await s.listTellLater(false)).length, 1);
    const done = await s.listTellLater(true);
    assert.equal(done.find((i) => i.id === a.id)?.done, true);
  });

  it("status: set and get", async () => {
    const s = new OurSpaceStore(fakeStorage());
    assert.equal(await s.getStatus(), null);
    const st = await s.setStatus("Building Our Space", "Phase 3 work");
    assert.equal(st.text, "Building Our Space");
    assert.equal((await s.getStatus())?.detail, "Phase 3 work");
  });

  it("subscribe: emits on mutation", async () => {
    const s = new OurSpaceStore(fakeStorage());
    let n = 0;
    const unsub = s.subscribe(() => n++);
    await s.addDiary("t", "c");
    await s.setStatus("x");
    assert.equal(n, 2);
    unsub();
    await s.addDiary("t2", "c2");
    assert.equal(n, 2);
  });

  it("corrupted storage: falls back without throwing", async () => {
    const bad: OurSpaceStorage = {
      getItem: async () => "{not json",
      setItem: async () => {},
    };
    const s = new OurSpaceStore(bad);
    assert.deepEqual(await s.listDiary(), []);
    assert.equal(await s.getStatus(), null);
  });
});

describe("our-space tools", () => {
  it("exposes 17 dialog-operated tools (memory lives in the canonical memory/ tools)", () => {
    const tools = createOurSpaceTools(new OurSpaceStore(fakeStorage()));
    assert.equal(tools.length, 17);
    const names = tools.map((t) => t.name);
    for (const n of [
      "my_status_read",
      "my_status_update",
      "diary_write",
      "diary_read",
      "timeline_add",
      "timeline_read",
      "tell_later_add",
      "tell_later_read",
      "tell_later_done",
      "feed_post",
      "feed_read",
      "feed_reply",
      "feed_like",
      "anniversary_add",
      "anniversary_read",
      "work_add",
      "work_read",
    ]) {
      assert.ok(names.includes(n), `missing tool ${n}`);
    }
    // No duplicate memory tools — the canonical memory/ system owns memory_*.
    for (const n of ["memory_add", "memory_read", "memory_update"]) {
      assert.ok(!names.includes(n), `duplicate tool ${n}`);
    }
  });

  it("diary_write + diary_read round-trip via registry", async () => {
    const store = new OurSpaceStore(fakeStorage());
    const reg = createToolRegistry(createOurSpaceTools(store));
    const out = await reg.execute(
      "diary_write",
      { title: "Test day", content: "It was good." },
      ctx,
    );
    assert.match(out, /saved/i);
    const read = await reg.execute("diary_read", {}, ctx);
    assert.match(read, /Test day/);
  });

  it("canonical memory tools: add/search/confirm round-trip", async () => {
    const { MemoryStore } = await import("../src/memory/store.js");
    const { createMemoryTools } = await import("../src/memory/tools.js");
    const ms = new MemoryStore(fakeStorage());
    const reg = createToolRegistry(createMemoryTools(ms));
    const out = await reg.execute("memory_add", { content: "She likes gray" }, ctx);
    assert.match(out, /remembered/i);
    const found = await reg.execute("memory_search", { query: "gray" }, ctx);
    assert.match(found, /She likes gray/);
  });

  it("unknown ids throw helpful errors", async () => {
    const store = new OurSpaceStore(fakeStorage());
    const reg = createToolRegistry(createOurSpaceTools(store));
    await assert.rejects(() => reg.execute("tell_later_done", { id: "nope" }, ctx));
    await assert.rejects(() => reg.execute("no_such_tool", {}, ctx));
  });

  it("tell_later full flow", async () => {
    const store = new OurSpaceStore(fakeStorage());
    const reg = createToolRegistry(createOurSpaceTools(store));
    await reg.execute("tell_later_add", { text: "Tell her the build passed" }, ctx);
    const before = await reg.execute("tell_later_read", {}, ctx);
    assert.match(before, /pending/);
    const item = (await store.listTellLater())[0];
    await reg.execute("tell_later_done", { id: item.id }, ctx);
    const after = await reg.execute("tell_later_read", {}, ctx);
    assert.match(after, /done/);
  });
});

describe("our-space manual", () => {
  it("is registered and points at the right file", () => {
    const m = getManual("our-space");
    assert.ok(m);
    assert.equal(m?.file, "src/manuals/our-space.ts");
    assert.match(m?.body ?? "", /she NEVER edits/i);
  });
});

describe("our-space v2: couple profile", () => {
  it("avatar customization persists per person", async () => {
    const s = new OurSpaceStore(fakeStorage());
    assert.equal(await s.getCoupleProfile(), null);
    const p1 = await s.setAvatar("her", "file:///her.jpg");
    assert.equal(p1.herAvatarUri, "file:///her.jpg");
    assert.equal(p1.aiAvatarUri, null);
    const p2 = await s.setAvatar("ai", "file:///ai.jpg");
    assert.equal(p2.herAvatarUri, "file:///her.jpg");
    assert.equal(p2.aiAvatarUri, "file:///ai.jpg");
    // Clearing works too.
    const p3 = await s.setAvatar("her", null);
    assert.equal(p3.herAvatarUri, null);
  });
});

describe("our-space v2: social feed", () => {
  it("post, like toggle, reply, delete cascades", async () => {
    const s = new OurSpaceStore(fakeStorage());
    const post = await s.addFeedPost("her", "Hello world");
    assert.equal(post.likedByHer, false);
    assert.equal(post.likedByAi, false);

    // Likes toggle per person independently.
    const liked = await s.toggleFeedLike(post.id, "ai");
    assert.equal(liked?.likedByAi, true);
    assert.equal(liked?.likedByHer, false);
    const unliked = await s.toggleFeedLike(post.id, "ai");
    assert.equal(unliked?.likedByAi, false);

    // Replies thread under the post.
    await s.addReply(post.id, "ai", "Hi there");
    const replies = await s.listReplies(post.id);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].text, "Hi there");

    // Deleting the post cascades to its replies.
    assert.equal(await s.deleteFeedPost(post.id), true);
    assert.deepEqual(await s.listFeed(), []);
    assert.deepEqual(await s.listReplies(post.id), []);
  });

  it("rejects empty posts and replies to missing posts", async () => {
    const s = new OurSpaceStore(fakeStorage());
    await assert.rejects(() => s.addFeedPost("her", "   "));
    await assert.rejects(() => s.addReply("nope", "ai", "hi"));
    // Image-only post is allowed (her exception).
    const img = await s.addFeedPost("ai", "", "file:///pic.jpg");
    assert.equal(img.imageUri, "file:///pic.jpg");
  });

  it("AI tools: feed_post / feed_read / feed_reply / feed_like", async () => {
    const store = new OurSpaceStore(fakeStorage());
    const reg = createToolRegistry(createOurSpaceTools(store));
    await reg.execute("feed_post", { text: "AI says hi" }, ctx);
    const read = await reg.execute("feed_read", {}, ctx);
    assert.match(read, /AI says hi/);
    const post = (await store.listFeed())[0];
    await reg.execute("feed_reply", { postId: post.id, text: "Her reply" }, ctx);
    const read2 = await reg.execute("feed_read", {}, ctx);
    assert.match(read2, /Her reply/);
    const likeRes = await reg.execute("feed_like", { postId: post.id }, ctx);
    assert.match(likeRes, /Liked/);
  });
});

describe("our-space v2: anniversaries", () => {
  it("add, list sorted, delete; rejects bad dates", async () => {
    const s = new OurSpaceStore(fakeStorage());
    await s.addAnniversary("Met", "2024-02-14");
    await s.addAnniversary("First trip", "2024-05-01", "Beach");
    const list = await s.listAnniversaries();
    assert.equal(list.length, 2);
    assert.equal(list[0].date, "2024-02-14"); // sorted by date
    await assert.rejects(() => s.addAnniversary("Bad", "tomorrow"));
    const item = list[0];
    assert.equal(await s.deleteAnniversary(item.id), true);
    assert.equal((await s.listAnniversaries()).length, 1);
  });

  it("AI tools: anniversary_add / anniversary_read", async () => {
    const store = new OurSpaceStore(fakeStorage());
    const reg = createToolRegistry(createOurSpaceTools(store));
    await reg.execute("anniversary_add", { title: "Met", date: "2024-02-14" }, ctx);
    const read = await reg.execute("anniversary_read", {}, ctx);
    assert.match(read, /Met.*2024-02-14/);
  });
});

describe("our-space v2: works drawer", () => {
  it("add, list newest-first, delete; rejects bad input", async () => {
    const s = new OurSpaceStore(fakeStorage());
    const w1 = await s.addWork("image", "Sunset", "file:///sunset.jpg", "For her");
    await s.addWork("html", "Card", "file:///card.html");
    const list = await s.listWorks();
    assert.equal(list.length, 2);
    assert.equal(list[0].title, "Card"); // newest first
    assert.equal(w1.thumbnailUri, undefined);
    await assert.rejects(() => s.addWork("image", "", "file:///x.jpg"));
    await assert.rejects(() => s.addWork("image", "No URI", "  "));
    assert.equal(await s.deleteWork(w1.id), true);
    assert.equal((await s.listWorks()).length, 1);
  });

  it("AI tools: work_add / work_read; rejects unknown type", async () => {
    const store = new OurSpaceStore(fakeStorage());
    const reg = createToolRegistry(createOurSpaceTools(store));
    await reg.execute("work_add", { type: "image", title: "Pic", uri: "file:///pic.jpg" }, ctx);
    const read = await reg.execute("work_read", {}, ctx);
    assert.match(read, /\[image\] Pic/);
    await assert.rejects(() =>
      reg.execute("work_add", { type: "video", title: "V", uri: "file:///v.mp4" }, ctx),
    );
  });
});

describe("our-space v2: no duplicate tool names", () => {
  it("every tool name registered exactly once", async () => {
    const store = new OurSpaceStore(fakeStorage());
    const tools = createOurSpaceTools(store);
    const names = tools.map((t) => t.name);
    assert.equal(names.length, new Set(names).size);
  });
});

describe("anniversary-section: buildAnniversarySection", () => {
  // Fixed "now": 2026-10-04 (Sunday), to make date math deterministic.
  const NOW = new Date(2026, 9, 4, 12, 0, 0);

  function ann(title: string, date: string) {
    return { id: "x", title, date, description: "", createdAt: 0 };
  }

  it("returns empty string when no anniversaries", () => {
    assert.equal(buildAnniversarySection([], NOW), "");
  });

  it("injects a line when the anniversary is today", () => {
    const s = buildAnniversarySection([ann("相识纪念日", "2026-10-04")], NOW);
    assert.match(s, /今天是「相识纪念日」/);
  });

  it("injects a countdown line when upcoming within 7 days", () => {
    const s = buildAnniversarySection([ann("她的生日", "2026-10-09")], NOW);
    assert.match(s, /「她的生日」还有 5 天/);
  });

  it("stays silent for anniversaries more than 7 days away", () => {
    const s = buildAnniversarySection([ann("圣诞节", "2026-12-25")], NOW);
    assert.equal(s, "");
  });

  it("stays silent for past anniversaries (days-together style)", () => {
    const s = buildAnniversarySection([ann("在一起", "2025-01-01")], NOW);
    assert.equal(s, "");
  });

  it("handles multiple anniversaries, only the near ones", () => {
    const s = buildAnniversarySection(
      [ann("远的", "2027-01-01"), ann("今天的", "2026-10-04"), ann("近的", "2026-10-06")],
      NOW,
    );
    assert.match(s, /今天是「今天的」/);
    assert.match(s, /「近的」还有 2 天/);
    assert.doesNotMatch(s, /远的/);
  });

  it("never emits emoji", () => {
    const s = buildAnniversarySection(
      [ann("相识纪念日", "2026-10-04"), ann("她的生日", "2026-10-09")],
      NOW,
    );
    // eslint-disable-next-line no-control-regex
    assert.doesNotMatch(s, /[\u{1F000}-\u{1FAFF}\u2600-\u{27BF}]/u);
  });
});
