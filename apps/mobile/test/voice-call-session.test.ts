/**
 * voice-call session tests: the full duplex loop with fake adapters.
 *
 * This is the honest loopback simulation — fake mic input → STT text →
 * model reply → TTS chunks → the "speaker" receives audio. No real audio,
 * no network: the session is PURE behind its adapter boundary, so the
 * whole chain is asserted in node.
 *
 * What needs a real device (NOT covered here): actual mic capture,
 * expo-audio playback, speaker/mic concurrency on iOS, real latency.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type CallAdapters, type ChatTurn, VoiceCallSession } from "../src/voice-call/session";
import { DEFAULT_VAD_CONFIG } from "../src/voice-call/types";

const flush = async (rounds = 8) => {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
};

interface FakeWorld {
  adapters: CallAdapters;
  meter: (db: number | undefined) => void;
  spoken: string[]; // uris the "speaker" received, in order
  stopNowCalls: number;
  ttsInputs: string[];
  advance: (ms: number) => void;
  now: () => number;
}

/** Build fake adapters. */
function makeWorld(opts?: {
  sttText?: string;
  llmText?: string;
  llmHistory?: ChatTurn[][];
}): FakeWorld {
  let now = 0;
  const spoken: string[] = [];
  const ttsInputs: string[] = [];
  const llmHistory: ChatTurn[][] = opts?.llmHistory ?? [];
  let stopNowCalls = 0;
  let onMeter: ((db: number | undefined) => void) | null = null;
  let ttsCount = 0;

  const adapters: CallAdapters = {
    nowMs: () => now,
    mic: {
      async startMonitor(cb) {
        onMeter = cb;
      },
      async stopMonitor() {
        onMeter = null;
      },
      async startSegment() {},
      async stopSegment() {
        return "file://seg1";
      },
      async cancelSegment() {},
    },
    speaker: {
      get isPlaying() {
        return false;
      },
      async playQueue(uris: string[]) {
        spoken.push(...uris);
      },
      stopNow() {
        stopNowCalls += 1;
      },
    },
    stt: async (_uri: string) => opts?.sttText ?? "你好呀",
    llm: async (history: ChatTurn[]) => {
      llmHistory.push(history);
      return opts?.llmText ?? "嗨。你好吗？";
    },
    tts: async (sentence: string) => {
      ttsInputs.push(sentence);
      return `tts://${ttsCount++}`;
    },
  };
  return {
    adapters,
    meter: (db) => onMeter?.(db),
    spoken,
    get stopNowCalls() {
      return stopNowCalls;
    },
    ttsInputs,
    advance: (ms) => (now += ms),
    now: () => now,
  };
}

describe("VoiceCallSession loopback", () => {
  it("mic → STT → LLM → TTS → speaker: the full chain", async () => {
    const w = makeWorld();
    const states: string[] = [];
    const session = new VoiceCallSession(w.adapters, DEFAULT_VAD_CONFIG, {
      onTurnState: (s) => states.push(s),
    });
    await session.start();
    assert.equal(session.turnState, "listening");

    // She talks: loud sample starts capture.
    w.meter(-30);
    await flush();
    assert.equal(session.turnState, "capturing");

    // 950ms of silence ends the turn → STT → LLM → 2 TTS sentences → speaker.
    w.advance(950);
    w.meter(-60);
    await flush();

    assert.equal(session.turnState, "listening");
    assert.deepEqual(w.ttsInputs, ["嗨。", "你好吗？"]);
    assert.deepEqual(w.spoken, ["tts://0", "tts://1"]);

    await session.end();
    assert.equal(session.isRunning, false);
    // The state machine visited every phase of a turn.
    assert.ok(states.includes("capturing"));
    assert.ok(states.includes("thinking"));
    assert.ok(states.includes("speaking"));
    assert.ok(states.includes("listening"));
  });

  it("empty STT produces no turn and no TTS", async () => {
    const w = makeWorld({ sttText: "   " });
    const session = new VoiceCallSession(w.adapters);
    await session.start();
    w.meter(-30);
    await flush();
    w.advance(950);
    w.meter(-60);
    await flush();
    assert.equal(session.turnState, "listening");
    assert.deepEqual(w.ttsInputs, []);
    assert.deepEqual(w.spoken, []);
    await session.end();
  });

  it("barge-in: sustained speech while speaking cancels TTS and stops audio", async () => {
    const w = makeWorld();
    const session = new VoiceCallSession(w.adapters);
    await session.start();

    // Get to "speaking": drive one turn but hold TTS behind a manual gate
    // so the session sits mid-speak while we barge in.
    const gate: { release: (() => void) | null } = { release: null };
    const origTts = w.adapters.tts;
    w.adapters.tts = async (s: string) => {
      await new Promise<void>((r) => {
        gate.release = r;
      });
      return origTts(s);
    };

    w.meter(-30);
    await flush();
    w.advance(950);
    w.meter(-60);
    await flush(12);
    assert.equal(session.turnState, "speaking");

    // She talks over the AI: loud (-20dB, above the -28 barge threshold),
    // sustained past the 450ms min-speech gate.
    for (let i = 0; i < 6; i++) {
      w.advance(100);
      w.meter(-20);
      await flush(2);
    }
    assert.equal(session.turnState, "capturing");
    gate.release?.();
    await flush();

    // The speaker was stopped mid-sentence; no queued audio played out.
    assert.deepEqual(w.spoken, []);
    assert.ok(w.stopNowCalls >= 1);
    await session.end();
  });

  it("mute stops the monitor; unmute restarts it", async () => {
    const w = makeWorld();
    const session = new VoiceCallSession(w.adapters);
    await session.start();
    await session.setMuted(true);
    // Loud input while muted → nothing happens (no phantom VAD).
    w.meter(-30);
    await flush();
    assert.equal(session.turnState, "listening");
    await session.setMuted(false);
    w.meter(-30);
    await flush();
    assert.equal(session.turnState, "capturing");
    await session.end();
  });

  it("LLM sees the conversation history", async () => {
    const histories: ChatTurn[][] = [];
    const w = makeWorld({ llmHistory: histories, llmText: "嗯。" });
    const session = new VoiceCallSession(w.adapters);
    await session.start();
    w.meter(-30);
    await flush();
    w.advance(950);
    w.meter(-60);
    await flush();
    assert.equal(histories.length, 1);
    assert.deepEqual(histories[0], [{ role: "user", text: "你好呀" }]);
    await session.end();
  });
});
