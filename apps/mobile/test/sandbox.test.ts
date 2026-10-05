import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IshSandboxBackend } from "../src/sandbox/backend-ish.js";
import {
  parseDockerPsLine,
  SshDockerBackend,
  shellEscape,
} from "../src/sandbox/backend-ssh-docker.js";
import { SandboxManager } from "../src/sandbox/manager.js";
import { type SshTransport, UnavailableSshTransport } from "../src/sandbox/transport.js";
import type { SandboxCommandResult, SandboxOutputChunk, SshConfig } from "../src/sandbox/types.js";

/** Fake SSH transport with scripted responses. */
function fakeTransport(script: Record<string, SandboxCommandResult>): SshTransport {
  return {
    connect: async () => {},
    disconnect: async () => {},
    isConnected: () => true,
    exec: async (cmd) => {
      const hit = Object.keys(script).find((k) => cmd.startsWith(k));
      if (!hit) return { stdout: "", stderr: `no script for ${cmd}`, exitCode: 1, durationMs: 1 };
      return script[hit];
    },
    shell: async (onChunk) => {
      let closed = false;
      return {
        write: (data: string) => {
          if (closed) return;
          // Simulate docker exec: echo back a fake result + exit marker.
          const m = data.match(/__DUDU_EXIT_(\d+)__/);
          if (m) {
            onChunk({ stream: "stdout", data: "hello\n" });
            onChunk({ stream: "stdout", data: `__DUDU_EXIT_${m[1]}__:0\n` });
          }
        },
        resize: () => {},
        close: () => {
          closed = true;
        },
      };
    },
  };
}

const ok = (stdout: string): SandboxCommandResult => ({
  stdout,
  stderr: "",
  exitCode: 0,
  durationMs: 5,
});

describe("parseDockerPsLine", () => {
  it("parses a docker ps json line", () => {
    const env = parseDockerPsLine(
      '{"ID":"abc123","Names":"web","State":"running","Image":"nginx"}',
    );
    assert.deepEqual(env, { id: "abc123", name: "web", status: "running", image: "nginx" });
  });
  it("returns null for blank / malformed lines", () => {
    assert.equal(parseDockerPsLine(""), null);
    assert.equal(parseDockerPsLine("not json"), null);
    assert.equal(parseDockerPsLine('{"ID":"x"}'), null);
  });
});

describe("shellEscape", () => {
  it("wraps and escapes single quotes", () => {
    assert.equal(shellEscape("abc"), "'abc'");
    assert.equal(shellEscape("a'b"), "'a'\\''b'");
  });
});

