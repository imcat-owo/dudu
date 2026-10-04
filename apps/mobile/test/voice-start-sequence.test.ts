import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StartSequence } from "../src/voice/start-sequence.js";

/**
 * Models VoiceRecorderButton.startRecording's await gaps with deferred
 * microtasks so the quick-tap interleaving is deterministic.
 */
async function simulatedStart(
  seq: StartSequence,
  onRecord: () => void,
): Promise<"recording" | "aborted"> {
  const token = seq.begin();
  await Promise.resolve(); // await requestRecordingPermissionsAsync()
  if (seq.isCancelled(token)) return "aborted";
  await Promise.resolve(); // await setAudioModeAsync(allowsRecording: true)
  if (seq.isCancelled(token)) return "aborted";
  await Promise.resolve(); // await recorder.prepareToRecordAsync()
  if (seq.isCancelled(token)) return "aborted";
  onRecord(); // recorder.record()
  return "recording";
}

describe("P1-8: StartSequence quick-tap race guard", () => {
  it("a start that completes is never cancelled", () => {
    const seq = new StartSequence();
    const token = seq.begin();
    assert.equal(seq.isCancelled(token), false);
  });

  it("P1-8 regression: stop landing mid-start aborts before record()", async () => {
    const seq = new StartSequence();
    let recorded = false;
    const p = simulatedStart(seq, () => {
      recorded = true;
    });
    await Promise.resolve(); // let the start pass the permission checkpoint
    seq.cancel(); // press-out (quick tap) lands mid-start
    const result = await p;
    assert.equal(result, "aborted");
    assert.equal(recorded, false, "record() must never run after a mid-start stop");
  });

  it("normal press-and-hold reaches record()", async () => {
    const seq = new StartSequence();
    let recorded = false;
    const result = await simulatedStart(seq, () => {
      recorded = true;
    });
    assert.equal(result, "recording");
    assert.equal(recorded, true);
  });

  it("a new press after a stop is a fresh, uncancelled attempt", () => {
    const seq = new StartSequence();
    const first = seq.begin();
    seq.cancel(); // the quick-tap stop
    const second = seq.begin(); // user presses again, deliberately
    assert.equal(seq.isCancelled(first), true);
    assert.equal(seq.isCancelled(second), false);
  });

  it("stop with no in-flight start is harmless", () => {
    const seq = new StartSequence();
    seq.cancel();
    const token = seq.begin();
    assert.equal(seq.isCancelled(token), false);
  });
});
