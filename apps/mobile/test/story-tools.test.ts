/**
 * Interactive story mode （互动故事） — AI tools tests.
 *
 * Under test:
 *  1. All 11 tools exist with manualId "story" (纸条机制）.
 *  2. story_start binds to the current thread; refuses a second active
 *     story in the same dialog; requires an agreed premise.
 *  3. story_scene_add records scenes with choices; refuses to narrate
 *     past her unpicked choice.
 *  4. story_choose records her pick; rejects unknown ids.
 *  5. story_bible_update add/remove/update.
 *  6. pause/resume/end/delete lifecycle; resume rebinds to the dialog.
 *  7. INCOGNITO_BLOCKED_TOOLS blocks the 8 write tools but not
 *     story_list/story_show (FINAL-AUDIT hard lesson).
 *  8. Honest simulation: a full 3-scene arc with a choice that changes
 *     the story, bible updated, store reloaded, resume.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBlockedInIncognito } from "../src/api-groups/incognito-guard.js";
import { buildStorySection } from "../src/story/prompt.js";
import { StoryStore } from "../src/story/store.js";
import { createStoryTools, type StoryToolEnv } from "../src/story/tools.js";
import { pendingChoiceScene } from "../src/story/types.js";

const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);

function fakeKv() {
  const map = new Map<string, string>();
  return {
    getItem: async (k: string) => map.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      map.set(k, v);
    },
    _map: map,
  };
}

interface Harness {
  env: StoryToolEnv;
  store: StoryStore;
  kv: { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void> };
  threadId: string;
}

function makeHarness(threadId = "thread-1"): Harness {
  const kv = fakeKv();
  const store = new StoryStore(kv);
  const h: Harness = {
    env: null as unknown as StoryToolEnv,
    store,
    kv,
    threadId,
  };
  h.env = {
    storyStore: store,
    currentThreadId: () => h.threadId,
    getPersona: async (id: string) => (id === "personaA" ? { id: "personaA", name: "A" } : null),
    nowMs: () => NOW,
  };
  return h;
}

const toolCtx = { authorize: async () => true } as never;

async function runTool(h: Harness, name: string, args: Record<string, unknown>): Promise<string> {
  const tools = createStoryTools(h.env);
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `tool ${name} exists`);
  return tool.run(args, toolCtx);
}

describe("story tools", () => {
  it("all tools exist with manualId story", () => {
    const h = makeHarness();
    const tools = createStoryTools(h.env);
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(
      names,
      [
        "story_bible_update",
        "story_choose",
        "story_delete",
        "story_end",
        "story_list",
        "story_pause",
        "story_resume",
        "story_scene_add",
        "story_show",
        "story_start",
      ].sort(),
    );
    for (const t of tools) assert.equal(t.manualId, "story", t.name);
  });

  it("story_start creates a story bound to this dialog", async () => {
    const h = makeHarness();
    const out = await runTool(h, "story_start", {
      personaId: "personaA",
      title: "雾岛灯塔",
      premise: "潮汐里捡到黄铜钥匙",
    });
    assert.ok(out.includes("雾岛灯塔"));
    const stories = await h.store.list("personaA");
    assert.equal(stories.length, 1);
    assert.equal(stories[0].threadId, "thread-1");
    assert.equal(stories[0].status, "active");
  });

  it("story_start requires persona, title and an agreed premise", async () => {
    const h = makeHarness();
    await assert.rejects(
      runTool(h, "story_start", { personaId: "nope", title: "x", premise: "y" }),
      /Persona not found/,
    );
    await assert.rejects(
      runTool(h, "story_start", { personaId: "personaA", title: "", premise: "y" }),
      /title is required/,
    );
    await assert.rejects(
      runTool(h, "story_start", { personaId: "personaA", title: "x", premise: "" }),
      /premise is required/,
    );
  });

  it("story_start refuses a second active story in the same dialog", async () => {
    const h = makeHarness();
    await runTool(h, "story_start", { personaId: "personaA", title: "A", premise: "p" });
    await assert.rejects(
      runTool(h, "story_start", { personaId: "personaA", title: "B", premise: "p" }),
      /already has/,
    );
    // ...but a different dialog is fine
    h.threadId = "thread-2";
    await runTool(h, "story_start", { personaId: "personaA", title: "B", premise: "p" });
    assert.equal((await h.store.list("personaA")).length, 2);
  });

  it("story_scene_add records scenes; refuses to narrate past her pick", async () => {
    const h = makeHarness();
    await runTool(h, "story_start", { personaId: "personaA", title: "A", premise: "p" });
    const [s] = await h.store.list("personaA");
    const out = await runTool(h, "story_scene_add", {
      storyId: s.id,
      summary: "雾起了，她站在灯塔下",
      offeredChoices: ["进灯塔", "沿岸走"],
    });
    assert.ok(out.includes("第1章第1幕"));
    // Can't add scene 2 while she hasn't picked.
    await assert.rejects(
      runTool(h, "story_scene_add", { storyId: s.id, summary: "她走了进去" }),
      /hasn't picked yet/,
    );
    // Record her pick, then scene 2 works.
    const pick = await runTool(h, "story_choose", { storyId: s.id, choiceId: "b" });
    assert.ok(pick.includes("沿岸走"));
    await runTool(h, "story_scene_add", { storyId: s.id, summary: "她沿着海岸线走，雾更浓了" });
    const got = await h.store.get(s.id);
    assert.equal(got?.scenes.length, 2);
    assert.equal(got?.scenes[0].chosenChoiceId, "B");
    assert.equal(got?.scenes[1].seq, 2);
  });

  it("story_choose rejects unknown ids and non-pending states", async () => {
    const h = makeHarness();
    await runTool(h, "story_start", { personaId: "personaA", title: "A", premise: "p" });
    const [s] = await h.store.list("personaA");
    await runTool(h, "story_scene_add", {
      storyId: s.id,
      summary: "雾起了",
      offeredChoices: ["进灯塔"],
    });
    await assert.rejects(
      runTool(h, "story_choose", { storyId: s.id, choiceId: "Z" }),
      /wasn't offered/,
    );
    await runTool(h, "story_choose", { storyId: s.id, choiceId: "A" });
    await assert.rejects(
      runTool(h, "story_choose", { storyId: s.id, choiceId: "A" }),
      /No pending choice/,
    );
  });

  it("story_bible_update add/remove/update", async () => {
    const h = makeHarness();
    await runTool(h, "story_start", { personaId: "personaA", title: "A", premise: "p" });
    const [s] = await h.store.list("personaA");
    await runTool(h, "story_bible_update", {
      storyId: s.id,
      kind: "character",
      action: "add",
      name: "阿岚",
      desc: "灯塔看守的女儿",
    });
    await runTool(h, "story_bible_update", {
      storyId: s.id,
      kind: "place",
      action: "add",
      name: "雾岛",
    });
    await runTool(h, "story_bible_update", {
      storyId: s.id,
      kind: "event",
      action: "add",
      name: "她在潮汐里捡到黄铜钥匙",
    });
    let got = await h.store.get(s.id);
    assert.equal(got?.bible.characters.length, 1);
    assert.equal(got?.bible.places.length, 1);
    assert.equal(got?.bible.events.length, 1);
    // update existing
    await runTool(h, "story_bible_update", {
      storyId: s.id,
      kind: "character",
      action: "update",
      name: "阿岚",
      desc: "灯塔看守的女儿，怕海",
    });
    got = await h.store.get(s.id);
    assert.equal(got?.bible.characters[0].desc, "灯塔看守的女儿，怕海");
    // remove
    await runTool(h, "story_bible_update", {
      storyId: s.id,
      kind: "place",
      action: "remove",
      name: "雾岛",
    });
    got = await h.store.get(s.id);
    assert.equal(got?.bible.places.length, 0);
    // invalid kind/action rejected
    await assert.rejects(
      runTool(h, "story_bible_update", { storyId: s.id, kind: "nope", action: "add", name: "x" }),
      /kind must be/,
    );
  });

  it("pause/resume/end/delete lifecycle; resume rebinds to the dialog", async () => {
    const h = makeHarness();
    await runTool(h, "story_start", { personaId: "personaA", title: "A", premise: "p" });
    const [s] = await h.store.list("personaA");
    await runTool(h, "story_pause", { storyId: s.id });
    assert.equal((await h.store.get(s.id))?.status, "paused");
    // paused stories reject scene writes
    await assert.rejects(
      runTool(h, "story_scene_add", { storyId: s.id, summary: "x" }),
      /is paused/,
    );
    // resume in a NEW dialog rebinds
    h.threadId = "thread-2";
    const resumed = await runTool(h, "story_resume", { storyId: s.id });
    assert.ok(resumed.includes("STORY MODE is on"));
    const got = await h.store.get(s.id);
    assert.equal(got?.status, "active");
    assert.equal(got?.threadId, "thread-2");
    assert.equal(await h.store.findByThread("thread-1"), null);
    // end
    await runTool(h, "story_end", { storyId: s.id });
    assert.equal((await h.store.get(s.id))?.status, "ended");
    assert.equal(await h.store.findByThread("thread-2"), null);
    assert.equal((await h.store.list("personaA")).length, 0);
    assert.equal((await h.store.list("personaA", true)).length, 1);
    // delete
    await runTool(h, "story_delete", { storyId: s.id });
    assert.equal((await h.store.list("personaA", true)).length, 0);
  });

  it("story_list and story_show read back the story", async () => {
    const h = makeHarness();
    await runTool(h, "story_start", { personaId: "personaA", title: "雾岛灯塔", premise: "p" });
    const [s] = await h.store.list("personaA");
    await runTool(h, "story_bible_update", {
      storyId: s.id,
      kind: "character",
      action: "add",
      name: "阿岚",
      desc: "怕海",
    });
    const list = await runTool(h, "story_list", { personaId: "personaA" });
    assert.ok(list.includes("雾岛灯塔") && list.includes("进行中"));
    const show = await runTool(h, "story_show", { storyId: s.id });
    assert.ok(show.includes("阿岚") && show.includes("怕海"));
    const empty = await runTool(h, "story_list", { personaId: "nobody" });
    assert.ok(empty.includes("No stories yet"));
  });

  it("incognito blocks the 8 write tools, allows the 2 reads", () => {
    for (const name of [
      "story_start",
      "story_scene_add",
      "story_choose",
      "story_bible_update",
      "story_pause",
      "story_resume",
      "story_end",
      "story_delete",
    ]) {
      assert.equal(isBlockedInIncognito(name), true, `${name} must be blocked`);
    }
    assert.equal(isBlockedInIncognito("story_list"), false);
    assert.equal(isBlockedInIncognito("story_show"), false);
  });

  it("HONEST SIMULATION: 3-scene arc, choice changes the story, reload, resume", async () => {
    const h = makeHarness("thread-1");
    // 1. Start.
    await runTool(h, "story_start", {
      personaId: "personaA",
      title: "雾岛灯塔",
      premise: "潮汐退去后，沙滩上多了一把黄铜钥匙",
    });
    const [s] = await h.store.list("personaA");
    const sid = s.id;

    // 2. Scene 1 with choices.
    await runTool(h, "story_scene_add", {
      storyId: sid,
      summary: "退潮后的沙滩上，她发现了一把黄铜钥匙，灯塔方向传来雾笛",
      offeredChoices: ["捡起钥匙走向灯塔", "把钥匙埋回沙子里"],
    });
    await runTool(h, "story_bible_update", {
      storyId: sid,
      kind: "place",
      action: "add",
      name: "雾岛",
      desc: "只在雾天出现的岛",
    });

    // 3. She picks B — the story must follow HER pick.
    await runTool(h, "story_choose", { storyId: sid, choiceId: "B" });

    // 4. Scene 2 follows from B, not A.
    await runTool(h, "story_scene_add", {
      storyId: sid,
      summary: "她把钥匙埋回沙子里，转身时发现沙滩上多了一串不属于她的脚印",
      offeredChoices: ["跟着脚印走", "大声喊有人吗"],
    });
    await runTool(h, "story_bible_update", {
      storyId: sid,
      kind: "character",
      action: "add",
      name: "阿岚",
      desc: "灯塔看守的女儿，怕海",
    });
    await runTool(h, "story_bible_update", {
      storyId: sid,
      kind: "event",
      action: "add",
      name: "她把黄铜钥匙埋回了沙子里",
    });

    // 5. She picks A.
    await runTool(h, "story_choose", { storyId: sid, choiceId: "A" });

    // 6. Scene 3, open question.
    await runTool(h, "story_scene_add", {
      storyId: sid,
      summary: "脚印通向雾墙深处，雾里隐约有个小小的人影在等她",
    });

    // 7. Verify the recorded truth.
    const got = await h.store.get(sid);
    assert.ok(got);
    assert.equal(got.scenes.length, 3);
    assert.equal(got.scenes[0].chosenChoiceId, "B");
    assert.equal(got.scenes[1].chosenChoiceId, "A");
    assert.ok(got.scenes[1].summary.includes("埋回沙子"), "scene 2 follows HER choice B");
    assert.equal(pendingChoiceScene(got), null); // scene 3 was open — nothing pending
    assert.equal(got.bible.characters[0].name, "阿岚");
    assert.equal(got.bible.events[0].text, "她把黄铜钥匙埋回了沙子里");

    // 8. The prompt section carries all of it (bible injection is REAL).
    const section = buildStorySection(got, { personaId: "personaA", incognito: false });
    assert.ok(section.includes("阿岚"));
    assert.ok(section.includes("雾岛"));
    assert.ok(section.includes("她把黄铜钥匙埋回了沙子里"));
    assert.ok(section.includes("第 1 章") && section.includes("3"));
    assert.ok(section.includes("A") && section.includes("跟着脚印走"));

    // 9. Pause, "restart" (new store on same storage), resume elsewhere.
    await runTool(h, "story_pause", { storyId: sid });
    const reloaded = new StoryStore(h.kv);
    const again = await reloaded.get(sid);
    assert.equal(again?.scenes.length, 3);
    assert.equal(again?.bible.characters[0].name, "阿岚");
    assert.equal(again?.status, "paused");
    h.env = { ...h.env, storyStore: reloaded };
    h.threadId = "thread-9";
    await runTool(h, "story_resume", { storyId: sid });
    const resumed = await reloaded.get(sid);
    assert.equal(resumed?.status, "active");
    assert.equal(resumed?.threadId, "thread-9");
    const section2 = buildStorySection(resumed, { personaId: "personaA", incognito: false });
    assert.ok(section2.includes("阿岚"), "bible survives reload + resume");
  });
});
