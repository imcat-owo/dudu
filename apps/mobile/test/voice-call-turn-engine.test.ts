/**
 * voice-call turn-engine tests: the duplex state machine.
 *
 * Pins the contract the session executes against:
 * - listening → capturing → thinking → speaking → listening
 * - barge-in cancels speech (sustained user speech while speaking)
 * - empty/failed STT never fabricates a turn
 * - end-call is terminal
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DuplexTurnEngine } from "../src/voice-call/turn-engine";

function makeEngine() {
  let now = 1000;
  const engine = new DuplexTurnEngine(() => now);
  return { engine, tick: (ms: number) => (now += ms) };
}

describe("DuplexTurnEngine turn cycle", () => {
  it("runs a full turn: listen → capture → think → speak → listen", () => {
    const { engine } = makeEngine();
    assert.equal(engine.state, "listening");

    // She starts talking.
    assert.deepEqual(engine.dispatch({ type: "vad-speech-start" }), [{ type: "start-capture" }]);
    assert.equal(engine.state, "capturing");

    // She stops → transcribe.
    assert.deepEqual(engine.dispatch({ type: "vad-speech-end" }), [
      { type: "stop-capture-transcribe" },
    ]);
    assert.equal(engine.state, "thinking");

    // STT done → think.
    assert.deepEqual(engine.dispatch({ type: "stt-done", text: "你好呀" }), [
      { type: "think", userText: "你好呀" },
    ]);

    // LLM done → speak (sentences split for streaming TTS).
    const speak = engine.dispatch({ type: "llm-done", text: "嗨。你好吗？" });
    assert.equal(engine.state, "speaking");
    assert.equal(speak.length, 1);
    assert.equal(speak[0].type, "speak");
    if (speak[0].type === "speak") {
      assert.deepEqual(speak[0].sentences, ["嗨。", "你好吗？"]);
    }

    // Playback done → back to listening.
    assert.deepEqual(engine.dispatch({ type: "tts-queue-empty" }), [{ type: "back-to-listening" }]);
    assert.equal(engine.state, "listening");

    const stats = engine.getStats();
    assert.equal(stats.turns, 1);
    assert.equal(stats.bargeIns, 0);

    const transcript = engine.getTranscript();
    assert.deepEqual(
      transcript.map((t) => [t.role, t.text]),
      [
        ["user", "你好呀"],
        ["assistant", "嗨。你好吗？"],
      ],
    );
  });

  it("barge-in: user speech while speaking cancels speech and captures", () => {
    const { engine } = makeEngine();
    engine.dispatch({ type: "vad-speech-start" });
    engine.dispatch({ type: "vad-speech-end" });
    engine.dispatch({ type: "stt-done", text: "hi" });
    engine.dispatch({ type: "llm-done", text: "hello there" });
    assert.equal(engine.state, "speaking");

    const actions = engine.dispatch({ type: "barge-in" });
    assert.deepEqual(actions, [{ type: "cancel-speech" }, { type: "start-capture" }]);
    assert.equal(engine.state, "capturing");
    assert.equal(engine.getStats().bargeIns, 1);
  });

  it("vad-speech-start while speaking is also a barge-in", () => {
    const { engine } = makeEngine();
    engine.dispatch({ type: "vad-speech-start" });
    engine.dispatch({ type: "vad-speech-end" });
    engine.dispatch({ type: "stt-done", text: "hi" });
    engine.dispatch({ type: "llm-done", text: "hello" });
    const actions = engine.dispatch({ type: "vad-speech-start" });
    assert.deepEqual(actions, [{ type: "cancel-speech" }, { type: "start-capture" }]);
  });

  it("empty STT goes back to listening without a phantom turn", () => {
    const { engine } = makeEngine();
    engine.dispatch({ type: "vad-speech-start" });
    engine.dispatch({ type: "vad-speech-end" });
    assert.deepEqual(engine.dispatch({ type: "stt-empty" }), [{ type: "back-to-listening" }]);
    assert.equal(engine.state, "listening");
    assert.equal(engine.getStats().turns, 0);
    assert.equal(engine.getTranscript().length, 0);
  });

  it("blank stt-done text is treated as empty", () => {
    const { engine } = makeEngine();
    engine.dispatch({ type: "vad-speech-start" });
    engine.dispatch({ type: "vad-speech-end" });
    assert.deepEqual(engine.dispatch({ type: "stt-done", text: "   " }), [
      { type: "back-to-listening" },
    ]);
    assert.equal(engine.getStats().turns, 0);
  });

  it("STT error is loud, not faked — logged in transcript", () => {
    const { engine } = makeEngine();
    engine.dispatch({ type: "vad-speech-start" });
    engine.dispatch({ type: "vad-speech-end" });
    const actions = engine.dispatch({ type: "stt-error", error: "network" });
    assert.deepEqual(actions, [{ type: "back-to-listening" }]);
    assert.equal(engine.state, "listening");
    assert.equal(engine.getStats().turns, 0);
    assert.match(engine.getTranscript()[0].text, /没听清/);
  });

  it("capture-timeout ends an overlong capture", () => {
    const { engine } = makeEngine();
    engine.dispatch({ type: "vad-speech-start" });
    assert.deepEqual(engine.dispatch({ type: "capture-timeout" }), [
      { type: "stop-capture-transcribe" },
    ]);
    assert.equal(engine.state, "thinking");
  });

  it("end-call is terminal: further events are ignored", () => {
    const { engine } = makeEngine();
    const end = engine.dispatch({ type: "end-call" });
    assert.equal(end[0].type, "call-ended");
    assert.equal(engine.isEnded, true);
    assert.deepEqual(engine.dispatch({ type: "vad-speech-start" }), []);
    assert.ok(engine.getStats().endedAt);
  });

  it("events in the wrong state are ignored", () => {
    const { engine } = makeEngine();
    // tts-queue-empty while listening → no-op.
    assert.deepEqual(engine.dispatch({ type: "tts-queue-empty" }), []);
    // barge-in while listening → no-op.
    assert.deepEqual(engine.dispatch({ type: "barge-in" }), []);
    assert.equal(engine.state, "listening");
  });
});
