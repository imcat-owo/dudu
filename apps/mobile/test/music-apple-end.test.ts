import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  APPLE_END_TOLERANCE_S,
  applyAppleEndOfTrack,
  type SourceStatus,
} from "../src/music/sources.js";

function status(over: Partial<SourceStatus>): SourceStatus {
  return { playing: false, position: 0, duration: null, trackId: null, ...over };
}

describe("P1-5: Apple Music end-of-track synthesis", () => {
  it("natural finish synthesizes the advance signal (playing:false + position:0)", () => {
    const prev = status({ playing: true, position: 179.2, duration: 180, trackId: "song1" });
    const mirrored = status({ playing: false, position: 180, duration: 180, trackId: "song1" });
    const out = applyAppleEndOfTrack(prev, mirrored);
    assert.equal(out.playing, false);
    assert.equal(out.position, 0);
    assert.equal(out.trackId, "song1");
  });

  it("mid-track pause is untouched (position kept)", () => {
    const prev = status({ playing: true, position: 59, duration: 180, trackId: "song1" });
    const mirrored = status({ playing: false, position: 60, duration: 180, trackId: "song1" });
    const out = applyAppleEndOfTrack(prev, mirrored);
    assert.equal(out.position, 60);
    assert.equal(out.playing, false);
  });

  it("playing state passes through unchanged", () => {
    const prev = status({ playing: true, position: 10, duration: 180, trackId: "song1" });
    const mirrored = status({ playing: true, position: 11, duration: 180, trackId: "song1" });
    assert.deepEqual(applyAppleEndOfTrack(prev, mirrored), mirrored);
  });

  it("stale MusicKit state after load() does not synthesize (song-id mismatch)", () => {
    // load() set the new track id; MusicKit still reports the old finished song.
    const prev = status({ playing: false, position: 0, duration: 150, trackId: "new-track" });
    const mirrored = status({ playing: false, position: 180, duration: 150, trackId: "old-song" });
    const out = applyAppleEndOfTrack(prev, mirrored);
    assert.equal(out.position, 180);
  });

  it("unknown duration never synthesizes", () => {
    const prev = status({ playing: true, position: 999, duration: null, trackId: "song1" });
    const mirrored = status({ playing: false, position: 999, duration: null, trackId: "song1" });
    assert.equal(applyAppleEndOfTrack(prev, mirrored).position, 999);
  });

  it("null song id never synthesizes", () => {
    const prev = status({ playing: true, position: 179.9, duration: 180, trackId: "song1" });
    const mirrored = status({ playing: false, position: 179.9, duration: 180, trackId: null });
    assert.equal(applyAppleEndOfTrack(prev, mirrored).position, 179.9);
  });

  it("position inside the tolerance window synthesizes; outside does not", () => {
    const prev = status({ playing: true, position: 170, duration: 180, trackId: "song1" });
    const inside = status({
      playing: false,
      position: 180 - APPLE_END_TOLERANCE_S,
      duration: 180,
      trackId: "song1",
    });
    assert.equal(applyAppleEndOfTrack(prev, inside).position, 0);
    const outside = status({
      playing: false,
      position: 180 - APPLE_END_TOLERANCE_S - 0.5,
      duration: 180,
      trackId: "song1",
    });
    assert.ok(applyAppleEndOfTrack(prev, outside).position > 0);
  });

  it("synthesis is stable across repeated polls (no re-fire)", () => {
    const prev = status({ playing: false, position: 0, duration: 180, trackId: "song1" });
    const mirrored = status({ playing: false, position: 180, duration: 180, trackId: "song1" });
    const out = applyAppleEndOfTrack(prev, mirrored);
    assert.equal(out.position, 0);
    assert.equal(out.playing, false);
  });
});
