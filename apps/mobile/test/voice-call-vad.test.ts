/**
 * voice-call VAD tests: energy-based voice activity detection boundaries.
 *
 * The VAD is the ear of the duplex loop — speech-start/stop drives turn
 * taking, and BargeInVad (stricter threshold) guards against the speaker
 * echoing into the mic while the AI talks.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_VAD_CONFIG } from "../src/voice-call/types";
import { BargeInVad, EnergyVad } from "../src/voice-call/vad";

const cfg = DEFAULT_VAD_CONFIG; // threshold -38dB, silenceEnd 900ms

describe("EnergyVad", () => {
  it("fires speech-start when level crosses the threshold", () => {
    const vad = new EnergyVad(cfg);
    assert.deepEqual(vad.push(-50, 1000), []);
    assert.deepEqual(vad.push(-30, 1100), ["speech-start"]);
    assert.equal(vad.isSpeaking, true);
  });

  it("does not re-fire speech-start while already speaking", () => {
    const vad = new EnergyVad(cfg);
    vad.push(-30, 1000);
    assert.deepEqual(vad.push(-25, 1100), []);
    assert.deepEqual(vad.push(-28, 1200), []);
  });

  it("fires speech-end after silenceEndMs of quiet", () => {
    const vad = new EnergyVad(cfg);
    vad.push(-30, 1000);
    // Last speech at 1000; silence shorter than 900ms → no event.
    assert.deepEqual(vad.push(-60, 1800), []);
    assert.equal(vad.isSpeaking, true);
    // 950ms of quiet → end.
    assert.deepEqual(vad.push(-60, 1950), ["speech-end"]);
    assert.equal(vad.isSpeaking, false);
  });

  it("resets the silence clock on intermittent speech", () => {
    const vad = new EnergyVad(cfg);
    vad.push(-30, 1000);
    vad.push(-60, 1500); // 500ms quiet
    vad.push(-30, 1600); // speech again — clock resets
    assert.deepEqual(vad.push(-60, 2400), []); // 800ms < 900ms
    assert.deepEqual(vad.push(-60, 2501), ["speech-end"]);
  });

  it("treats undefined metering (no data) as silence, not speech", () => {
    const vad = new EnergyVad(cfg);
    assert.deepEqual(vad.push(undefined, 1000), []);
    vad.push(-30, 1100);
    // undefined counts as a quiet sample — after 900ms it ends speech.
    assert.deepEqual(vad.push(undefined, 2001), ["speech-end"]);
  });

  it("reports burst duration for the barge-in gate", () => {
    const vad = new EnergyVad(cfg);
    vad.push(-30, 1000);
    assert.equal(vad.speechDurationMs(1300), 300);
    assert.equal(vad.speechDurationMs(1500), 500);
  });

  it("reset clears speaking state", () => {
    const vad = new EnergyVad(cfg);
    vad.push(-30, 1000);
    vad.reset();
    assert.equal(vad.isSpeaking, false);
    // After reset, the next loud sample fires speech-start again.
    assert.deepEqual(vad.push(-30, 1100), ["speech-start"]);
  });
});

describe("BargeInVad (echo guard)", () => {
  it("needs louder audio than the normal VAD", () => {
    const barge = new BargeInVad(cfg); // threshold -28dB
    // -30dB would start the normal VAD but not the barge-in VAD.
    assert.deepEqual(barge.push(-30, 1000), []);
    assert.deepEqual(barge.push(-25, 1100), ["speech-start"]);
  });

  it("shares the silence-end behavior", () => {
    const barge = new BargeInVad(cfg);
    barge.push(-25, 1000);
    assert.deepEqual(barge.push(-60, 1950), ["speech-end"]);
  });
});