describe("SshDockerBackend", () => {
  const config: SshConfig = {
    host: "example.com",
    port: 22,
    username: "root",
    authType: "key",
    privateKey: "PEM",
    password: null,
  };

  it("refuses to connect without config", async () => {
    const b = new SshDockerBackend(fakeTransport({}));
    await assert.rejects(() => b.connect(), /noConfig/);
    assert.equal(b.connectionState(), "error");
  });

  it("reports unavailable when the transport is unavailable", async () => {
    const b = new SshDockerBackend(new UnavailableSshTransport());
    b.setConfig(config);
    await assert.rejects(() => b.connect());
    assert.equal(b.connectionState(), "unavailable");
  });

  it("reset() recovers from error/unavailable without an app restart", async () => {
    // error (no config) -> reset -> disconnected, can retry
    const b = new SshDockerBackend(fakeTransport({}));
    await assert.rejects(() => b.connect(), /noConfig/);
    assert.equal(b.connectionState(), "error");
    b.reset();
    assert.equal(b.connectionState(), "disconnected");
    assert.equal(b.stateDetail(), null);

    // unavailable (no SSH module bundled) -> reset stays honestly unavailable
    const u = new SshDockerBackend(new UnavailableSshTransport());
    u.setConfig(config);
    await assert.rejects(() => u.connect());
    assert.equal(u.connectionState(), "unavailable");
    u.reset();
    assert.equal(u.connectionState(), "unavailable");
    assert.equal(u.stateDetail(), "sandbox.transportUnavailable");
  });

  it("connects and lists containers", async () => {
    const b = new SshDockerBackend(
      fakeTransport({
        "docker info": ok('"24.0"'),
        "docker ps": ok(
          '{"ID":"c1","Names":"web","State":"running","Image":"nginx"}\n{"ID":"c2","Names":"db","State":"exited","Image":"postgres"}\n',
        ),
      }),
    );
    b.setConfig(config);
    await b.connect();
    assert.equal(b.connectionState(), "connected");
    const envs = await b.listEnvironments();
    assert.equal(envs.length, 2);
    assert.equal(envs[0].name, "web");
    assert.equal(envs[1].status, "exited");
  });

  it("refuses operations when not connected", async () => {
    const b = new SshDockerBackend(fakeTransport({}));
    await assert.rejects(() => b.listEnvironments(), /notConnected/);
  });

  it("streams command output and parses the exit marker", async () => {
    const b = new SshDockerBackend(fakeTransport({ "docker info": ok("x") }));
    b.setConfig(config);
    await b.connect();
    const chunks: SandboxOutputChunk[] = [];
    const r = await b.runCommand("c1", "echo hello", (c) => chunks.push(c));
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes("hello"));
    assert.ok(!r.stdout.includes("__DUDU_EXIT_"));
    assert.ok(chunks.length > 0);
  });

  it("start/stop shell-escape the container id", async () => {
    const seen: string[] = [];
    const t = fakeTransport({});
    const origExec = t.exec;
    t.exec = async (cmd) => {
      seen.push(cmd);
      return ok("");
    };
    void origExec;
    const b = new SshDockerBackend(t);
    b.setConfig(config);
    // connect needs docker info; patch via shell transport is enough for start/stop test
    (b as unknown as { state: string }).state = "connected";
    await b.startEnvironment("c1'; rm -rf /; echo '");
    assert.ok(seen[0].includes("'c1'\\''; rm -rf /; echo '\\''"), seen[0]);
  });
});

describe("IshSandboxBackend", () => {
  it("reports unavailable without a native module (honest, no fake)", async () => {
    const b = new IshSandboxBackend(null);
    assert.equal(b.connectionState(), "unavailable");
    await assert.rejects(() => b.connect(), /nativeRequired/);
    await assert.rejects(() => b.listEnvironments(), /notConnected/);
  });

  it("reset() recovers from error without an app restart", async () => {
    const b = new IshSandboxBackend(null);
    await assert.rejects(() => b.connect(), /nativeRequired/);
    assert.equal(b.connectionState(), "unavailable");
    // No native module in this environment -> stays honestly unavailable,
    // but the call must not throw and the detail must stay accurate.
    b.reset();
    assert.equal(b.connectionState(), "unavailable");
    assert.equal(b.stateDetail(), "sandbox.local.nativeRequired");
  });

  it("works against an injected native module", async () => {
    const native = {
      boot: async () => {},
      isBooted: () => true,
      executeCommandAndWait: async (
        _cmd: string,
        _t: number,
        onOutput: (s: "stdout" | "stderr", d: string) => void,
      ) => {
        onOutput("stdout", "hi\n");
        return { exitCode: 0, durationMs: 3 };
      },
      shutdown: async () => {},
    };
    const b = new IshSandboxBackend(native);
    await b.connect();
    assert.equal(b.connectionState(), "connected");
    const envs = await b.listEnvironments();
    assert.equal(envs.length, 1);
    assert.equal(envs[0].id, "alpine");
    const r = await b.runCommand("alpine", "echo hi");
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes("hi"));
  });
});

