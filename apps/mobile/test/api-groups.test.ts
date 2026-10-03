import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createSseParser,
  GroupError,
  parseSseData,
  parseSseThinking,
  streamChat,
} from "../src/api-groups/direct-transport.js";
import { createGroupStore, type SecureBackend } from "../src/api-groups/store.js";
import {
  type ApiGroup,
  blankGroup,
  normalizeBaseUrl,
  validateGroup,
} from "../src/api-groups/types.js";

function fakeSecure(): SecureBackend & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => {
      data.set(k, v);
    },
    deleteItem: async (k) => {
      data.delete(k);
    },
  };
}

function sampleGroup(over: Partial<ApiGroup> = {}): ApiGroup {
  return {
    id: "g_test1",
    name: "主力",
    vendor: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-test",
    model: "gpt-4o-mini",
    headers: {},
    createdAt: 1,
    ...over,
  };
}

describe("validateGroup", () => {
  it("accepts a complete group", () => {
    assert.equal(validateGroup(sampleGroup()), null);
  });
  it("rejects missing name / url / model in order; key is optional", () => {
    assert.equal(validateGroup(sampleGroup({ name: " " })), "nameRequired");
    assert.equal(validateGroup(sampleGroup({ baseUrl: "" })), "baseUrlRequired");
    assert.equal(validateGroup(sampleGroup({ baseUrl: "not-a-url" })), "baseUrlInvalid");
    assert.equal(validateGroup(sampleGroup({ model: "  " })), "modelRequired");
  });
  it("accepts a keyless group (Ollama-style local endpoint)", () => {
    assert.equal(validateGroup(sampleGroup({ apiKey: "" })), null);
    assert.equal(validateGroup(sampleGroup({ apiKey: undefined })), null);
  });
  it("normalizeBaseUrl strips trailing slashes", () => {
    assert.equal(normalizeBaseUrl("https://x.com/v1///"), "https://x.com/v1");
  });
  it("blankGroup fills the vendor preset url", () => {
    assert.equal(blankGroup("openai").baseUrl, "https://api.openai.com/v1");
    assert.equal(blankGroup("custom").baseUrl, "");
  });
});

describe("parseSseData", () => {
  it("extracts the text delta", () => {
    const delta = parseSseData("g", JSON.stringify({ choices: [{ delta: { content: "hello" } }] }));
    assert.equal(delta, "hello");
  });
  it("returns null for [DONE] and non-data frames", () => {
    assert.equal(parseSseData("g", "[DONE]"), null);
    assert.equal(parseSseData("g", JSON.stringify({ choices: [{ delta: {} }] })), null);
  });
  it("throws GroupError naming the group on API errors", () => {
    assert.throws(
      () => parseSseData("主力", JSON.stringify({ error: { message: "bad key" } })),
      (e: unknown) =>
        e instanceof GroupError && e.groupName === "主力" && /bad key/.test(e.message),
    );
  });
});

describe("createSseParser", () => {
  it("emits deltas across chunk boundaries", () => {
    const deltas: string[] = [];
    const parser = createSseParser("g", (d) => deltas.push(d));
    const line1 = `data: ${JSON.stringify({ choices: [{ delta: { content: "hel" } }] })}\n`;
    const line2 = `data: ${JSON.stringify({ choices: [{ delta: { content: "lo" } }] })}\n`;
    parser.push(line1.slice(0, 10)); // split mid-line
    parser.push(line1.slice(10) + line2);
    parser.push("data: [DONE]\n");
    assert.deepEqual(deltas, ["hel", "lo"]);
  });
  it("ignores non-data lines", () => {
    const deltas: string[] = [];
    const parser = createSseParser("g", (d) => deltas.push(d));
    parser.push(": keep-alive\n\ndata: [DONE]\n\n");
    assert.deepEqual(deltas, []);
  });
});

