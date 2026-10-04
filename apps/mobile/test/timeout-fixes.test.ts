/**
 * Round-3 code audit fixes — timeouts + verifyHerRequest hardening.
 *
 * Every network call these cover previously had NO timeout: a hung server
 * wedged the feature (meeting chain, chat turn, indexing, settings test
 * button, voice picker, legacy cloud). Each test below hangs the fetch
 * forever (honoring the abort signal) and asserts the call rejects within
 * its budget instead of hanging.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { testConnection } from "../src/api-groups/direct-transport.js";
import { classifyError } from "../src/api-groups/error-classifier.js";
import type { ApiGroup } from "../src/api-groups/types.js";
import { generateOneShot, verifyHerRequest } from "../src/chat/group-meeting-tools.js";
import { embedTexts } from "../src/knowledge/embeddings.js";
import { postVisionRequest, VisionError } from "../src/vision/describe.js";
import { EdgeTtsError, fetchEdgeVoices } from "../src/voice/edge-tts.js";

const realFetch = globalThis.fetch;

function fakeGroup(): ApiGroup {
  return {
    id: "g1",
    name: "test",
    baseUrl: "https://example.com/v1",
    apiKey: "k",
    model: "m",
    headers: {},
  } as ApiGroup;
}

/** A fetch that never answers, but rejects with AbortError when aborted. */
function hangingFetch(): void {
  globalThis.fetch = ((_url: unknown, init?: { signal?: AbortSignal }) =>
    new Promise<never>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
        return;
      }
      signal?.addEventListener("abort", () => {
        reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
      });
    })) as unknown as typeof fetch;
}

beforeEach(() => {
  hangingFetch();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("generateOneShot timeout (round-3 code P1-1)", () => {
  it("rejects with a timeout error instead of wedging the meeting chain", async () => {
    const start = Date.now();
    await assert.rejects(
      generateOneShot(fakeGroup(), "sys", "user", { timeoutMs: 80 }),
      /timed out/,
    );
    assert.ok(Date.now() - start < 5000, "must settle within the budget, not hang");
  });

  it("still resolves on a healthy server", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "  hello  " } }] }), {
        status: 200,
      })) as unknown as typeof fetch;
    const text = await generateOneShot(fakeGroup(), "sys", "user", { timeoutMs: 5000 });
    assert.equal(text, "hello");
  });
});

describe("verifyHerRequest hardening (round-3 code P2-7 / ai-use P2-3)", () => {
  it("accepts her exact words", () => {
    verifyHerRequest("你们讨论一下今晚吃什么", ["你们讨论一下今晚吃什么"]);
  });

  it("accepts a genuine partial quote (her words, verbatim)", () => {
    verifyHerRequest("讨论一下今晚吃什么", ["你们讨论一下今晚吃什么"]);
  });

  it("rejects a 2-char real message (the old vacuous case)", () => {
    assert.throws(() => verifyHerRequest("好", ["好"]), /太短/);
  });

  it("rejects a padded fabrication that merely contains her 2-char reply", () => {
    // Old code: req.includes(u) let this through. New code must refuse it.
    assert.throws(() => verifyHerRequest("好，你跟备用讨论一下今晚吃什么吧", ["好"]), /找不到原样/);
  });

  it("rejects a quote that never appeared in her messages", () => {
    assert.throws(
      () => verifyHerRequest("你们讨论一下周末去哪玩", ["你们讨论一下今晚吃什么"]),
      /找不到原样/,
    );
  });
});

describe("postVisionRequest timeout (round-3 code P2-2)", () => {
  it("rejects with VisionError on a hung vision backend", async () => {
    const start = Date.now();
    await assert.rejects(
      postVisionRequest("https://example.com/v1/chat/completions", {}, "{}", 80),
      (e: unknown) => e instanceof VisionError && /超时/.test(e.message),
    );
    assert.ok(Date.now() - start < 5000, "must settle within the budget, not hang");
  });

  it("returns the raw response on a healthy backend", async () => {
    globalThis.fetch = (async () =>
      new Response("hello", { status: 200 })) as unknown as typeof fetch;
    const out = await postVisionRequest("https://example.com/x", {}, "{}", 5000);
    assert.equal(out.ok, true);
    assert.equal(out.text, "hello");
  });
});

describe("embedTexts timeout (round-3 code P2-3)", () => {
  it("rejects with embeddingTimeout when the endpoint hangs and no signal was passed", async () => {
    const start = Date.now();
    await assert.rejects(embedTexts(fakeGroup(), ["hello"]), /embeddingTimeout/);
    assert.ok(Date.now() - start < 60_000, "must settle within the 30s budget, not hang");
  });
});

describe("testConnection timeout (round-3 code P2-4 / user P1)", () => {
  it("rejects a hung chat probe as a timeout, classified as network_error", async () => {
    // /models answers fast (empty list); only the chat probe hangs.
    globalThis.fetch = ((url: unknown, init?: { signal?: AbortSignal }) => {
      if (String(url).endsWith("/models")) {
        return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
      }
      return new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
        });
      });
    }) as unknown as typeof fetch;
    const start = Date.now();
    const err = await testConnection(fakeGroup(), { timeoutMs: 80 }).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(err instanceof Error, "must reject");
    assert.match(err.message, /timed out/);
    assert.equal(classifyError(err), "network_error");
    assert.ok(Date.now() - start < 5000, "must settle within the budget, not hang");
  });

  it("still succeeds on a healthy server", async () => {
    globalThis.fetch = ((url: unknown) => {
      if (String(url).endsWith("/models")) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: [{ id: "m1" }, { id: "m2" }] }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response("ok", { status: 200 }));
    }) as unknown as typeof fetch;
    const out = await testConnection(fakeGroup(), { timeoutMs: 5000 });
    assert.equal(out.ok, true);
    assert.deepEqual(out.models, ["m1", "m2"]);
  });
});

describe("fetchEdgeVoices timeout (round-3 code P3-1)", () => {
  it("rejects with EdgeTtsError on a stalled endpoint", async () => {
    const start = Date.now();
    await assert.rejects(fetchEdgeVoices({ timeoutMs: 80 }), (e: unknown) => {
      return e instanceof EdgeTtsError && /timed out/.test(e.message);
    });
    assert.ok(Date.now() - start < 5000, "must settle within the budget, not hang");
  });
});
