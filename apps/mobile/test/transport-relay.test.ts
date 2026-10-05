import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { RelaySshTransport } from "../src/sandbox/transport-relay.js";
import type { SshConfig } from "../src/sandbox/types.js";

const SECRET =
  "-----BEGIN OPENSSH PRIVATE KEY-----\ntest-secret-key-material\n-----END OPENSSH PRIVATE KEY-----\n";
const CONFIG: SshConfig = {
  host: "example.com",
  port: 22,
  username: "root",
  authType: "key",
  privateKey: SECRET,
  password: null,
};

interface StubInit {
  body?: unknown;
}

type Handler = (url: string, init?: StubInit) => Promise<{ status: number; body: unknown }>;

const realFetch = globalThis.fetch;

function stubFetch(handler: Handler) {
  const calls: { url: string; init?: StubInit }[] = [];
  (globalThis as { fetch: unknown }).fetch = async (url: string, init?: StubInit) => {
    calls.push({ url, init });
    const r = await handler(url, init);
    return {
      status: r.status,
      text: async () => JSON.stringify(r.body),
    };
  };
  return calls;
}

function parseBody(init?: StubInit): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

function okExec(body: Record<string, unknown> = {}) {
  return {
    status: 200,
    body: { stdout: "out", stderr: "", exitCode: 0, durationMs: 7, ...body },
  };
}

beforeEach(() => {});
afterEach(() => {
  (globalThis as { fetch: unknown }).fetch = realFetch;
});