describe("createGroupStore", () => {
  it("upsert/remove/setActive round-trip with a fake backend", async () => {
    const secure = fakeSecure();
    const store = createGroupStore(secure);
    await store.upsert(sampleGroup());
    await store.upsert(sampleGroup({ id: "g_test2", name: "备用" }));
    let snap = store.getSnapshot();
    assert.equal(snap.groups.length, 2);
    // First group becomes active automatically.
    assert.equal(snap.activeId, "g_test1");

    await store.setActive("g_test2");
    assert.equal(store.getSnapshot().activeId, "g_test2");

    await store.remove("g_test2");
    snap = store.getSnapshot();
    assert.equal(snap.groups.length, 1);
    assert.equal(snap.activeId, "g_test1"); // falls back to the survivor

    // Secrets went to the secure backend only.
    const stored = secure.data.get("openmuse.api-groups.v1") ?? "";
    assert.ok(stored.includes("sk-test"), "key persisted in secure backend");
  });

  it("editing a group keeps its id and secrets", async () => {
    const store = createGroupStore(fakeSecure());
    await store.upsert(sampleGroup());
    await store.upsert(sampleGroup({ model: "gpt-4o" }));
    const snap = store.getSnapshot();
    assert.equal(snap.groups.length, 1);
    assert.equal(snap.groups[0].model, "gpt-4o");
    assert.equal(snap.groups[0].apiKey, "sk-test");
  });

  it("corrupt JSON parses to an empty list, never throws", async () => {
    const secure = fakeSecure();
    secure.data.set("openmuse.api-groups.v1", "not json{{{");
    const store = createGroupStore(secure);
    // ensureLoaded runs on creation; give it a tick.
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(store.getSnapshot().groups, []);
  });

  it("refresh() picks up externally changed storage (backup restore)", async () => {
    const secure = fakeSecure();
    const store = createGroupStore(secure);
    await store.upsert(sampleGroup());
    assert.equal(store.getSnapshot().groups.length, 1);
    // Simulate applyBackup writing directly to the backend behind the store's back.
    secure.data.set(
      "openmuse.api-groups.v1",
      JSON.stringify([sampleGroup({ id: "g_new", name: "restored", apiKey: "" })]),
    );
    assert.equal(store.getSnapshot().groups.length, 1, "stale mirror before refresh");
    assert.equal(store.getSnapshot().groups[0].id, "g_test1");
    await store.refresh();
    const snap = store.getSnapshot();
    assert.equal(snap.groups.length, 1);
    assert.equal(snap.groups[0].id, "g_new");
    assert.equal(snap.groups[0].name, "restored");
  });
});

