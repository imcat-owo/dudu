/**
 * Intelligent API auto-adaptation — pure logic tests.
 * No React Native imports; error-classifier, capability-probe (with
 * injected fetch), and model-profiles (with injected backend) only.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type ProbeFetch,
  probeCapabilities,
  probeThinking,
  probeTools,
} from "../src/api-groups/capability-probe.js";
import { classifyError } from "../src/api-groups/error-classifier.js";
import { blankProfile, createProfileStore, profileKey } from "../src/api-groups/model-profiles.js";
import type { ApiGroup } from "../src/api-groups/types.js";

function group(): ApiGroup {
  return {
    id: "g1",
    name: "test",
    vendor: "custom",
    baseUrl: "https://api.example.com/v1",
    apiKey: "k",
    model: "m",
    headers: {},
    createdAt: 0,
  };
}

function fakeFetch(ok: boolean, status = 200, text = "{}"): ProbeFetch {
  return async () => ({
    ok,
    status,
    text: async () => text,
  });
}

describe("classifyError", () => {
  it("classifies tool-unsupported errors", () => {
    assert.equal(
      classifyError(new Error("HTTP 400: tools are not supported by this model")),
      "tools_unsupported",
    );
    assert.equal(
      classifyError(new Error("function calling is not available for this model")),
      "tools_unsupported",
    );
  });
  it("classifies thinking-unsupported errors", () => {
    assert.equal(
      classifyError(new Error("reasoning is not supported on this endpoint")),
      "thinking_unsupported",
    );
  });
  it("classifies context-too-long errors", () => {
    assert.equal(
      classifyError(new Error("HTTP 400: maximum context length exceeded")),
      "context_too_long",
    );
    assert.equal(
      classifyError(new Error("context_length_exceeded: too many tokens")),
      "context_too_long",
    );
  });
  it("classifies auth errors first (never a capability problem)", () => {
    assert.equal(classifyError(new Error("HTTP 401: invalid api key")), "auth_error");
    assert.equal(classifyError(new Error("HTTP 403: unauthorized")), "auth_error");
  });
  it("classifies rate limits", () => {
    assert.equal(classifyError(new Error("HTTP 429: rate limit exceeded")), "rate_limit");
  });
  it("classifies network errors", () => {
    assert.equal(classifyError(new Error("network error")), "network_error");
    assert.equal(classifyError(new Error("stream stalled (no data for 45s)")), "network_error");
  });
  it("returns unknown for unrecognized shapes (never guesses)", () => {
    assert.equal(classifyError(new Error("something weird happened")), "unknown");
    assert.equal(classifyError(null), "unknown");
  });
});

describe("probeTools", () => {
  it("returns supported on 200", async () => {
    assert.equal(await probeTools(group(), fakeFetch(true)), "supported");
  });
  it("returns unsupported on tools_unsupported-classified failure", async () => {
    assert.equal(
      await probeTools(group(), fakeFetch(false, 400, "tools are not supported")),
      "unsupported",
    );
  });
  it("returns unknown on inconclusive failure (optimistic)", async () => {
    assert.equal(await probeTools(group(), fakeFetch(false, 500, "internal error")), "unknown");
  });
});

describe("probeThinking", () => {
  it("returns supported on 200", async () => {
    assert.equal(await probeThinking(group(), fakeFetch(true)), "supported");
  });
  it("returns unsupported only on thinking_unsupported-classified failure", async () => {
    assert.equal(
      await probeThinking(group(), fakeFetch(false, 400, "reasoning not supported")),
      "unsupported",
    );
    // A generic 400 is NOT proof thinking is unsupported.
    assert.equal(await probeThinking(group(), fakeFetch(false, 400, "bad request")), "unknown");
  });
});

describe("probeCapabilities", () => {
  it("probes independently (one failing never blocks the other)", async () => {
    const g = group();
    const fetch: ProbeFetch = async (_url, init) => {
      const body = JSON.parse(init.body) as { tools?: unknown[] };
      // Tools probe carries tools; thinking probe does not.
      if (body.tools) return { ok: false, status: 400, text: async () => "tools not supported" };
      return { ok: true, status: 200, text: async () => "{}" };
    };
    const caps = await probeCapabilities(g, fetch);
    assert.equal(caps.tools, "unsupported");
    assert.equal(caps.thinking, "supported");
  });
});

describe("model-profiles", () => {
  function memBackend() {
    const data = new Map<string, string>();
    return {
      data,
      getItem: async (k: string) => data.get(k) ?? null,
      setItem: async (k: string, v: string) => {
        data.set(k, v);
      },
    };
  }
  it("profileKey normalizes baseUrl and model", () => {
    assert.equal(
      profileKey("https://API.example.com/v1/", "  MyModel "),
      "https://api.example.com/v1::MyModel",
    );
  });
  it("blankProfile defaults to auto (optimistic ON)", () => {
    const p = blankProfile("https://x.com", "m");
    assert.equal(p.tools, "auto");
    assert.equal(p.thinking, "auto");
  });
  it("learned() records a downgrade and getProfile reads it back", async () => {
    const store = createProfileStore(memBackend());
    await store.learned("https://x.com/v1", "m", { tools: "off" }, "tools proven unsupported");
    const p = await store.getProfile("https://x.com/v1", "m");
    assert.equal(p.tools, "off");
    assert.equal(p.thinking, "auto");
    assert.match(p.note, /proven unsupported/);
  });
  it("resetProfile clears the learned state", async () => {
    const backend = memBackend();
    const store = createProfileStore(backend);
    await store.learned("https://x.com/v1", "m", { tools: "off" }, "n");
    await store.resetProfile("https://x.com/v1", "m");
    const p = await store.getProfile("https://x.com/v1", "m");
    assert.equal(p.tools, "auto");
  });
  it("getProfile returns blank for unknown models (never throws)", async () => {
    const store = createProfileStore(memBackend());
    const p = await store.getProfile("https://nope.com", "ghost");
    assert.equal(p.tools, "auto");
  });
});
