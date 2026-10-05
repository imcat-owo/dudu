import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AiAuthRequest } from "../src/ai-authorization.js";
import { ToolError } from "../src/api-groups/local-tools.js";
import type { SshDockerBackend } from "../src/sandbox/backend-ssh-docker.js";
import { SandboxManager } from "../src/sandbox/manager.js";
import {
  RELAY_DOWNLOAD_URL,
  relayCaddySnippet,
  relayInstallGuideText,
  relayInstallScript,
} from "../src/sandbox/relay-install.js";
import { sandboxTools } from "../src/sandbox/sandbox-tools.js";

function memorySecure() {
  const m = new Map<string, string>();
  return {
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      m.set(k, v);
    },
    deleteItem: async (k: string) => {
      m.delete(k);
    },
  };
}

function memoryPrefs() {
  const m = new Map<string, string>();
  return {
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      m.set(k, v);
    },
  };
}

/** Fake cloud backend with scripted connect(). */
function fakeCloud(connectImpl: () => Promise<void>): SshDockerBackend {
  let connected = false;
  let config: unknown = null;
  const b = {
    id: "cloud",
    nameKey: "sandbox.backend.cloud",
    connectionState: () => (connected ? "connected" : "disconnected"),
    stateDetail: () => null,
    /** SshDockerBackend-specific: the manager pushes the active config here. */
    setConfig: (c: unknown) => {
      config = c;
    },
    getConfig: () => config,
    connect: async () => {
      await connectImpl();
      connected = true;
    },
    disconnect: async () => {
      connected = false;
    },
    reset: () => {
      connected = false;
    },
    listEnvironments: async () => [],
    startEnvironment: async () => {},
    stopEnvironment: async () => {},
    runCommand: async () => ({ stdout: "", stderr: "", exitCode: 0, durationMs: 1 }),
  };
  return b as unknown as SshDockerBackend;
}

function makeManager(connectImpl: () => Promise<void> = async () => {}) {
  return SandboxManager.forTest({
    cloud: fakeCloud(connectImpl),
    secure: memorySecure(),
    prefs: memoryPrefs(),
  });
}

function makeCtx(allow: boolean) {
  const seen: AiAuthRequest[] = [];
  return {
    ctx: {
      authorize: async (req: AiAuthRequest) => {
        seen.push(req);
        return allow;
      },
    },
    seen,
  };
}

const KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nfakekey\n-----END OPENSSH PRIVATE KEY-----";

