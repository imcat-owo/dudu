/**
 * P1-4 regression tests: custom TTS and STT fetches must carry an abort
 * timeout so a hanging server can't hang the UI forever.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { ApiGroup } from "../src/api-groups/types.js";
import { transcribeAudioWithCandidates } from "../src/voice/stt.js";
import { postCustomSpeech, TtsError } from "../src/voice/tts.js";
import { blankSttConfig } from "../src/voice/types.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function abortingFetch(): typeof fetch {
  return (async () => {
    throw new DOMException("This operation was aborted", "AbortError");
  }) as typeof fetch;
}

const group = {
  id: "g1",
  name: "test",
  vendor: "openai",
  baseUrl: "https://api.example.com/v1",
  apiKey: "k",
  model: "gpt-test",
  headers: {},
  createdAt: 0,
} as ApiGroup;

describe("custom TTS timeout (P1-4)", () => {
  it("an aborted request surfaces as a timeout error", async () => {
    globalThis.fetch = abortingFetch();
    await assert.rejects(
      () => postCustomSpeech("https://tts.example.com/v1", {}, "{}"),
      (e: unknown) => {
        assert.ok(e instanceof TtsError, `expected TtsError, got ${e}`);
        assert.ok(/timed out after 60s/.test(e.message), `unexpected message: ${e.message}`);
        return true;
      },
    );
  });

  it("passes an AbortSignal to fetch so a hang can be cut off", async () => {
    let seenSignal: unknown = null;
    globalThis.fetch = (async (_url: unknown, init?: { signal?: unknown }) => {
      seenSignal = init?.signal;
      return new Response("audio-bytes", { status: 200 });
    }) as typeof fetch;
    await postCustomSpeech("https://tts.example.com/v1", {}, "{}");
    assert.ok(seenSignal instanceof AbortSignal, "fetch must receive an AbortSignal");
  });
});

describe("STT timeout (P1-4)", () => {
  it("an aborted request surfaces as a timeout error, not a hang", async () => {
    globalThis.fetch = abortingFetch();
    await assert.rejects(
      () => transcribeAudioWithCandidates("file:///speech.m4a", [group], blankSttConfig()),
      /超时/,
      "the user must see a timeout, not silence",
    );
  });

  it("passes an AbortSignal to fetch so a hang can be cut off", async () => {
    let seenSignal: unknown = null;
    globalThis.fetch = (async (_url: unknown, init?: { signal?: unknown }) => {
      seenSignal = init?.signal;
      return new Response(JSON.stringify({ text: "hello" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const text = await transcribeAudioWithCandidates(
      "file:///speech.m4a",
      [group],
      blankSttConfig(),
    );
    assert.equal(text, "hello");
    assert.ok(seenSignal instanceof AbortSignal, "fetch must receive an AbortSignal");
  });
});
