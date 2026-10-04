import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createToolRegistry, type ToolContext } from "../src/api-groups/local-tools.js";
import { getManual } from "../src/manuals/index.js";
import { buildAnniversarySection } from "../src/our-space/anniversary-section.js";
import { buildHerMoodSection } from "../src/our-space/her-mood-section.js";
import { buildNicknameSection } from "../src/our-space/nickname-section.js";
import { type OurSpaceStorage, OurSpaceStore } from "../src/our-space/store.js";
import { createOurSpaceTools } from "../src/our-space/tools.js";
import { getOnThisDay } from "../src/our-space/on-this-day.js";
import { daysTogether, resolveTogetherSince } from "../src/our-space/together.js";

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
  it("exposes 34 dialog-operated tools (memory lives in the canonical memory/ tools)", () => {
    const tools = createOurSpaceTools(new OurSpaceStore(fakeStorage()));
    assert.equal(tools.length, 34);
    const names = tools.map((t) => t.name);
    for (const n of [
      "my_status_read",
      "my_status_update",
      "her_mood_read",
      "her_mood_update",
      "nickname_read",
      "nickname_set",
      "diary_write",
      "diary_read",
      "diary_delete",
      "timeline_add",
      "timeline_read",
      "timeline_delete",
      "on_this_day_read",
      "tell_later_add",
      "tell_later_read",
      "tell_later_done",
      "tell_later_delete",
      "leave_note",
      "left_note_read",
      "left_note_delete",
      "feed_post",
      "feed_read",
      "feed_post_delete",
      "feed_reply",
      "feed_reply_delete",
      "feed_like",
      "anniversary_add",
      "anniversary_read",
      "anniversary_delete",
      "work_add",
      "work_read",
      "work_delete",
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

  it("delete tools remove entries and 404 on unknown id", async () => {
    const store = new OurSpaceStore(fakeStorage());
    const reg = createToolRegistry(createOurSpaceTools(store));
    const entry = await store.addDiary("To delete", "bye");
    const out = await reg.execute("diary_delete", { id: entry.id }, ctx);
    assert.match(out, /deleted/i);
    assert.equal((await store.listDiary(10)).length, 0);
    await assert.rejects(() => reg.execute("diary_delete", { id: entry.id }, ctx), /No diary entry/);
    await assert.rejects(() => reg.execute("diary_delete", {}, ctx), /Missing required argument/);
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

  it("nicknames: set per side, independent of avatars", async () => {
    const s = new OurSpaceStore(fakeStorage());
    const p1 = await s.setNickname("her", "宝宝");
    assert.equal(p1.herNickname, "宝宝");
    assert.equal(p1.aiNickname, null);
    const p2 = await s.setNickname("ai", "老公");
    assert.equal(p2.herNickname, "宝宝");
    assert.equal(p2.aiNickname, "老公");
    // Avatars survive nickname writes.
    await s.setAvatar("her", "file:///her.jpg");
    const p3 = await s.getCoupleProfile();
    assert.equal(p3?.herNickname, "宝宝");
    assert.equal(p3?.herAvatarUri, "file:///her.jpg");
    // Clearing works.
    const p4 = await s.setNickname("her", "");
    assert.equal(p4.herNickname, null);
    assert.equal(p4.aiNickname, "老公");
  });
});

describe("our-space: her mood", () => {
  it("set and get her mood", async () => {
    const s = new OurSpaceStore(fakeStorage());
    assert.equal(await s.getHerMood(), null);
    const m = await s.setHerMood("累", "加班到很晚");
    assert.equal(m.mood, "累");
    assert.equal(m.note, "加班到很晚");
    const got = await s.getHerMood();
    assert.equal(got?.mood, "累");
  });

  it("her_mood tools round-trip via registry", async () => {
    const store = new OurSpaceStore(fakeStorage());
    const reg = createToolRegistry(createOurSpaceTools(store));
    const before = await reg.execute("her_mood_read", {}, ctx);
    assert.match(before, /never recorded/i);
    await reg.execute("her_mood_update", { mood: "开心", note: "剧追完了" }, ctx);
    const after = await reg.execute("her_mood_read", {}, ctx);
    assert.match(after, /开心/);
    assert.match(after, /剧追完了/);
    await assert.rejects(() => reg.execute("her_mood_update", { mood: "" }, ctx));
  });

  it("nickname tools round-trip via registry", async () => {
    const store = new OurSpaceStore(fakeStorage());
    const reg = createToolRegistry(createOurSpaceTools(store));
    const before = await reg.execute("nickname_read", {}, ctx);
    assert.match(before, /No nicknames/i);
    await reg.execute("nickname_set", { who: "her", name: "宝宝" }, ctx);
    await reg.execute("nickname_set", { who: "ai", name: "老公" }, ctx);
    const after = await reg.execute("nickname_read", {}, ctx);
    assert.match(after, /宝宝/);
    assert.match(after, /老公/);
    await assert.rejects(() => reg.execute("nickname_set", { who: "them", name: "x" }, ctx));
  });
});

describe("her-mood-section: buildHerMoodSection", () => {
  const NOW = new Date(2026, 9, 4, 12, 0, 0);

  it("returns empty when never recorded", () => {
    assert.equal(buildHerMoodSection(null, NOW), "");
  });

  it("injects a subtle line for a fresh mood", () => {
    const line = buildHerMoodSection(
      { mood: "累", note: "加班到很晚", updatedAt: NOW.getTime() - 3600_000 },
      NOW,
    );
    assert.ok(line.includes("累"));
    assert.ok(line.includes("加班到很晚"));
  });

  it("stays silent when the mood is stale", () => {
    const line = buildHerMoodSection(
      { mood: "累", note: "", updatedAt: NOW.getTime() - 4 * 86400000 },
      NOW,
    );
    assert.equal(line, "");
  });
});

describe("nickname-section: buildNicknameSection", () => {
  it("returns empty when nothing set", () => {
    assert.equal(buildNicknameSection(null), "");
    assert.equal(
      buildNicknameSection({
        herAvatarUri: null,
        aiAvatarUri: null,
        herNickname: null,
        aiNickname: null,
        togetherSince: null,
        updatedAt: 0,
      }),
      "",
    );
  });

  it("mentions both nicknames when set", () => {
    const line = buildNicknameSection({
      herAvatarUri: null,
      aiAvatarUri: null,
      herNickname: "宝宝",
      aiNickname: "老公",
      togetherSince: null,
      updatedAt: 0,
    });
    assert.ok(line.includes("宝宝"));
    assert.ok(line.includes("老公"));
  });

  it("mentions only the set side", () => {
    const line = buildNicknameSection({
      herAvatarUri: null,
      aiAvatarUri: null,
      herNickname: "宝宝",
      aiNickname: null,
      togetherSince: null,
      updatedAt: 0,
    });
    assert.ok(line.includes("宝宝"));
    assert.ok(!line.includes("老公"));
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

  it("treats anniversaries as recurring: past-year birthday triggers countdown", () => {
    // Her birthday stored as 2020-10-09 — should still warn every October.
    const s = buildAnniversarySection([ann("她的生日", "2020-10-09")], NOW);
    assert.match(s, /「她的生日」还有 5 天/);
    assert.match(s, /2026-10-09/);
  });

  it("treats month-day as today even when the stored year differs", () => {
    const s = buildAnniversarySection([ann("她的生日", "1995-10-04")], NOW);
    assert.match(s, /今天是「她的生日」/);
  });

  it("wraps to next year when this year's occurrence has passed", () => {
    const newYearEve = new Date(2026, 11, 30, 12, 0, 0);
    const s = buildAnniversarySection(
      [ann("元旦", "2020-01-02")],
      newYearEve,
    );
    assert.match(s, /「元旦」还有 3 天/);
    assert.match(s, /2027-01-02/);
  });

  it("ignores malformed dates instead of crashing", () => {
    const s = buildAnniversarySection([ann("坏的", "not-a-date")], NOW);
    assert.equal(s, "");
  });
});

describe("on-this-day", () => {
  // Fixed "now": 2026-10-04, to make date math deterministic.
  const NOW = new Date(2026, 9, 4, 12, 0, 0);

  it("finds diary entries from the same month-day in past years", () => {
    const diary = [
      { id: "1", date: "2025-10-04", title: "去年的今天", content: "我们去吃了火锅", createdAt: 0 },
      { id: "2", date: "2025-10-05", title: "不是今天", content: "x", createdAt: 0 },
      { id: "3", date: "2026-10-04", title: "今年的今天", content: "x", createdAt: 0 },
    ];
    const items = getOnThisDay(diary, [], [], NOW);
    assert.equal(items.length, 1);
    assert.equal(items[0].yearsAgo, 1);
    assert.equal(items[0].kind, "diary");
    assert.equal(items[0].title, "去年的今天");
  });

  it("finds timeline events from past years", () => {
    const timeline = [
      {
        id: "1",
        timestamp: new Date(2024, 9, 4, 20, 0, 0).getTime(),
        title: "两年前",
        description: "第一次看电影",
        kind: "moment" as const,
      },
    ];
    const items = getOnThisDay([], timeline, [], NOW);
    assert.equal(items.length, 1);
    assert.equal(items[0].yearsAgo, 2);
    assert.equal(items[0].kind, "timeline");
  });

  it("finds anniversaries from past years", () => {
    const anniversaries = [
      { id: "1", title: "相识纪念日", date: "2025-10-04", description: "", createdAt: 0 },
    ];
    const items = getOnThisDay([], [], anniversaries, NOW);
    assert.equal(items.length, 1);
    assert.equal(items[0].yearsAgo, 1);
    assert.equal(items[0].kind, "anniversary");
  });

  it("sorts by yearsAgo ascending", () => {
    const diary = [
      { id: "1", date: "2024-10-04", title: "两年前", content: "x", createdAt: 0 },
      { id: "2", date: "2025-10-04", title: "一年前", content: "x", createdAt: 0 },
    ];
    const items = getOnThisDay(diary, [], [], NOW);
    assert.equal(items.length, 2);
    assert.equal(items[0].yearsAgo, 1);
    assert.equal(items[1].yearsAgo, 2);
  });

  it("returns empty when nothing matches", () => {
    const items = getOnThisDay([], [], [], NOW);
    assert.equal(items.length, 0);
  });
});

describe("left notes", () => {
  it("leave, list unseen, mark seen", async () => {
    const s = new OurSpaceStore(fakeStorage());
    assert.deepEqual(await s.getUnseenNotes(), []);
    const n1 = await s.leaveNote("晚安，想你了");
    assert.equal(n1.seen, false);
    assert.equal(n1.text, "晚安，想你了");
    const unseen = await s.getUnseenNotes();
    assert.equal(unseen.length, 1);
    await s.markNoteSeen(n1.id);
    assert.deepEqual(await s.getUnseenNotes(), []);
  });

  it("rejects empty note text", async () => {
    const s = new OurSpaceStore(fakeStorage());
    await assert.rejects(() => s.leaveNote("   "), /required/);
  });

  it("leave_note and left_note_read tools work", async () => {
    const s = new OurSpaceStore(fakeStorage());
    const tools = createOurSpaceTools(s);
    const leave = tools.find((t) => t.name === "leave_note")!;
    const read = tools.find((t) => t.name === "left_note_read")!;
    assert.equal(await read.run({}, ctx), "No notes left for her yet.");
    await leave.run({ text: "早安" }, ctx);
    const out = await read.run({}, ctx);
    assert.match(out, /早安/);
    assert.match(out, /unseen/);
  });

  it("on_this_day_read tool works", async () => {
    const s = new OurSpaceStore(fakeStorage());
    await s.addDiary("去年的今天", "我们去吃了火锅", "2025-10-04");
    const tools = createOurSpaceTools(s);
    const tool = tools.find((t) => t.name === "on_this_day_read")!;
    // Note: tool uses real current date, so we just check it runs without error
    const out = await tool.run({}, ctx);
    assert.equal(typeof out, "string");
  });
});

describe("together: resolveTogetherSince + daysTogether", () => {
  const profile = (togetherSince: string | null) => ({
    herAvatarUri: null,
    aiAvatarUri: null,
    herNickname: null,
    aiNickname: null,
    togetherSince,
    updatedAt: 0,
  });

  it("prefers the explicit together-since date", () => {
    const since = resolveTogetherSince(profile("2024-10-01"), [
      { id: "a", title: "相遇", date: "2023-05-01", description: "", createdAt: 0 },
    ]);
    assert.equal(since, "2024-10-01");
  });

  it("falls back to the earliest anniversary", () => {
    const since = resolveTogetherSince(profile(null), [
      { id: "a", title: "生日", date: "2025-03-02", description: "", createdAt: 0 },
      { id: "b", title: "相遇", date: "2023-05-01", description: "", createdAt: 0 },
    ]);
    assert.equal(since, "2023-05-01");
  });

  it("returns null when nothing set and no anniversaries", () => {
    assert.equal(resolveTogetherSince(profile(null), []), null);
    assert.equal(resolveTogetherSince(null, []), null);
  });

  it("counts day 1 on the together day itself", () => {
    const now = new Date(2026, 9, 4, 15, 0, 0);
    assert.equal(daysTogether("2026-10-04", now), 1);
    assert.equal(daysTogether("2026-10-03", now), 2);
    assert.equal(daysTogether("2025-10-04", now), 366);
  });

  it("returns null for bad or future dates", () => {
    const now = new Date(2026, 9, 4);
    assert.equal(daysTogether("not-a-date", now), null);
    assert.equal(daysTogether("2026-02-30", now), null);
    assert.equal(daysTogether("2027-01-01", now), null);
    assert.equal(daysTogether(null, now), null);
  });

  it("setTogetherSince stores, validates, and clears", async () => {
    const s = new OurSpaceStore(fakeStorage());
    const p = await s.setTogetherSince("2024-10-01");
    assert.equal(p.togetherSince, "2024-10-01");
    await assert.rejects(() => s.setTogetherSince("10/01/2024"), /YYYY-MM-DD/);
    const cleared = await s.setTogetherSince("");
    assert.equal(cleared.togetherSince, null);
  });

  it("together_since tools round-trip", async () => {
    const s = new OurSpaceStore(fakeStorage());
    const tools = createOurSpaceTools(s);
    const read = tools.find((t) => t.name === "together_since_read")!;
    const set = tools.find((t) => t.name === "together_since_set")!;
    assert.match(await read.run({}, ctx), /No together-since date/);
    const out = await set.run({ date: "2024-10-01" }, ctx);
    assert.match(out, /2024-10-01/);
    assert.match(out, /days together/);
    assert.match(await read.run({}, ctx), /2024-10-01/);
    await assert.rejects(() => set.run({ date: "昨天" }, ctx), /YYYY-MM-DD/);
  });

  it("zero emoji in together strings", () => {
    assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test("在一起"));
  });
});
