/**
 * Interactive story mode （互动故事） — store tests.
 *
 * Under test:
 *  1. create/get/list/findByThread/update/remove round-trip.
 *  2. Corrupt storage entries are sanitized, never crash.
 *  3. State survives a store "reload" (new instance, same storage).
 *  4. findByThread only returns non-ended stories, newest wins.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StoryStore } from "../src/story/store.js";

const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);

function fakeKv(initial?: Record<string, string>) {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: async (k: string) => map.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      map.set(k, v);
    },
    _map: map,
  };
}

describe("StoryStore", () => {
  it("creates and gets a story", async () => {
    const store = new StoryStore(fakeKv());
    const s = await store.create(
      { personaId: "p1", threadId: "t1", title: "雾岛灯塔", premise: "潮汐里捡到黄铜钥匙" },
      NOW,
    );
    assert.ok(s);
    assert.equal(s.title, "雾岛灯塔");
    assert.equal(s.status, "active");
    assert.equal(s.currentChapter, 1);
    assert.deepEqual(s.scenes, []);
    const got = await store.get(s.id);
    assert.equal(got?.premise, "潮汐里捡到黄铜钥匙");
  });

  it("rejects invalid input without throwing", async () => {
    const store = new StoryStore(fakeKv());
    assert.equal(
      await store.create({ personaId: "", threadId: "t1", title: "x", premise: "" }, NOW),
      null,
    );
    assert.equal(
      await store.create({ personaId: "p1", threadId: "t1", title: "  ", premise: "" }, NOW),
      null,
    );
  });

  it("lists by persona, newest first, ended excluded by default", async () => {
    const store = new StoryStore(fakeKv());
    const a = await store.create({ personaId: "p1", threadId: "t1", title: "A", premise: "" }, NOW);
    const b = await store.create(
      { personaId: "p1", threadId: "t2", title: "B", premise: "" },
      NOW + 1,
    );
    await store.create({ personaId: "p2", threadId: "t3", title: "C", premise: "" }, NOW + 2);
    assert.ok(a && b);
    await store.update(b.id, NOW + 3, (s) => ({ ...s, status: "ended" }));
    const list = await store.list("p1");
    assert.deepEqual(
      list.map((s) => s.title),
      ["A"],
    );
    const withEnded = await store.list("p1", true);
    assert.deepEqual(
      withEnded.map((s) => s.title),
      ["B", "A"],
    );
  });

  it("findByThread returns the newest non-ended story", async () => {
    const store = new StoryStore(fakeKv());
    const a = await store.create({ personaId: "p1", threadId: "t1", title: "A", premise: "" }, NOW);
    assert.ok(a);
    await store.update(a.id, NOW + 1, (s) => ({ ...s, status: "paused" }));
    // paused still counts (resumable in this dialog)
    assert.equal((await store.findByThread("t1"))?.id, a.id);
    await store.update(a.id, NOW + 2, (s) => ({ ...s, status: "ended" }));
    assert.equal(await store.findByThread("t1"), null);
    assert.equal(await store.findByThread("nope"), null);
  });

  it("update applies mutations and bumps updatedAt", async () => {
    const store = new StoryStore(fakeKv());
    const s = await store.create({ personaId: "p1", threadId: "t1", title: "A", premise: "" }, NOW);
    assert.ok(s);
    const updated = await store.update(s.id, NOW + 100, (prev) => ({
      ...prev,
      bible: {
        ...prev.bible,
        characters: [{ name: "阿岚", desc: "灯塔看守的女儿" }],
      },
    }));
    assert.equal(updated?.bible.characters[0].name, "阿岚");
    assert.equal(updated?.updatedAt, NOW + 100);
    assert.equal(await store.update("missing", NOW, (p) => p), null);
  });

  it("remove deletes", async () => {
    const store = new StoryStore(fakeKv());
    const s = await store.create({ personaId: "p1", threadId: "t1", title: "A", premise: "" }, NOW);
    assert.ok(s);
    assert.equal(await store.remove(s.id), true);
    assert.equal(await store.get(s.id), null);
    assert.equal(await store.remove(s.id), false);
  });

  it("sanitizes corrupt entries instead of crashing", async () => {
    const kv = fakeKv({
      "dudu.story.v1.stories": JSON.stringify([
        { id: "good", personaId: "p1", threadId: "t1", title: "好", premise: "", status: "active" },
        { id: "", title: 42 },
        null,
        "junk",
        {
          id: "weird",
          personaId: "p1",
          threadId: "t1",
          title: "怪",
          status: "nonsense",
          scenes: [
            {
              id: "s1",
              summary: "ok",
              offeredChoices: [{ id: "A", label: "a" }],
              chosenChoiceId: "Z",
            },
          ],
          bible: { characters: [{ name: "阿岚" }, { name: 7 }], events: "nope" },
        },
      ]),
    });
    const store = new StoryStore(kv);
    const list = await store.list("p1", true);
    assert.equal(list.length, 2);
    const weird = list.find((s) => s.id === "weird");
    assert.ok(weird);
    assert.equal(weird.status, "active"); // nonsense -> active
    assert.equal(weird.scenes[0].chosenChoiceId, null); // Z wasn't offered -> null
    assert.equal(weird.bible.characters.length, 1);
    assert.deepEqual(weird.bible.events, []);
  });

  it("state survives a reload", async () => {
    const kv = fakeKv();
    const s1 = new StoryStore(kv);
    const created = await s1.create(
      { personaId: "p1", threadId: "t1", title: "雾岛灯塔", premise: "p" },
      NOW,
    );
    assert.ok(created);
    await s1.update(created.id, NOW + 5, (p) => ({
      ...p,
      scenes: [
        {
          id: "ss_1",
          chapter: 1,
          seq: 1,
          summary: "她在潮汐里捡到黄铜钥匙",
          offeredChoices: [{ id: "A", label: "收下钥匙" }],
          chosenChoiceId: null,
          freeNote: "",
          at: NOW,
        },
      ],
    }));
    const s2 = new StoryStore(kv); // "app restart"
    const got = await s2.get(created.id);
    assert.equal(got?.scenes.length, 1);
    assert.equal(got?.scenes[0].summary, "她在潮汐里捡到黄铜钥匙");
    assert.equal((await s2.findByThread("t1"))?.id, created.id);
  });
});
