/**
 * D36/D37/D43 — honest web_search + honest MCP provider errors.
 *
 * D36: no silent provider fallback — the model always learns WHICH backend
 * served the results and what happened with the others; DuckDuckGo
 * anti-scraping throws instead of a confident "No results found."
 * D37: the all-failed error no longer points her at a settings page that
 * doesn't exist.
 * D43: a broken MCP server leaves a placeholder tool carrying the honest
 * reason instead of its tools silently vanishing.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { envStore } from "../src/mcp/env";
import { listMcpToolsWithHonestErrors } from "../src/mcp/provider";
import { __searchProviders, createWebSearchTools } from "../src/mcp/web-search";

const realFetch = globalThis.fetch;

function withEnv(values: Record<string, string>) {
  const orig = envStore.getValues;
  envStore.getValues = async () => values;
  return () => {
    envStore.getValues = orig;
  };
}

function withFetch(handler: (url: unknown, init?: unknown) => Promise<unknown>) {
  (globalThis as { fetch?: unknown }).fetch = handler;
  return () => {
    globalThis.fetch = realFetch;
  };
}

const okJson = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

describe("D36 — web_search provenance", () => {
  it("bad key on first provider falls through; result names the serving backend and the failure", async () => {
    const restoreEnv = withEnv({ TAVILY_API_KEY: "bad-key", BRAVE_API_KEY: "good-key" });
    const restoreFetch = withFetch(async (url) => {
      const u = String(url);
      if (u.includes("tavily")) return { ok: false, status: 401, json: async () => ({}) };
      if (u.includes("brave")) {
        return okJson({
          web: { results: [{ title: "T", url: "https://x.test", description: "D" }] },
        });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    try {
      const tools = createWebSearchTools();
      const out = await tools[0].run({ query: "hello" }, {} as never);
      assert.ok(out.startsWith("via: brave"), `missing provenance header, got:\n${out}`);
      assert.ok(
        out.includes("tavily failed (Tavily HTTP 401)"),
        `bad-key failure not reported, got:\n${out}`,
      );
      assert.ok(out.includes("https://x.test"), "results missing");
    } finally {
      restoreFetch();
      restoreEnv();
    }
  });

  it("DuckDuckGo captcha page throws anti-scraping error instead of empty results", async () => {
    const restoreFetch = withFetch(async () => ({
      ok: true,
      status: 200,
      text: async () => '<html><div class="anomaly-modal">captcha</div></html>',
    }));
    try {
      await assert.rejects(
        () => __searchProviders.searchDuckDuckGo("hello"),
        /anti-scraping/,
        "captcha page should throw, not return zero results",
      );
    } finally {
      restoreFetch();
    }
  });

  it("DuckDuckGo empty scrape is a provider failure, never a confident 'No results found'", async () => {
    const restoreEnv = withEnv({});
    const restoreFetch = withFetch(async () => ({
      ok: true,
      status: 200,
      text: async () => "<html><body>nothing parseable here</body></html>",
    }));
    try {
      const tools = createWebSearchTools({ providerOrder: ["duckduckgo"] });
      await assert.rejects(
        () => tools[0].run({ query: "hello" }, {} as never),
        /likely anti-scraping/,
        "empty DDG scrape must surface as a failure",
      );
    } finally {
      restoreFetch();
      restoreEnv();
    }
  });

  it("a real API returning zero results is an honest empty answer with provenance", async () => {
    const restoreEnv = withEnv({ BRAVE_API_KEY: "k" });
    const restoreFetch = withFetch(async () => okJson({ web: { results: [] } }));
    try {
      const tools = createWebSearchTools({ providerOrder: ["brave"] });
      const out = await tools[0].run({ query: "zzz-no-such-thing" }, {} as never);
      assert.ok(out.startsWith("via: brave"), `missing provenance, got:\n${out}`);
      assert.ok(out.includes("No results found."), `expected honest empty, got:\n${out}`);
    } finally {
      restoreFetch();
      restoreEnv();
    }
  });
});

describe("D37 — failure message points at the real settings page (D15)", () => {
  it("all-failed error lists per-provider reasons and points at the env section", async () => {
    const restoreEnv = withEnv({});
    const restoreFetch = withFetch(async () => {
      throw new Error("fetch should not be called with no keys");
    });
    try {
      const tools = createWebSearchTools({ providerOrder: ["tavily", "serper"] });
      let msg = "";
      try {
        await tools[0].run({ query: "hello" }, {} as never);
        assert.fail("should have thrown");
      } catch (e) {
        msg = (e as Error).message;
      }
      assert.ok(msg.includes("tavily: skipped (no API key configured)"), `got: ${msg}`);
      assert.ok(msg.includes("serper: skipped (no API key configured)"), `got: ${msg}`);
      assert.ok(
        !msg.includes("Set a search API key in env vars"),
        `stale pointer still present: ${msg}`,
      );
      assert.ok(
        msg.includes("environment variables section"),
        `must point at the D15 env settings page: ${msg}`,
      );
    } finally {
      restoreFetch();
      restoreEnv();
    }
  });
});

describe("D43 — broken MCP server leaves an honest placeholder", () => {
  const goodTool = {
    name: "mcp__good__ping",
    description: "ping",
    parameters: { type: "object" as const, properties: {}, additionalProperties: false },
    run: async () => "pong",
  };

  it("failed provider yields a placeholder carrying the real reason; good providers unaffected", async () => {
    const tools = await listMcpToolsWithHonestErrors([
      { providerId: "mcp:good", listTools: async () => [goodTool] },
      {
        providerId: "mcp:broken",
        listTools: async () => {
          throw new Error('MCP server "broken" needs OAuth authorization.');
        },
      },
    ]);
    assert.equal(tools.length, 2);
    assert.equal(tools[0].name, "mcp__good__ping");
    const placeholder = tools[1];
    assert.equal(placeholder.name, "mcp__broken__unavailable");
    assert.ok(
      placeholder.description.includes("needs OAuth authorization"),
      `honest reason missing: ${placeholder.description}`,
    );
    assert.ok(
      placeholder.description.includes("UNAVAILABLE") &&
        !placeholder.description.toLowerCase().includes("no such server"),
      "must say unavailable, not pretend the server is gone",
    );
    await assert.rejects(() => placeholder.run({}, {} as never), /unavailable/);
  });

  it("healthy providers produce no placeholders", async () => {
    const tools = await listMcpToolsWithHonestErrors([
      { providerId: "mcp:good", listTools: async () => [goodTool] },
    ]);
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, "mcp__good__ping");
  });
});