describe("streamChat 8s fallback (P0: promise must settle)", () => {
  // Fake XHR that never fires any event — simulates a server that accepts
  // the request but never streams, triggering the 8s fallback path.
  class SilentXHR {
    onprogress: (() => void) | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    timeout = 0;
    responseText = "";
    status = 200;
    open() {}
    setRequestHeader() {}
    send() {
      /* silent: no events ever */
    }
    abort() {}
  }

  function stubGlobals(
    fetchImpl: () => Promise<{ ok: boolean; status?: number; text: () => Promise<string> }>,
  ) {
    const g = globalThis as Record<string, unknown>;
    const saved = {
      xhr: g.XMLHttpRequest,
      fetch: g.fetch,
      setTimeout: g.setTimeout,
      clearTimeout: g.clearTimeout,
    };
    const timers: Array<{ cb: () => void; ms: number }> = [];
    g.XMLHttpRequest = SilentXHR;
    g.fetch = fetchImpl;
    g.setTimeout = ((cb: () => void, ms?: number) => {
      timers.push({ cb, ms: ms ?? 0 });
      return timers.length;
    }) as typeof setTimeout;
    g.clearTimeout = (() => {}) as typeof clearTimeout;
    return {
      timers,
      restore() {
        g.XMLHttpRequest = saved.xhr;
        g.fetch = saved.fetch;
        g.setTimeout = saved.setTimeout;
        g.clearTimeout = saved.clearTimeout;
      },
    };
  }

  function fireFallback(timers: Array<{ cb: () => void; ms: number }>) {
    const t = timers.find((x) => x.ms === 8000);
    assert.ok(t, "8s fallback timer must be scheduled");
    t!.cb();
  }

  it("resolves via fallback when XHR never streams (fallback success)", async () => {
    const { timers, restore } = stubGlobals(async () => ({
      ok: true,
      text: async () => JSON.stringify({ choices: [{ message: { content: "fallback hello" } }] }),
    }));
    try {
      const tokens: string[] = [];
      let done = false;
      let err: unknown = null;
      const p = streamChat(sampleGroup(), [{ role: "user", content: "hi" }], {
        onToken: (t) => tokens.push(t),
        onDone: () => {
          done = true;
        },
        onError: (e) => {
          err = e;
        },
      });
      fireFallback(timers);
      await p; // must resolve — used to hang forever (P0)
      assert.equal(err, null);
      assert.equal(done, true);
      assert.deepEqual(tokens, ["fallback hello"]);
    } finally {
      restore();
    }
  });

  it("rejects via fallback when the fallback fetch fails", async () => {
    const { timers, restore } = stubGlobals(async () => {
      throw new Error("connection refused");
    });
    try {
      let done = false;
      let err: unknown = null;
      const p = streamChat(sampleGroup(), [{ role: "user", content: "hi" }], {
        onToken: () => {},
        onDone: () => {
          done = true;
        },
        onError: (e) => {
          err = e;
        },
      });
      fireFallback(timers);
      await assert.rejects(p, /connection refused/); // must reject — used to hang forever (P0)
      assert.equal(done, false);
      assert.ok(err instanceof Error);
    } finally {
      restore();
    }
  });
});

describe("parseSseThinking", () => {
  it("extracts reasoning_content deltas (OpenAI-compatible)", () => {
    const thinking = parseSseThinking(
      JSON.stringify({ choices: [{ delta: { reasoning_content: "let me think" } }] }),
    );
    assert.equal(thinking, "let me think");
  });
  it("extracts thinking deltas (Anthropic-mapped proxies)", () => {
    const thinking = parseSseThinking(
      JSON.stringify({ choices: [{ delta: { thinking: "hmm" } }] }),
    );
    assert.equal(thinking, "hmm");
  });
  it("returns null for [DONE], content-only deltas, and malformed JSON", () => {
    assert.equal(parseSseThinking("[DONE]"), null);
    assert.equal(
      parseSseThinking(JSON.stringify({ choices: [{ delta: { content: "hi" } }] })),
      null,
    );
    assert.equal(parseSseThinking("not json{{{"), null);
  });
  it("never throws on error payloads — thinking is best-effort", () => {
    assert.equal(parseSseThinking(JSON.stringify({ error: { message: "bad key" } })), null);
  });
});

describe("createSseParser thinking", () => {
  it("emits thinking deltas alongside content deltas", () => {
    const tokens: string[] = [];
    const thinkings: string[] = [];
    const parser = createSseParser(
      "g",
      (d) => tokens.push(d),
      (d) => thinkings.push(d),
    );
    parser.push(
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "step1" } }] })}\n` +
        `data: ${JSON.stringify({ choices: [{ delta: { content: "hi" } }] })}\n` +
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "step2" } }] })}\n`,
    );
    assert.deepEqual(tokens, ["hi"]);
    assert.deepEqual(thinkings, ["step1", "step2"]);
  });
  it("works without an onThinking callback (backward compatible)", () => {
    const tokens: string[] = [];
    const parser = createSseParser("g", (d) => tokens.push(d));
    parser.push(
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "x", content: "y" } }] })}\n`,
    );
    assert.deepEqual(tokens, ["y"]);
  });
});