describe("RelaySshTransport", () => {
  it("connect() probes with a real exec and marks connected", async () => {
    const calls = stubFetch(async (url) => {
      assert.match(url, /^https:\/\/example\.com\/dudu-sandbox\/exec$/);
      return okExec();
    });
    const t = new RelaySshTransport();
    assert.equal(t.isConnected(), false);
    await t.connect(CONFIG);
    assert.equal(t.isConnected(), true);
    assert.equal(calls.length, 1);
    // credentials travel in the POST body, never in the URL
    assert.doesNotMatch(calls[0].url, /test-secret-key-material/);
    const sent = parseBody(calls[0].init);
    assert.equal(sent.username, "root");
    assert.equal(sent.privateKey, SECRET);
    assert.equal(sent.command, "true");
  });

  it("connect() throws when the probe fails; stays disconnected", async () => {
    stubFetch(async () => okExec({ exitCode: 255, stderr: "Permission denied" }));
    const t = new RelaySshTransport();
    await assert.rejects(() => t.connect(CONFIG), /probeFailed/);
    assert.equal(t.isConnected(), false);
  });

  it("connect() throws on unreachable relay", async () => {
    stubFetch(async () => {
      throw new Error("fetch failed");
    });
    const t = new RelaySshTransport();
    await assert.rejects(() => t.connect(CONFIG), /unreachable/);
    assert.equal(t.isConnected(), false);
  });

  it("connect() rejects a hostile host value", async () => {
    stubFetch(async () => okExec());
    const t = new RelaySshTransport();
    await assert.rejects(() => t.connect({ ...CONFIG, host: "evil.com/x" }), /badHost/);
  });

  it("exec() maps stdout/stderr/exitCode/durationMs", async () => {
    const calls = stubFetch(async (url, init) => {
      if (url.endsWith("/exec") && parseBody(init).command === "true") return okExec();
      if (url.endsWith("/exec"))
        return okExec({ stdout: "hello", stderr: "warn", exitCode: 3, durationMs: 42 });
      return okExec();
    });
    const t = new RelaySshTransport();
    await t.connect(CONFIG);
    const r = await t.exec("echo hello");
    assert.deepEqual(
      { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, durationMs: r.durationMs },
      { stdout: "hello", stderr: "warn", exitCode: 3, durationMs: 42 },
    );
    const execCall = calls.find((c) => parseBody(c.init).command === "echo hello");
    assert.ok(execCall, "command sent in body");
  });

  it("exec() surfaces relay errors without leaking the secret", async () => {
    stubFetch(async (url, init) => {
      if (!url.endsWith("/exec")) return okExec();
      const cmd = parseBody(init).command;
      if (cmd === "true") return okExec(); // connect probe
      return { status: 500, body: { error: "boom" } };
    });
    const t = new RelaySshTransport();
    await t.connect(CONFIG);
    await assert.rejects(
      () => t.exec("x"),
      (e: Error) => {
        assert.match(e.message, /boom/);
        assert.doesNotMatch(e.message, /test-secret-key-material/);
        return true;
      },
    );
  });

  it("exec() without connect throws notConnected", async () => {
    stubFetch(async () => okExec());
    const t = new RelaySshTransport();
    await assert.rejects(() => t.exec("x"), /notConnected/);
  });

  it("shell() full lifecycle: open -> poll chunks -> write -> close stops polling", async () => {
    let polls = 0;
    const calls = stubFetch(async (url) => {
      if (url.endsWith("/shell/open")) return { status: 200, body: { shellId: "s1" } };
      if (url.includes("/poll")) {
        polls++;
        if (polls === 1) {
          return {
            status: 200,
            body: {
              chunks: [
                { seq: 1, stream: "stdout", data: "hello " },
                { seq: 2, stream: "stdout", data: "world\n" },
              ],
              cursor: 2,
              closed: false,
            },
          };
        }
        return { status: 200, body: { chunks: [], cursor: 2, closed: false } };
      }
      return okExec();
    });
    const t = new RelaySshTransport("http://127.0.0.1:9/x");
    await t.connect(CONFIG);
    const seen: string[] = [];
    const handle = await t.shell((c) => seen.push(c.data));
    await new Promise((r) => setTimeout(r, 80));
    assert.deepEqual(seen, ["hello ", "world\n"]);

    handle.write("ls\n");
    await new Promise((r) => setTimeout(r, 30));
    const writeCall = calls.find((c) => c.url.includes("/write"));
    assert.ok(writeCall, "write POSTed");
    assert.deepEqual(parseBody(writeCall.init), { data: "ls\n" });

    const before = calls.length;
    handle.close();
    await new Promise((r) => setTimeout(r, 80));
    const closeCall = calls.find((c) => c.url.includes("/close"));
    assert.ok(closeCall, "close POSTed");
    // polling stopped: at most the in-flight close + no new polls
    const after = calls.filter((c) => c.url.includes("/poll")).length;
    await new Promise((r) => setTimeout(r, 80));
    const after2 = calls.filter((c) => c.url.includes("/poll")).length;
    assert.equal(after2, after, "no new polls after close");
    assert.ok(after <= before + 2);
  });

  it("shell() maps stderr chunks to the stderr stream", async () => {
    stubFetch(async (url) => {
      if (url.endsWith("/shell/open")) return { status: 200, body: { shellId: "s9" } };
      if (url.includes("/poll"))
        return {
          status: 200,
          body: { chunks: [{ seq: 1, stream: "stderr", data: "oops" }], cursor: 1, closed: true },
        };
      return okExec();
    });
    const t = new RelaySshTransport("http://127.0.0.1:9/x");
    await t.connect(CONFIG);
    const seen: { stream: string; data: string }[] = [];
    await t.shell((c) => seen.push({ stream: c.stream, data: c.data }));
    await new Promise((r) => setTimeout(r, 80));
    assert.deepEqual(seen, [{ stream: "stderr", data: "oops" }]);
  });

  it("disconnect() wipes connected state and closes remote shells", async () => {
    const calls = stubFetch(async (url) => {
      if (url.endsWith("/shell/open")) return { status: 200, body: { shellId: "s2" } };
      if (url.includes("/poll"))
        return { status: 200, body: { chunks: [], cursor: 0, closed: false } };
      return okExec();
    });
    const t = new RelaySshTransport("http://127.0.0.1:9/x");
    await t.connect(CONFIG);
    await t.shell(() => {});
    await t.disconnect();
    assert.equal(t.isConnected(), false);
    assert.ok(
      calls.some((c) => c.url.includes("/shell/s2/close")),
      "remote shell closed",
    );
    await assert.rejects(() => t.exec("x"), /notConnected/);
  });
});