describe("sandbox_ssh_setup (D14)", () => {
  it("saves a new server, activates it and connects; popup never carries the secret", async () => {
    const m = makeManager();
    const tools = sandboxTools(m);
    const tool = tools.find((x) => x.name === "sandbox_ssh_setup");
    assert.ok(tool);
    const { ctx, seen } = makeCtx(true);
    const out = await tool.run(
      { host: "cloud.example.com", username: "root", authType: "key", secret: KEY },
      ctx,
    );
    assert.match(out, /saved and connected/);
    const list = m.serverList();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, "cloud.example.com"); // name defaults to host
    assert.equal(list[0].config.privateKey, KEY);
    assert.equal(m.activeServer()?.id, list[0].id);
    // One confirmation popup, capability-gated, secret-free.
    assert.equal(seen.length, 1);
    assert.equal(seen[0].capability, "sandbox");
    assert.ok(seen[0].action.includes("cloud.example.com"));
    assert.ok(!seen[0].action.includes("fakekey"), "secret must not leak into the popup");
    assert.ok(!seen[0].reason.includes("fakekey"), "secret must not leak into the popup");
  });

  it("denied confirmation saves nothing", async () => {
    const m = makeManager();
    const tools = sandboxTools(m);
    const tool = tools.find((x) => x.name === "sandbox_ssh_setup");
    assert.ok(tool);
    const { ctx } = makeCtx(false);
    await assert.rejects(
      () =>
        tool.run(
          { host: "cloud.example.com", username: "root", authType: "password", secret: "pw" },
          ctx,
        ),
      ToolError,
    );
    assert.equal(m.serverList().length, 0);
  });

  it("rejects missing host, bad port, and missing secret for a new server", async () => {
    const m = makeManager();
    const tools = sandboxTools(m);
    const tool = tools.find((x) => x.name === "sandbox_ssh_setup");
    assert.ok(tool);
    const { ctx } = makeCtx(true);
    await assert.rejects(
      () => tool.run({ username: "root", authType: "key", secret: KEY }, ctx),
      /Missing "host"/,
    );
    await assert.rejects(
      () =>
        tool.run({ host: "h", username: "root", authType: "key", secret: KEY, port: 99999 }, ctx),
      /Bad port/,
    );
    await assert.rejects(
      () => tool.run({ host: "h", username: "root", authType: "key" }, ctx),
      /needs its private key/,
    );
    await assert.rejects(
      () => tool.run({ host: "h", username: "root", authType: "maybe", secret: "x" }, ctx),
      /authType must be/,
    );
    assert.equal(m.serverList().length, 0);
  });

  it("updates the existing server for the same host and keeps the saved secret", async () => {
    const m = makeManager();
    await m.init();
    await m.saveServer({
      id: "srv_1",
      name: "old name",
      config: {
        host: "Cloud.Example.COM",
        port: 22,
        username: "root",
        authType: "key",
        privateKey: KEY,
        password: null,
      },
    });
    const tools = sandboxTools(m);
    const tool = tools.find((x) => x.name === "sandbox_ssh_setup");
    assert.ok(tool);
    const { ctx } = makeCtx(true);
    // No secret passed: keep the saved one (same authType).
    const out = await tool.run(
      { name: "主力机", host: "cloud.example.com", username: "admin", authType: "key" },
      ctx,
    );
    assert.match(out, /saved and connected/);
    const list = m.serverList();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "srv_1");
    assert.equal(list[0].name, "主力机");
    assert.equal(list[0].config.username, "admin");
    assert.equal(list[0].config.privateKey, KEY);
  });

  it("connect failure still reports the save honestly, with the relay install pointer", async () => {
    const m = makeManager(async () => {
      throw new Error("sandbox.relay.unreachable: fetch failed");
    });
    const tools = sandboxTools(m);
    const tool = tools.find((x) => x.name === "sandbox_ssh_setup");
    assert.ok(tool);
    const { ctx } = makeCtx(true);
    await assert.rejects(
      () =>
        tool.run(
          { host: "cloud.example.com", username: "root", authType: "key", secret: KEY },
          ctx,
        ),
      /is saved, but connecting failed.*sandbox_relay_install_guide/,
    );
    // Saved despite the failed connect — nothing silently dropped.
    assert.equal(m.serverList().length, 1);
  });
});

describe("sandbox_relay_install_guide (D18)", () => {
  it("returns the exact install commands, never improvised", async () => {
    const m = makeManager();
    const tools = sandboxTools(m);
    const tool = tools.find((x) => x.name === "sandbox_relay_install_guide");
    assert.ok(tool);
    // In-app tool: no authorize popup needed (read-only text).
    assert.equal(tool.capability, undefined);
    const { ctx } = makeCtx(true);
    const zh = await tool.run({}, ctx);
    assert.ok(zh.includes(RELAY_DOWNLOAD_URL));
    assert.ok(zh.includes("18731"));
    assert.ok(zh.includes("/dudu-sandbox"));
    const en = await tool.run({ language: "en" }, ctx);
    assert.ok(en.includes(RELAY_DOWNLOAD_URL));
    assert.ok(en.includes("18731"));
  });
});

describe("relay-install recipe", () => {
  it("caddy snippet uses the server host, falls back to a placeholder", () => {
    assert.ok(relayCaddySnippet("cloud.example.com").includes("cloud.example.com"));
    assert.ok(relayCaddySnippet("").includes("sandbox.example.com"));
  });

  it("install script pulls relay.mjs from her repo and targets port 18731", () => {
    const s = relayInstallScript();
    assert.ok(s.includes(RELAY_DOWNLOAD_URL));
    assert.ok(s.includes("18731"));
  });

  it("guide text stays consistent with transport-relay.ts constants", () => {
    const zh = relayInstallGuideText("zh");
    assert.ok(zh.includes("/dudu-sandbox"));
    assert.ok(zh.includes("18731"));
  });
});
