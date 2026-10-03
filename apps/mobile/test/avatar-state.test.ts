import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AVATAR_STATE_VIDEO,
  AVATAR_STATES,
  type AvatarState,
  resolveAvatarState,
} from "../src/avatar-state.js";

describe("avatar state model", () => {
  it("has exactly 6 states", () => {
    assert.equal(AVATAR_STATES.length, 6);
  });

  it("maps every state to one of the 4 bundled videos", () => {
    const files = new Set(["idle", "working", "making_something", "milestone_level_up"]);
    for (const s of AVATAR_STATES) {
      assert.ok(files.has(AVATAR_STATE_VIDEO[s]), `${s} maps to a known video file`);
    }
  });

  it("idle.mp4 covers idle + connecting", () => {
    assert.equal(AVATAR_STATE_VIDEO.idle, "idle");
    assert.equal(AVATAR_STATE_VIDEO.connecting, "idle");
  });

  it("working.mp4 covers working + waiting_for_subagents", () => {
    assert.equal(AVATAR_STATE_VIDEO.working, "working");
    assert.equal(AVATAR_STATE_VIDEO.waiting_for_subagents, "working");
  });

  it("making_something and milestone_level_up have their own videos", () => {
    assert.equal(AVATAR_STATE_VIDEO.making_something, "making_something");
    assert.equal(AVATAR_STATE_VIDEO.milestone_level_up, "milestone_level_up");
  });

  it("mapping is exhaustive over the AvatarState type", () => {
    const keys = Object.keys(AVATAR_STATE_VIDEO).sort();
    assert.deepEqual(keys, [...AVATAR_STATES].sort());
    // Type-level exhaustiveness: every key must be a valid AvatarState.
    const asStates: AvatarState[] = keys as AvatarState[];
    assert.equal(asStates.length, 6);
  });
});

describe("resolveAvatarState", () => {
  it("is working when the chat turn is busy", () => {
    assert.equal(resolveAvatarState({ busy: true, running: false }), "working");
  });

  it("is working when the agent engine is running", () => {
    assert.equal(resolveAvatarState({ busy: false, running: true }), "working");
  });

  it("is idle when nothing is happening", () => {
    assert.equal(resolveAvatarState({ busy: false, running: false }), "idle");
  });
});
