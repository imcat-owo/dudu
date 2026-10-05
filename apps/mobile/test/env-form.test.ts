/**
 * D15: env var card — envStore round-trip, ask_env_form tool e2e,
 * dialog isolation, honest cancel, D37 message, blocklists.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { isBlockedInIncognito } from "../src/api-groups/incognito-guard.js";
import { manualIds } from "../src/manuals/index.js";
import { createEnvStore, envStore, type SecureBackend } from "../src/mcp/env.js";
import {
  __pendingEnvFormCount,
  answerEnvFormRequest,
  cancelEnvFormRequest,
  createEnvFormTools,
  requestEnvForm,
  subscribeEnvFormRequest,
} from "../src/mcp/env-form.js";

function fakeSecure(): SecureBackend & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => void map.set(k, v),
    deleteItem: async (k) => void map.delete(k),
  };
}

describe("envStore round-trip (D15)", () => {
  it("set → listNames → getValues → remove, values never in the names list", async () => {
    const store = createEnvStore(fakeSecure());
    await store.set("MY_API_KEY", "s3cr3t-value");
    const names = await store.listNames();
    assert.deepEqual(names, ["MY_API_KEY"]);
    assert.ok(!names.join(",").includes("s3cr3t-value"));
    const values = await store.getValues();
    assert.equal(values.MY_API_KEY, "s3cr3t-value");
    await store.remove("MY_API_KEY");
    assert.deepEqual(await store.listNames(), []);
  });

  it("remove also deletes the __META companion", async () => {
    const sb = fakeSecure();
    const store = createEnvStore(sb);
    await store.set("K1", "v1");
    await store.set("K1__META", JSON.stringify({ account: "a", note: "n" }));
    await store.remove("K1");
    assert.equal(sb.map.get("dudu.env-value.K1__META"), undefined);
    assert.deepEqual(await store.listNames(), []);
  });

  it("getMeta returns companion metadata, null when absent", async () => {
    const store = createEnvStore(fakeSecure());
    assert.equal(await store.getMeta("NOPE"), null);
    await store.set("K2", "v2");
    await store.set("K2__META", JSON.stringify({ account: "me", note: "test key" }));
    const meta = await store.getMeta("K2");
    assert.equal(meta?.account, "me");
    assert.equal(meta?.note, "test key");
  });
});

describe("ask_env_form tool (D15)", () => {
  it("has a legal manualId", () => {
    const [tool] = createEnvFormTools({ threadId: "t1" });
    assert.equal(tool.name, "ask_env_form");
    assert.ok(tool.manualId && manualIds().includes(tool.manualId));
  });

  it("end-to-end: she submits the form → secret stored, model never sees the value", async () => {
    const mem = new Map<string, string>();
    const origSet = envStore.set;
    envStore.set = (async (name: string, value: string) => {
      mem.set(name, value);
    }) as typeof envStore.set;
    try {
      const [tool] = createEnvFormTools({ threadId: "t1" });
      const runP = tool.run({ varName: "tavily_api_key", reason: "need search" }, {} as never);
      // Simulate her submitting the card in the UI.
      const seen = subscribeEnvFormRequest(() => {});
      assert.equal(__pendingEnvFormCount(), 1);
      seen();
      // Find the pending request id via answering with wrong id first.
      assert.equal(answerEnvFormRequest("nope", {} as never), false);
      // Answer the real one: grab it from the subscription.
      let reqId = "";
      const unsub = subscribeEnvFormRequest((req) => {
        if (req) reqId = req.id;
      });
      unsub();
      assert.ok(reqId);
      assert.equal(
        answerEnvFormRequest(reqId, {
          name: "tavily_api_key",
          account: "me@example.com",
          secret: "tvly-super-secret",
          note: "search key",
          url: "https://tavily.com",
        }),
        true,
      );
      const out = JSON.parse(String(await runP));
      assert.equal(out.stored, "TAVILY_API_KEY");
      assert.ok(!JSON.stringify(out).includes("tvly-super-secret"));
      assert.equal(mem.get("TAVILY_API_KEY"), "tvly-super-secret");
      const metaRaw = mem.get("TAVILY_API_KEY__META");
      assert.ok(metaRaw);
      const meta = JSON.parse(metaRaw);
      assert.equal(meta.account, "me@example.com");
      assert.equal(meta.note, "search key");
      assert.equal(meta.url, "https://tavily.com");
      assert.equal(__pendingEnvFormCount(), 0);
    } finally {
      envStore.set = origSet;
    }
  });

  it("rejects missing varName / reason honestly", async () => {
    const [tool] = createEnvFormTools({ threadId: "t1" });
    await assert.rejects(() => tool.run({ reason: "x" }, {} as never), /varName/);
    await assert.rejects(() => tool.run({ varName: "K" }, {} as never), /reason/);
    assert.equal(__pendingEnvFormCount(), 0);
  });

  it("empty secret on the form fails validation, nothing stored", async () => {
    const mem = new Map<string, string>();
    const origSet = envStore.set;
    envStore.set = (async (name: string, value: string) => {
      mem.set(name, value);
    }) as typeof envStore.set;
    try {
      const [tool] = createEnvFormTools({ threadId: "t1" });
      const runP = tool.run({ varName: "K3", reason: "r" }, {} as never);
      let reqId = "";
      const unsub = subscribeEnvFormRequest((req) => {
        if (req) reqId = req.id;
      });
      unsub();
      answerEnvFormRequest(reqId, {
        name: "K3",
        account: "a",
        secret: "",
        note: "n",
      });
      await assert.rejects(() => runP, /secret is required/);
      assert.equal(mem.size, 0);
    } finally {
      envStore.set = origSet;
    }
  });

  it("dialog isolation: a request in dialog A never surfaces in dialog B", async () => {
    const seen: string[] = [];
    const unsubB = subscribeEnvFormRequest(
      (req) => {
        if (req) seen.push(req.id);
      },
      { threadId: "dialog-b" },
    );
    const p = requestEnvForm({ threadId: "dialog-a", varName: "K", reason: "r" });
    // Let the emit run.
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(seen, []);
    unsubB();
    // Clean up the still-pending request.
    let reqId = "";
    const unsub = subscribeEnvFormRequest((req) => {
      if (req) reqId = req.id;
    });
    unsub();
    assert.equal(cancelEnvFormRequest(reqId), true);
    await assert.rejects(() => p, /dismissed/);
  });

  it("dismiss is honest — never claims it was saved", async () => {
    const p = requestEnvForm({ threadId: "", varName: "K", reason: "r" });
    let reqId = "";
    const unsub = subscribeEnvFormRequest((req) => {
      if (req) reqId = req.id;
    });
    unsub();
    cancelEnvFormRequest(reqId, "dismissed");
    await assert.rejects(() => p, /dismissed/);
  });
});

describe("D15 wiring", () => {
  it("ask_env_form is blocked in incognito (persistent write)", () => {
    assert.equal(isBlockedInIncognito("ask_env_form"), true);
  });

  it("D37: web_search failure message points at the env settings page", () => {
    const src = readFileSync("src/mcp/web-search.ts", "utf8");
    assert.ok(src.includes("environment variables section"));
    assert.ok(!src.includes("no in-app settings page"));
  });
});
