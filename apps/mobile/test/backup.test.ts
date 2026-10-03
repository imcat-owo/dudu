import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyBackup,
  BACKUP_KIND,
  BACKUP_VERSION,
  collectBackup,
  type KeyValueStore,
  parseBackup,
  type SecureKV,
  serializeBackup,
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
  "dudu.local-chat.thread1.v1": JSON.stringify([
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
  ]),
  "dudu.local-chat.thread2.v1": JSON.stringify([{ role: "user", content: "x" }]),
  "dudu.api-groups.active.v1": JSON.stringify("g1"),
  "dudu.theme.bundle.v1": JSON.stringify({ kind: "dudu-theme-bundle", version: 1 }),
  "dudu.aiAuth.v1": JSON.stringify({ bluetooth: "ask" }),
};

const SECURE_SEED: Record<string, string> = {
  "dudu.api-groups.v1": JSON.stringify([
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
  // Production layout: TTS/STT configs live in SecureStore (voice/store.ts),
  // never in plain AsyncStorage.
  "dudu.tts.v1": JSON.stringify({
    provider: "custom",
    voice: "v1",
    customUrl: "https://tts.example.com/speak?key=SECRET-URL-KEY&voice=v1",
    customKey: "SECRET-TTS",
    customModel: "m",
  }),
  "dudu.stt.v1": JSON.stringify({
    provider: "custom",
    customUrl: "https://stt.example.com/transcribe",
    customKey: "SECRET-STT",
    customModel: "s",
  }),
};

describe("collectBackup", () => {
  it("collects threads, groups, plain keys, ai-auth", async () => {
    const b = await collectBackup(fakeKV(SEED), fakeSecure(SECURE_SEED));
    assert.equal(b.kind, BACKUP_KIND);
    assert.equal(b.version, BACKUP_VERSION);
    assert.equal(b.chat.threads.length, 2);
    assert.equal(b.apiGroups.length, 1);
    assert.equal(b.plain["dudu.api-groups.active.v1"], "g1");
    assert.ok(b.exportedAt);
  });

  it("strips secrets and counts them", async () => {
    const b = await collectBackup(fakeKV(SEED), fakeSecure(SECURE_SEED));
    const g = b.apiGroups[0] as Record<string, unknown>;
    assert.ok(!("apiKey" in g), "apiKey must be stripped");
    assert.ok(!("headers" in g), "headers must be stripped");
    assert.equal(g.baseUrl, "https://api.example.com/v1");
    assert.equal(b.secretsExcluded.apiKeys, 1);
    // TTS/STT come from the SecureStore fake (production layout).
    const tts = b.plain["dudu.tts.v1"] as Record<string, unknown>;
    assert.ok(!("customKey" in tts), "customKey must be stripped");
    assert.equal(b.secretsExcluded.ttsKeys, 1);
    const stt = b.plain["dudu.stt.v1"] as Record<string, unknown>;
    assert.ok(!("customKey" in stt), "stt customKey must be stripped");
    assert.equal(b.secretsExcluded.sttKeys, 1);
    // URL query-string secrets are sanitized; safe params survive.
    assert.equal(
      tts.customUrl,
      "https://tts.example.com/speak?voice=v1",
      "secret ?key= must be stripped from URLs",
    );
    assert.equal(stt.customUrl, "https://stt.example.com/transcribe");
    // No secret value anywhere in the serialized file
    const json = serializeBackup(b);
    assert.ok(!json.includes("SECRET-KEY"));
    assert.ok(!json.includes("SECRET-TTS"));
    assert.ok(!json.includes("SECRET-STT"));
    assert.ok(!json.includes("SECRET-HDR"));
    assert.ok(!json.includes("SECRET-URL-KEY"));
  });

  it("does not read TTS/STT from plain AsyncStorage (production writes SecureStore)", async () => {
    // A TTS config sitting in plain storage (wrong backend) must be ignored —
    // production never writes it there.
    const kv = fakeKV({
      ...SEED,
      "dudu.tts.v1": JSON.stringify({ provider: "x", customKey: "WRONG-BACKEND" }),
    });
    const b = await collectBackup(kv, fakeSecure(SECURE_SEED));
    const tts = b.plain["dudu.tts.v1"] as Record<string, unknown>;
    assert.ok(!("customKey" in tts));
    const json = serializeBackup(b);
    assert.ok(!json.includes("WRONG-BACKEND"));
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
    const t1 = JSON.parse((await kv.getItem("dudu.local-chat.thread1.v1")) ?? "[]");
    assert.equal(t1.length, 2);
    const groups = JSON.parse((await secure.getItem("dudu.api-groups.v1")) ?? "[]");
    assert.equal(groups.length, 1);
    assert.ok(!("apiKey" in groups[0]), "restored groups stay keyless");
    assert.equal(await kv.getItem("dudu.api-groups.active.v1"), JSON.stringify("g1"));
  });

  it("replaces old threads instead of merging", async () => {
    const b = await collectBackup(fakeKV(SEED), fakeSecure(SECURE_SEED));
    const kv = fakeKV({
      "dudu.local-chat.oldthread.v1": JSON.stringify([{ role: "user", content: "old" }]),
    });
    await applyBackup(b, kv, fakeSecure());
    const old = JSON.parse((await kv.getItem("dudu.local-chat.oldthread.v1")) ?? "[]");
    assert.deepEqual(old, [], "stale threads are cleared");
  });

  it("never writes unknown keys", async () => {
    const b = await collectBackup(fakeKV(SEED), fakeSecure(SECURE_SEED));
    (b.plain as Record<string, unknown>)["evil.key"] = "x";
    const kv = fakeKV();
    await applyBackup(b, kv, fakeSecure());
    assert.equal(await kv.getItem("evil.key"), null);
  });

  it("restores TTS/STT to SecureStore (production layout), not plain storage", async () => {
    const b = await collectBackup(fakeKV(SEED), fakeSecure(SECURE_SEED));
    const kv = fakeKV();
    const secure = fakeSecure();
    await applyBackup(b, kv, secure);
    assert.equal(await kv.getItem("dudu.tts.v1"), null, "must not land in AsyncStorage");
    assert.equal(await kv.getItem("dudu.stt.v1"), null, "must not land in AsyncStorage");
    const tts = JSON.parse((await secure.getItem("dudu.tts.v1")) ?? "{}");
    assert.equal(tts.provider, "custom");
    assert.ok(!("customKey" in tts), "restored voice configs stay keyless");
    const stt = JSON.parse((await secure.getItem("dudu.stt.v1")) ?? "{}");
    assert.equal(stt.provider, "custom");
  });

  it("does not touch same-prefix keys without the .v1 suffix", async () => {
    const b = await collectBackup(fakeKV(SEED), fakeSecure(SECURE_SEED));
    const kv = fakeKV({
      "dudu.local-chat.notes.txt": "do not touch",
      "dudu.local-chat.thread1.v1": JSON.stringify([{ role: "user", content: "old" }]),
    });
    await applyBackup(b, kv, fakeSecure());
    assert.equal(await kv.getItem("dudu.local-chat.notes.txt"), "do not touch");
    // thread1 IS in the backup, so it gets the backup's messages
    const t1 = JSON.parse((await kv.getItem("dudu.local-chat.thread1.v1")) ?? "[]");
    assert.equal(t1.length, 2);
  });

  it("does not write last-backup timestamp on restore", async () => {
    const b = await collectBackup(fakeKV(SEED), fakeSecure(SECURE_SEED));
    const kv = fakeKV({
      "dudu.backup.lastAt.v1": JSON.stringify("2020-01-01T00:00:00.000Z"),
    });
    await applyBackup(b, kv, fakeSecure());
    assert.equal(
      await kv.getItem("dudu.backup.lastAt.v1"),
      JSON.stringify("2020-01-01T00:00:00.000Z"),
      "restore must not masquerade as a backup",
    );
  });

  it("clears stale threads only after writing new ones (no data loss window)", async () => {
    const b = await collectBackup(fakeKV(SEED), fakeSecure(SECURE_SEED));
    const kv = fakeKV({
      "dudu.local-chat.stale.v1": JSON.stringify([{ role: "user", content: "stale" }]),
    });
    await applyBackup(b, kv, fakeSecure());
    const stale = JSON.parse((await kv.getItem("dudu.local-chat.stale.v1")) ?? "[]");
    assert.deepEqual(stale, [], "stale threads are cleared");
    const t1 = JSON.parse((await kv.getItem("dudu.local-chat.thread1.v1")) ?? "[]");
    assert.equal(t1.length, 2, "backup threads are written");
  });
});

describe("sanitizeUrl", () => {
  it("strips secret query params but keeps safe ones and normal URLs", async () => {
    const { sanitizeUrl } = await import("../src/backup.js");
    assert.equal(sanitizeUrl("https://x.com/a"), "https://x.com/a");
    assert.equal(sanitizeUrl("https://x.com/a?key=sk-123&foo=bar"), "https://x.com/a?foo=bar");
    assert.equal(
      sanitizeUrl("https://x.com/a?foo=bar&api_key=zz&token=tt"),
      "https://x.com/a?foo=bar",
    );
    assert.equal(sanitizeUrl("https://x.com/a?key=only"), "https://x.com/a");
    assert.equal(sanitizeUrl("not a url"), "not a url");
    assert.equal(sanitizeUrl(42), 42);
    assert.equal(sanitizeUrl(null), null);
  });
});