describe("SandboxManager", () => {
  it("defaults to cloud, switches backends, persists selection", async () => {
    const prefs = new Map<string, string>();
    const m = SandboxManager.forTest({
      prefs: {
        getItem: async (k) => prefs.get(k) ?? null,
        setItem: async (k, v) => {
          prefs.set(k, v);
        },
      },
      secure: {
        getItem: async () => null,
        setItem: async () => {},
        deleteItem: async () => {},
      },
    });
    await m.init();
    assert.equal(m.activeBackendId(), "cloud");
    await m.setActiveBackend("local");
    assert.equal(m.activeBackendId(), "local");
    assert.equal(m.activeBackend().id, "local");
  });

  it("saves servers to SecureStore and tracks the active one", async () => {
    const store = new Map<string, string>();
    const m = SandboxManager.forTest({
      secure: {
        getItem: async (k) => store.get(k) ?? null,
        setItem: async (k, v) => {
          store.set(k, v);
        },
        deleteItem: async (k) => {
          store.delete(k);
        },
      },
    });
    await m.init();
    assert.equal(m.activeServer(), null);
    await m.saveServer({
      id: "srv-1",
      name: "主力机",
      config: {
        host: "h",
        port: 22,
        username: "u",
        authType: "password",
        privateKey: null,
        password: "p",
      },
    });
    assert.equal(m.activeServer()?.name, "主力机");
    assert.ok(store.has("dudu.sandbox.servers.v1"));
    // password must be in the secure store, and the key must mention nothing else
    assert.ok(store.get("dudu.sandbox.servers.v1")!.includes('"password":"p"'));
    await m.deleteServer("srv-1");
    assert.equal(m.activeServer(), null);
  });

  it("migrates the legacy single-server config into the server list", async () => {
    const store = new Map<string, string>([
      [
        "dudu.sandbox.sshConfig.v1",
        JSON.stringify({
          host: "legacy.example.com",
          port: 22,
          username: "root",
          authType: "key",
          privateKey: "PEM",
          password: null,
        }),
      ],
    ]);
    const secure = {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => {
        store.set(k, v);
      },
      deleteItem: async (k: string) => {
        store.delete(k);
      },
    };
    const m = SandboxManager.forTest({ secure });
    await m.init();
    // Migrated: named after the host, secret intact, active.
    const servers = m.serverList();
    assert.equal(servers.length, 1);
    assert.equal(servers[0].name, "legacy.example.com");
    assert.equal(servers[0].config.privateKey, "PEM");
    assert.equal(m.activeServer()?.id, servers[0].id);
    // A move, not a drop: new store written, legacy key removed.
    assert.ok(store.has("dudu.sandbox.servers.v1"));
    assert.ok(!store.has("dudu.sandbox.sshConfig.v1"));
    // Second init does not duplicate: the store is now authoritative.
    const m2 = SandboxManager.forTest({ secure });
    await m2.init();
    assert.equal(m2.serverList().length, 1);
  });

  it("switches the active server and falls back honestly when deleted", async () => {
    const store = new Map<string, string>();
    const secure = {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => {
        store.set(k, v);
      },
      deleteItem: async (k: string) => {
        store.delete(k);
      },
    };
    const m = SandboxManager.forTest({ secure });
    await m.init();
    const cfg = (host: string) => ({
      host,
      port: 22,
      username: "u",
      authType: "key" as const,
      privateKey: "PEM",
      password: null,
    });
    await m.saveServer({ id: "a", name: "A", config: cfg("a.example.com") });
    await m.saveServer({ id: "b", name: "B", config: cfg("b.example.com") });
    assert.equal(m.activeServer()?.id, "a"); // first saved stays active
    await m.setActiveServer("b");
    assert.equal(m.activeServer()?.id, "b");
    await assert.rejects(m.setActiveServer("nope"), /sandbox.noServerSelected/);
    // Deleting the active server falls back to the first remaining one.
    await m.deleteServer("b");
    assert.equal(m.activeServer()?.id, "a");
    // Deleting the last one leaves no active server (honest, no crash).
    await m.deleteServer("a");
    assert.equal(m.activeServer(), null);
    assert.equal(m.serverList().length, 0);
  });

  it("ignores corrupt persisted backend id and config", async () => {
    const m = SandboxManager.forTest({
      prefs: { getItem: async () => "bogus", setItem: async () => {} },
      secure: { getItem: async () => "{nope", setItem: async () => {}, deleteItem: async () => {} },
    });
    await m.init();
    assert.equal(m.activeBackendId(), "cloud");
  });
});

