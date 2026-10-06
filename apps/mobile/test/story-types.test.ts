/**
 * Interactive story mode （互动故事） — PURE helpers tests.
 *
 * Under test:
 *  1. pendingChoiceScene finds the latest scene with unpicked choices.
 *  2. latestScene / nextSceneSeq behave.
 *  3. Id constructors produce unique, prefixed ids.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  latestScene,
  newSceneId,
  newStoryId,
  nextSceneSeq,
  pendingChoiceScene,
  type Story,
  type StoryScene,
} from "../src/story/types.js";

function scene(partial: Partial<StoryScene>): StoryScene {
  return {
    id: `ss_${Math.random()}`,
    chapter: 1,
    seq: 1,
    summary: "x",
    offeredChoices: [],
    chosenChoiceId: null,
    freeNote: "",
    at: 0,
    ...partial,
  };
}

function story(scenes: StoryScene[]): Story {
  return {
    id: "st_1",
    personaId: "p1",
    threadId: "t1",
    title: "T",
    premise: "",
    status: "active",
    currentChapter: 1,
    scenes,
    bible: { characters: [], places: [], events: [] },
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("story type helpers", () => {
  it("pendingChoiceScene finds the latest unpicked scene with choices", () => {
    const s1 = scene({ id: "s1", offeredChoices: [{ id: "A", label: "a" }], chosenChoiceId: "A" });
    const s2 = scene({ id: "s2", offeredChoices: [] }); // open question — not pending
    const s3 = scene({
      id: "s3",
      offeredChoices: [
        { id: "A", label: "a" },
        { id: "B", label: "b" },
      ],
    });
    const st = story([s1, s2, s3]);
    assert.equal(pendingChoiceScene(st)?.id, "s3");
  });

  it("pendingChoiceScene returns null when nothing is pending", () => {
    const st = story([
      scene({ offeredChoices: [{ id: "A", label: "a" }], chosenChoiceId: "A" }),
      scene({ offeredChoices: [] }),
    ]);
    assert.equal(pendingChoiceScene(st), null);
    assert.equal(pendingChoiceScene(story([])), null);
  });

  it("latestScene returns the last scene", () => {
    const s1 = scene({ id: "s1" });
    const s2 = scene({ id: "s2" });
    assert.equal(latestScene(story([s1, s2]))?.id, "s2");
    assert.equal(latestScene(story([])), null);
  });

  it("nextSceneSeq counts per chapter", () => {
    const st = story([
      scene({ chapter: 1, seq: 1 }),
      scene({ chapter: 1, seq: 2 }),
      scene({ chapter: 2, seq: 1 }),
    ]);
    assert.equal(nextSceneSeq(st, 1), 3);
    assert.equal(nextSceneSeq(st, 2), 2);
    assert.equal(nextSceneSeq(st, 3), 1);
  });

  it("id constructors are unique and prefixed", () => {
    const a = newStoryId(1000);
    const b = newStoryId(1000);
    assert.ok(a.startsWith("st_") && b.startsWith("st_") && a !== b);
    const c = newSceneId(1000);
    assert.ok(c.startsWith("ss_"));
  });
});
