/**
 * Round-3 code P3-2 — legacy cloud api.ts timeouts.
 *
 * Split from timeout-fixes.test.ts: src/api.ts imports src/i18n, and
 * another fixer's uncommitted WIP currently leaves src/i18n/en.ts with a
 * syntax error (their edit, not mine — do not "fix" it here). Run this
 * file once their WIP is committed and green.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { MuseApi, createSession } from "../src/api.js";

const realFetch = globalThis.fetch;

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

describe("legacy cloud api timeouts (round-3 code P3-2)", () => {
  it("MuseApi.request rejects instead of hanging login/workspace calls", async () => {
    const start = Date.now();
    const api = new MuseApi("tok");
    await assert.rejects(api.request("/api/agent", undefined, undefined, { timeoutMs: 80 }));
    assert.ok(Date.now() - start < 5000, "must settle within the budget, not hang");
  });

  it("createSession rejects instead of hanging", async () => {
    const start = Date.now();
    await assert.rejects(createSession("key", { timeoutMs: 80 }));
    assert.ok(Date.now() - start < 5000, "must settle within the budget, not hang");
  });

  it("MuseApi.request still resolves on a healthy server", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;
    const api = new MuseApi("tok");
    const out = await api.request<{ ok: boolean }>("/api/agent", undefined, undefined, {
      timeoutMs: 5000,
    });
    assert.equal(out.ok, true);
  });
});