import type { SshShellHandle } from "../src/sandbox/transport.js";
import { RelaySshTransport } from "../src/sandbox/transport-relay.js";

/** Access to backend privates for tests. */
interface BackendInternals {
  transport: unknown;
  state: string;
}

const asInternals = (b: object): BackendInternals => b as unknown as BackendInternals;

const b4Config: SshConfig = {
  host: "example.com",
  port: 22,
  username: "root",
  authType: "key",
  privateKey: "PEM",
  password: null,
};

/** Spy transport: records shell writes, lets tests drive output. */
function spyTransport(): SshTransport & { writes: string[]; push: (s: string) => void } {
  const writes: string[] = [];
  let onChunk: ((c: { stream: "stdout" | "stderr"; data: string }) => void) | null = null;
  const t = {
    writes,
    push: (s: string) => onChunk?.({ stream: "stdout", data: s }),
    connect: async () => {},
    disconnect: async () => {},
    isConnected: () => true,
    exec: async (): Promise<SandboxCommandResult> => ({
      stdout: "",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
    }),
    shell: async (
      cb: (c: { stream: "stdout" | "stderr"; data: string }) => void,
    ): Promise<SshShellHandle> => {
      onChunk = cb;
      return {
        write: (data: string) => {
          writes.push(data);
        },
        resize: () => {},
        close: () => {},
      };
    },
  };
  return t;
}

describe("SshDockerBackend.openShell (B4)", () => {
  it("opens a transport shell and attaches into the container when given", async () => {
    const spy = spyTransport();
    const b = new SshDockerBackend(spy);
    b.setConfig(b4Config);
    // fake a connected state the way connect() would (transport is stubbed)
    asInternals(b).state = "connected";
    const seen: string[] = [];
    const handle = await b.openShell("c1", (chunk) => seen.push(chunk));
    assert.deepEqual(spy.writes, ["docker exec -i 'c1' sh\n"]);
    spy.push("hi\n");
    assert.deepEqual(seen, ["hi\n"]);
    handle.close();
  });

  it("opens a bare host shell when no container is given", async () => {
    const spy = spyTransport();
    const b = new SshDockerBackend(spy);
    b.setConfig(b4Config);
    asInternals(b).state = "connected";
    await b.openShell(undefined, () => {});
    assert.deepEqual(spy.writes, []);
  });

  it("refuses to open a shell when not connected", async () => {
    const b = new SshDockerBackend(spyTransport());
    b.setConfig(b4Config);
    await assert.rejects(() => b.openShell(undefined, () => {}), /notConnected/);
  });

  it("setTransport swaps the transport", async () => {
    const b = new SshDockerBackend(spyTransport());
    const relay = new RelaySshTransport("http://127.0.0.1:9/x");
    b.setTransport(relay);
    assert.equal(asInternals(b).transport, relay);
  });
});

describe("SandboxManager default transport (B4)", () => {
  it("cloud backend ships the relay transport and starts disconnected (not unavailable)", () => {
    const m = SandboxManager.forTest({});
    const backend = m.activeBackend();
    assert.equal(backend.id, "cloud");
    assert.ok(
      asInternals(backend).transport instanceof RelaySshTransport,
      "manager must inject RelaySshTransport, not UnavailableSshTransport",
    );
    assert.equal(backend.connectionState(), "disconnected");
  });
});
