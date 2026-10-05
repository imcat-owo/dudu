import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activeServer,
  deleteServer,
  EMPTY_SERVER_STORE,
  isSandboxServer,
  migrateLegacySshConfig,
  newServerId,
  parseServerStore,
  renameServer,
  type SandboxServer,
  type SandboxServerStore,
  setActiveServerId,
  upsertServer,
} from "../src/sandbox/servers.js";
import type { SshConfig } from "../src/sandbox/types.js";

const cfg = (host: string): SshConfig => ({
  host,
  port: 22,
  username: "root",
  authType: "key",
  privateKey: "PEM",
  password: null,
});

const srv = (id: string, name: string, host: string): SandboxServer => ({
  id,
  name,
  config: cfg(host),
});

describe("newServerId", () => {
  it("generates unique ids", () => {
    const ids = new Set([newServerId(), newServerId(), newServerId()]);
    assert.equal(ids.size, 3);
  });
});

describe("parseServerStore", () => {
  it("parses a valid store", () => {
    const store: SandboxServerStore = {
      servers: [srv("a", "A", "a.example.com"), srv("b", "B", "b.example.com")],
      activeServerId: "b",
    };
    const parsed = parseServerStore(JSON.stringify(store));
    assert.deepEqual(parsed, store);
  });

  it("rejects corrupt / foreign data", () => {
    assert.equal(parseServerStore("{nope"), null);
    assert.equal(parseServerStore(JSON.stringify({ servers: "nope" })), null);
    assert.equal(parseServerStore(JSON.stringify({})), null);
    assert.deepEqual(parseServerStore(JSON.stringify({ servers: [] })), {
      servers: [],
      activeServerId: null,
    });
  });

  it("drops invalid entries and dedupes ids", () => {
    const raw = JSON.stringify({
      servers: [
        srv("a", "A", "a.example.com"),
        { id: "a", name: "dup", config: cfg("dup.example.com") }, // dup id
        { id: "x", name: "", config: cfg("x.example.com") }, // empty name
        { id: "y", name: "Y", config: { host: "y" } }, // bad config
      ],
      activeServerId: "a",
    });
    const parsed = parseServerStore(raw);
    assert.ok(parsed);
    assert.equal(parsed.servers.length, 1);
    assert.equal(parsed.servers[0].id, "a");
  });

  it("repairs an active id that points nowhere", () => {
    const raw = JSON.stringify({
      servers: [srv("a", "A", "a.example.com")],
      activeServerId: "ghost",
    });
    const parsed = parseServerStore(raw);
    assert.ok(parsed);
    assert.equal(parsed.activeServerId, "a");
  });
});

describe("isSandboxServer", () => {
  it("validates shape", () => {
    assert.equal(isSandboxServer(srv("a", "A", "h")), true);
    assert.equal(isSandboxServer(null), false);
    assert.equal(isSandboxServer({ id: "a", name: "A" }), false);
    assert.equal(isSandboxServer({ ...srv("a", "A", "h"), id: "" }), false);
  });
});

describe("migrateLegacySshConfig", () => {
  it("wraps the legacy config, named after the host, secret intact", () => {
    const config = cfg("186.241.68.123");
    const store = migrateLegacySshConfig(config);
    assert.equal(store.servers.length, 1);
    assert.equal(store.servers[0].name, "186.241.68.123");
    assert.deepEqual(store.servers[0].config, config);
    assert.equal(store.activeServerId, store.servers[0].id);
  });
});

describe("activeServer", () => {
  it("returns the active server, falling back to the first", () => {
    const store: SandboxServerStore = {
      servers: [srv("a", "A", "a"), srv("b", "B", "b")],
      activeServerId: "b",
    };
    assert.equal(activeServer(store)?.id, "b");
    assert.equal(activeServer({ ...store, activeServerId: "ghost" })?.id, "a");
    assert.equal(activeServer({ ...store, activeServerId: null })?.id, "a");
    assert.equal(activeServer(EMPTY_SERVER_STORE), null);
  });
});

describe("upsertServer", () => {
  it("adds new servers and replaces existing ones", () => {
    let store = upsertServer(EMPTY_SERVER_STORE, srv("a", "A", "a"));
    assert.equal(store.servers.length, 1);
    assert.equal(store.activeServerId, "a"); // first server activates
    store = upsertServer(store, srv("b", "B", "b"));
    assert.equal(store.servers.length, 2);
    assert.equal(store.activeServerId, "a"); // existing active untouched
    store = upsertServer(store, srv("a", "A2", "a2"));
    assert.equal(store.servers.length, 2);
    assert.equal(store.servers[0].name, "A2");
  });
});

describe("renameServer", () => {
  it("renames and trims; blank names are ignored", () => {
    const store: SandboxServerStore = { servers: [srv("a", "A", "a")], activeServerId: "a" };
    assert.equal(renameServer(store, "a", "  主力机  ").servers[0].name, "主力机");
    assert.equal(renameServer(store, "a", "   ").servers[0].name, "A");
    assert.equal(renameServer(store, "ghost", "X").servers[0].name, "A");
  });
});

describe("deleteServer", () => {
  it("removes the server; deleting the active one falls back", () => {
    const store: SandboxServerStore = {
      servers: [srv("a", "A", "a"), srv("b", "B", "b")],
      activeServerId: "b",
    };
    const next = deleteServer(store, "b");
    assert.equal(next.servers.length, 1);
    assert.equal(next.activeServerId, "a");
    const gone = deleteServer(store, "a");
    assert.equal(gone.activeServerId, "b"); // non-active delete keeps active
    const empty = deleteServer(next, "a");
    assert.deepEqual(empty, { servers: [], activeServerId: null });
  });
});

describe("setActiveServerId", () => {
  it("switches only to known servers", () => {
    const store: SandboxServerStore = {
      servers: [srv("a", "A", "a"), srv("b", "B", "b")],
      activeServerId: "a",
    };
    assert.equal(setActiveServerId(store, "b").activeServerId, "b");
    assert.equal(setActiveServerId(store, "ghost").activeServerId, "a");
  });
});
