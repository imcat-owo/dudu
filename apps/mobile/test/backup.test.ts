import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BACKUP_KIND,
  BACKUP_VERSION,
  applyBackup,
  collectBackup,
  parseBackup,
  serializeBackup,
  type KeyValueStore,
  type SecureKV,
} from "../src/backup.js";

function fakeKV(seed: Record<string, string> = {}): KeyValueStore {
  const map = new Map(Object.entries(seed));
  return {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v);
    },
    getAllKeys: async () => [...map.keys()],
  };
}

function fakeSecure(seed: Record<string, string> = {}): SecureKV {
  const map = new Map(Object.entries(seed));
  return {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v);
    },
  };
}

const SEED: Record<string, string> = {
  "openmuse.local-chat.thread1.v1": JSON.stringify([
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
  ]),
  "openmuse.local-chat.thread2.v1": JSON.stringify([{ role: "user", content: "x" }]),
  "openmuse.api-groups.active.v1": JSON.stringify("g1"),
  "openmuse.theme.bundle.v1": JSON.stringify({ kind: "openmuse-theme-bundle", version: 1 }),
  "openmuse.tts.v1": JSON.stringify({
    provider: "custom",
    voice: "v1",
    customUrl: "https://x",
    customKey: "SECRET-TTS",
    customModel: "m",
  }),
  "openmuse.aiAuth.v1": JSON.stringify({ bluetooth: "ask" }),
};

const SECURE_SEED: Record<string, string> = {
  "openmuse.api-groups.v1": JSON.stringify([
    {
      id: "g1",
      name: "main",
      vendor: "openai",
      baseUrl: "https://api.example.com/v1",
      apiKey: "SECRET-KEY",
      model: "m1",
      headers: { "X-Foo": "SECRET-HDR" },
      createdAt: 1,
    },
  ]),
};

describe("collectBackup", () => {
  it("collects threads, groups, plain keys, ai-auth", async () => {
    const b = await collectBackup(fakeKV(SEED), fakeSecure(SECURE_SEED));
    assert.equal(b.kind, BACKUP_KIND);
    assert.equal(b.version, BACKUP_VERSION);
    assert.equal(b.chat.threads.length, 2);
    assert.equal(b.apiGroups.length, 1);
    assert.equal(b.plain["openmuse.api-groups.active.v1"], "g1");
    assert.ok(b.exportedAt);
  });

  it("strips secrets and counts them", async () => {
    const b = await collectBackup(fakeKV(SEED), fakeSecure(SECURE_SEED));
    const g = b.apiGroups[0] as Record<string, unknown>;
    assert.ok(!("apiKey" in g), "apiKey must be stripped");
    assert.ok(!("headers" in g), "headers must be stripped");
    assert.equal(g.baseUrl, "https://api.example.com/v1");
    assert.equal(b.secretsExcluded.apiKeys, 1);
    const tts = b.plain["openmuse.tts.v1"] as Record<string, unknown>;
    assert.ok(!("customKey" in tts), "customKey must be stripped");
    assert.equal(b.secretsExcluded.ttsKeys, 1);
    // No secret value anywhere in the serialized file
    const json = serializeBackup(b);
    assert.ok(!json.includes("SECRET-KEY"));
    assert.ok(!json.includes("SECRET-TTS"));
    assert.ok(!json.includes("SECRET-HDR"));
  });

  it("never includes incognito content (nothing incognito is in storage)", async () => {
    // Incognito messages are never written to any store, so collectBackup
    // (which only reads known storage keys) cannot see them.
    const kv = fakeKV(SEED);
    const b = await collectBackup(kv, fakeSecure(SECURE_SEED));
    const json = serializeBackup(b);
    assert.ok(!json.includes("incognito"));
    for (const t of b.chat.threads) {
      for (const m of t.messages as Array<Record<string, unknown>>) {
        assert.ok(!("incognito" in m));
      }
    }
  });
});

describe("parseBackup", () => {
  it("round-trips a collected backup", async () => {
    const b = await collectBackup(fakeKV(SEED), fakeSecure(SECURE_SEED));
    const r = parseBackup(serializeBackup(b));
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.backup.chat.threads.length, 2);
  });

  it("rejects corrupt files with codes", () => {
    const codeOf = (text: string): string => {
      const r = parseBackup(text);
      return r.ok ? "ok" : r.code;
    };
    assert.equal(codeOf(""), "empty");
    assert.equal(codeOf("   "), "empty");
    assert.equal(codeOf("not json"), "not-json");
    assert.equal(codeOf(JSON.stringify({ kind: "nope", version: 1 })), "bad-kind");
    assert.equal(
      codeOf(JSON.stringify({ kind: BACKUP_KIND, version: 999 })),
      "unsupported-version",
    );
    assert.equal(
      codeOf(JSON.stringify({ kind: BACKUP_KIND, version: BACKUP_VERSION })),
      "invalid-shape",
    );
  });
});

describe("applyBackup", () => {
  it("restores threads, groups (keyless), plain keys", async () => {
    const b = await collectBackup(fakeKV(SEED), fakeSecure(SECURE_SEED));
    const kv = fakeKV();
    const secure = fakeSecure();
    await applyBackup(b, kv, secure);
    const t1 = JSON.parse((await kv.getItem("openmuse.local-chat.thread1.v1")) ?? "[]");
    assert.equal(t1.length, 2);
    const groups = JSON.parse((await secure.getItem("openmuse.api-groups.v1")) ?? "[]");
    assert.equal(groups.length, 1);
    assert.ok(!("apiKey" in groups[0]), "restored groups stay keyless");
    assert.equal(await kv.getItem("openmuse.api-groups.active.v1"), JSON.stringify("g1"));
  });

  it("replaces old threads instead of merging", async () => {
    const b = await collectBackup(fakeKV(SEED), fakeSecure(SECURE_SEED));
    const kv = fakeKV({
      "openmuse.local-chat.oldthread.v1": JSON.stringify([{ role: "user", content: "old" }]),
    });
    await applyBackup(b, kv, fakeSecure());
    const old = JSON.parse((await kv.getItem("openmuse.local-chat.oldthread.v1")) ?? "[]");
    assert.deepEqual(old, [], "stale threads are cleared");
  });

  it("never writes unknown keys", async () => {
    const b = await collectBackup(fakeKV(SEED), fakeSecure(SECURE_SEED));
    (b.plain as Record<string, unknown>)["evil.key"] = "x";
    const kv = fakeKV();
    await applyBackup(b, kv, fakeSecure());
    assert.equal(await kv.getItem("evil.key"), null);
  });
});
