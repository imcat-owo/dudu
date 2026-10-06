/**
 * Interactive story mode （互动故事） — prompt section tests.
 *
 * Under test (the coherence contract):
 *  1. The bible is injected VERBATIM (characters / places / key events).
 *  2. Progress (chapter, scene count) and her last choice are present.
 *  3. A pending unpicked choice is surfaced with its ids.
 *  4. Empty when: no story, paused/ended, incognito, persona mismatch.
 *  5. Section stays within budget.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildStorySection } from "../src/story/prompt.js";
import type { Story } from "../src/story/types.js";

function story(partial: Partial<Story> = {}): Story {
  return {
    id: "st_1",
    personaId: "p1",
    threadId: "t1",
    title: "雾岛灯塔",
    premise: "潮汐里捡到黄铜钥匙",
    status: "active",
    currentChapter: 2,
    scenes: [
      {
        id: "ss_1",
        chapter: 1,
        seq: 1,
        summary: "她在潮汐里捡到黄铜钥匙，灯塔的雾散了",
        offeredChoices: [
          { id: "A", label: "收下钥匙" },
          { id: "B", label: "把钥匙扔回海里" },
        ],
        chosenChoiceId: "B",
        freeNote: "",
        at: 1,
      },
    ],
    bible: {
      characters: [{ name: "阿岚", desc: "灯塔看守的女儿，怕海" }],
      places: [{ name: "雾岛", desc: "只在雾天出现的岛" }],
      events: [{ text: "她在潮汐里捡到黄铜钥匙", at: 1 }],
    },
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

const OPTS = { personaId: "p1", incognito: false };

describe("buildStorySection", () => {
  it("injects the bible verbatim", () => {
    const section = buildStorySection(story(), OPTS);
    assert.ok(section.includes("阿岚"), "character name present");
    assert.ok(section.includes("灯塔看守的女儿，怕海"), "character desc present");
    assert.ok(section.includes("雾岛"), "place name present");
    assert.ok(section.includes("她在潮汐里捡到黄铜钥匙"), "key event present");
    assert.ok(section.includes("雾岛灯塔"), "title present");
    assert.ok(section.includes("潮汐里捡到黄铜钥匙"), "premise present");
  });

  it("carries progress and her last choice", () => {
    const section = buildStorySection(story(), OPTS);
    assert.ok(section.includes("第 2 章"), "chapter present");
    assert.ok(section.includes("B"), "choice id present");
    assert.ok(section.includes("把钥匙扔回海里"), "choice label present");
  });

  it("surfaces a pending unpicked choice", () => {
    const s = story({
      scenes: [
        {
          id: "ss_1",
          chapter: 1,
          seq: 1,
          summary: "雾起了",
          offeredChoices: [
            { id: "A", label: "进灯塔" },
            { id: "B", label: "沿岸走" },
          ],
          chosenChoiceId: null,
          freeNote: "",
          at: 1,
        },
      ],
    });
    const section = buildStorySection(s, OPTS);
    assert.ok(section.includes("还没选"), "pending choice flagged");
    assert.ok(section.includes("story_choose"), "records via story_choose");
  });

  it("bible edits take effect in the next section build", () => {
    const before = buildStorySection(story(), OPTS);
    assert.ok(!before.includes("老船长"), "not there before the edit");
    const edited = story({
      bible: {
        characters: [
          { name: "阿岚", desc: "灯塔看守的女儿，怕海" },
          { name: "老船长", desc: "知道雾岛秘密的人" },
        ],
        places: [],
        events: [],
      },
    });
    const after = buildStorySection(edited, OPTS);
    assert.ok(after.includes("老船长"), "new bible entry injected after edit");
    assert.ok(after.includes("知道雾岛秘密的人"));
  });

  it("is empty when story mode is not in effect", () => {
    assert.equal(buildStorySection(null, OPTS), "");
    assert.equal(buildStorySection(story({ status: "paused" }), OPTS), "");
    assert.equal(buildStorySection(story({ status: "ended" }), OPTS), "");
    assert.equal(buildStorySection(story(), { personaId: "p1", incognito: true }), "");
    assert.equal(buildStorySection(story(), { personaId: "other", incognito: false }), "");
    assert.equal(buildStorySection(story(), { personaId: null, incognito: false }), "");
  });

  it("stays within budget even with a fat bible", () => {
    const s = story({
      bible: {
        characters: Array.from({ length: 30 }, (_, i) => ({
          name: `人物${i}`,
          desc: "很长很长的描述".repeat(20),
        })),
        places: [],
        events: [],
      },
    });
    const section = buildStorySection(s, OPTS);
    assert.ok(section.length <= 1600, `section too long: ${section.length}`);
    // First entries survive trimming; the section still names the story.
    assert.ok(section.includes("人物0"));
    assert.ok(section.includes("雾岛灯塔"));
  });

  it("never traps: the section names the exit path", () => {
    const section = buildStorySection(story(), OPTS);
    assert.ok(section.includes("story_end"), "end path named");
    assert.ok(section.includes("story_pause"), "pause path named");
  });
});
