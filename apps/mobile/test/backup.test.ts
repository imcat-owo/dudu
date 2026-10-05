import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyBackup,
  BACKUP_KIND,
  BACKUP_VERSION,
  collectBackup,
  findUnbackedKeys,
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
    // Stripped headers and sanitized URLs are counted (disclosed, not silent).
    assert.equal(b.secretsExcluded.headersExcluded, 1, "group headers must be counted");
    assert.equal(b.secretsExcluded.urlsSanitized, 1, "sanitized TTS url must be counted");
    // No secret value anywhere in the serialized file
    const json = serializeBackup(b);
    assert.ok(!json.includes("SECRET-KEY"));
    assert.ok(!json.includes("SECRET-TTS"));
    assert.ok(!json.includes("SECRET-STT"));
    assert.ok(!json.includes("SECRET-HDR"));
    assert.ok(!json.includes("SECRET-URL-KEY"));
  });

  it("counts and discloses sanitized group baseUrls", async () => {
    const secure = fakeSecure({
      "dudu.api-groups.v1": JSON.stringify([
        {
          id: "g2",
          name: "proxy",
          baseUrl: "https://proxy.example.com/v1?key=SECRET-IN-URL",
          model: "m2",
        },
      ]),
    });
    const b = await collectBackup(fakeKV(SEED), secure);
    const g = b.apiGroups[0] as Record<string, unknown>;
    assert.equal(
      g.baseUrl,
      "https://proxy.example.com/v1",
      "secret ?key= must be stripped from baseUrl",
    );
    assert.equal(b.secretsExcluded.urlsSanitized, 1);
    assert.equal(b.secretsExcluded.headersExcluded, 0);
    const json = serializeBackup(b);
    assert.ok(!json.includes("SECRET-IN-URL"));
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
      // A2: threads are stored verbatim (v2 envelope or legacy v1 array).
      const payload = (t.data ?? t.messages) as unknown;
      const arr = Array.isArray(payload)
        ? payload
        : typeof payload === "object" && payload !== null
          ? ((payload as { messages?: unknown }).messages as unknown[] | undefined) ?? []
          : [];
      for (const m of arr as Array<Record<string, unknown>>) {
        assert.ok(!("incognito" in m));
      }
    }
  });

  it("collects memories, skills, our-space, and task cards", async () => {
    const kv = fakeKV({
      ...SEED,
      "dudu.memory.v1.memories": JSON.stringify([{ id: "m1", content: "she likes cats" }]),
      "dudu.memory.v1.profile": JSON.stringify({ name: { key: "name", value: "Xing" } }),
      "dudu.skills.v1.list": JSON.stringify([{ id: "s1", name: "travel" }]),
      "dudu.ourspace.v1.diary": JSON.stringify([{ id: "d1", text: "dear diary" }]),
      "dudu.ourspace.v2.anniversaries": JSON.stringify([{ id: "a1", name: "first date" }]),
      "dudu.tasks.v1.task1": JSON.stringify({ id: "task1", title: "do the thing" }),
    });
    const b = await collectBackup(kv, fakeSecure(SECURE_SEED));
    assert.ok(b.memories, "memories section must exist");
    assert.ok(b.skills, "skills section must exist");
    assert.ok(b.ourSpace, "ourSpace section must exist");
    assert.equal(
      (b.memories["dudu.memory.v1.memories"] as unknown[]).length,
      1,
      "memory records collected",
    );
    assert.ok(b.skills["dudu.skills.v1.list"], "skill list collected");
    assert.ok(b.ourSpace["dudu.ourspace.v1.diary"], "diary collected");
    assert.ok(b.ourSpace["dudu.ourspace.v2.anniversaries"], "anniversaries collected");
    assert.ok(b.ourSpace["dudu.tasks.v1.task1"], "task cards collected by prefix");
  });

  it("collects knowledge via the injected store (docs + chunks with vectors)", async () => {
    const kb = {
      listDocs: async () => [
        {
          id: "doc1",
          name: "notes.md",
          kind: "md" as const,
          size: 10,
          chunkCount: 2,
          status: "ready" as const,
          createdAt: 1,
        },
      ],
      listChunks: async () => [
        {
          id: "c1",
          docId: "doc1",
          index: 0,
          text: "hello",
          headingPath: "",
          vector: [0.1, 0.2],
          embedModel: "api-embeddings",
        },
      ],
      restoreSnapshot: async () => {},
    };
    const b = await collectBackup(fakeKV(SEED), fakeSecure(SECURE_SEED), kb);
    assert.ok(b.knowledge, "knowledge section must exist when a store is given");
    assert.equal(b.knowledge.docs.length, 1);
    assert.equal(b.knowledge.chunks.length, 1);
    assert.deepEqual(b.knowledge.chunks[0].vector, [0.1, 0.2], "vectors are backed up");
  });

  it("skips the knowledge section when no store is given", async () => {
    const b = await collectBackup(fakeKV(SEED), fakeSecure(SECURE_SEED));
    assert.equal(b.knowledge, undefined);
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

  it("accepts old backups without the new sections", async () => {
    const b = await collectBackup(fakeKV(SEED), fakeSecure(SECURE_SEED));
    const old = {
      kind: b.kind,
      version: b.version,
      exportedAt: b.exportedAt,
      secretsExcluded: b.secretsExcluded,
      chat: b.chat,
      apiGroups: b.apiGroups,
      plain: b.plain,
      aiAuth: b.aiAuth,
    };
    const r = parseBackup(JSON.stringify(old));
    assert.equal(r.ok, true, "old backups must still restore");
  });

  it("rejects corrupt new sections", () => {
    const base = {
      kind: BACKUP_KIND,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      secretsExcluded: { apiKeys: 0, ttsKeys: 0, sttKeys: 0 },
      chat: { threads: [] },
      apiGroups: [],
      plain: {},
      aiAuth: {},
    };
    const codeOf = (extra: Record<string, unknown>): string => {
      const r = parseBackup(JSON.stringify({ ...base, ...extra }));
      return r.ok ? "ok" : r.code;
    };
    assert.equal(codeOf({ memories: "not-a-record" }), "invalid-shape");
    assert.equal(codeOf({ knowledge: { docs: [], chunks: "nope" } }), "invalid-shape");
    assert.equal(
      codeOf({ knowledge: { docs: [{ id: 1 }], chunks: [] } }),
      "invalid-shape",
      "docs must have the right shape",
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

  it("restores memories, skills, and our-space sections", async () => {
    const src = fakeKV({
      ...SEED,
      "dudu.memory.v1.memories": JSON.stringify([{ id: "m1", content: "she likes cats" }]),
      "dudu.memory.v1.autoExtract": "0",
      "dudu.skills.v1.list": JSON.stringify([{ id: "s1", name: "travel" }]),
      "dudu.ourspace.v1.diary": JSON.stringify([{ id: "d1", text: "dear diary" }]),
      "dudu.ourspace.v2.anniversaries": JSON.stringify([{ id: "a1", name: "first date" }]),
      "dudu.tasks.v1.task1": JSON.stringify({ id: "task1", title: "do the thing" }),
    });
    const b = await collectBackup(src, fakeSecure(SECURE_SEED));
    const kv = fakeKV();
    await applyBackup(b, kv, fakeSecure());
    assert.equal(
      await kv.getItem("dudu.memory.v1.memories"),
      JSON.stringify([{ id: "m1", content: "she likes cats" }]),
    );
    assert.equal(await kv.getItem("dudu.memory.v1.autoExtract"), JSON.stringify(0));
    assert.equal(
      await kv.getItem("dudu.skills.v1.list"),
      JSON.stringify([{ id: "s1", name: "travel" }]),
    );
    assert.equal(
      await kv.getItem("dudu.ourspace.v1.diary"),
      JSON.stringify([{ id: "d1", text: "dear diary" }]),
    );
    assert.equal(
      await kv.getItem("dudu.ourspace.v2.anniversaries"),
      JSON.stringify([{ id: "a1", name: "first date" }]),
    );
    assert.equal(
      await kv.getItem("dudu.tasks.v1.task1"),
      JSON.stringify({ id: "task1", title: "do the thing" }),
    );
  });

  it("clears stale task cards not in the backup (replace semantics)", async () => {
    const src = fakeKV({
      ...SEED,
      "dudu.tasks.v1.task1": JSON.stringify({ id: "task1", title: "keep me" }),
    });
    const b = await collectBackup(src, fakeSecure(SECURE_SEED));
    const kv = fakeKV({
      "dudu.tasks.v1.stale": JSON.stringify({ id: "stale", title: "old task" }),
    });
    await applyBackup(b, kv, fakeSecure());
    const stale = JSON.parse((await kv.getItem("dudu.tasks.v1.stale")) ?? "[]");
    assert.deepEqual(stale, [], "stale task cards are cleared");
    const kept = JSON.parse((await kv.getItem("dudu.tasks.v1.task1")) ?? "{}");
    assert.equal(kept.id, "task1");
  });

  it("never writes unknown keys from the new sections", async () => {
    const b = await collectBackup(fakeKV(SEED), fakeSecure(SECURE_SEED));
    b.memories = { "evil.memory": "x" };
    b.skills = { "evil.skill": "x" };
    b.ourSpace = { "evil.space": "x", "dudu.tasks.v1x.fake": "x" };
    const kv = fakeKV();
    await applyBackup(b, kv, fakeSecure());
    assert.equal(await kv.getItem("evil.memory"), null);
    assert.equal(await kv.getItem("evil.skill"), null);
    assert.equal(await kv.getItem("evil.space"), null);
    assert.equal(await kv.getItem("dudu.tasks.v1x.fake"), null);
  });

  it("collects the whole music library (P0 — reinstall must not lose her music)", async () => {
    const kv = fakeKV({
      ...SEED,
      "dudu.music.v1.tracks": JSON.stringify([{ id: "t1", title: "song" }]),
      "dudu.music.v1.playlists": JSON.stringify([{ id: "p1", name: "mix" }]),
      "dudu.music.v1.queue": JSON.stringify(["t1"]),
      "dudu.music.v1.comments": JSON.stringify([{ id: "c1", text: "love it" }]),
      "dudu.music.v1.memories": JSON.stringify([{ id: "m1" }]),
      "dudu.music.v1.together": JSON.stringify({ count: 3 }),
      "dudu.music.v1.togetherListens": JSON.stringify([{ at: 1 }]),
      "dudu.music.v1.now": JSON.stringify({ trackId: "t1" }),
      "dudu.music.v1.intent": JSON.stringify({ kind: "dj" }),
      "dudu.music.v1.intent.appliedAt": JSON.stringify(123),
      "dudu.music.v1.selectedLyric": JSON.stringify({ trackId: "t1" }),
      "dudu.music.v1.apple-music.auth-state": JSON.stringify("authorized"),
    });
    const b = await collectBackup(kv, fakeSecure(SECURE_SEED));
    assert.ok(b.extensions, "extensions section must exist");
    const musicKeys = Object.keys(b.extensions).filter((k) =>
      k.startsWith("dudu.music.v1."),
    );
    assert.equal(musicKeys.length, 12, "all 12 music keys collected");
    assert.deepEqual(b.extensions["dudu.music.v1.playlists"], [{ id: "p1", name: "mix" }]);
  });

  it("collects capability groups and strips secret query params from member endpoints", async () => {
    const kv = fakeKV({
      ...SEED,
      "dudu.capability-groups.v1": JSON.stringify([
        {
          id: "cg1",
          name: "img",
          tag: "image_output",
          kind: "output",
          members: [
            {
              groupId: "g1",
              endpoint: "https://img.example.com/gen?key=SECRET-KEY&size=large",
              pollEndpoint: "https://img.example.com/status?token=SECRET-TOK",
            },
          ],
          enabled: true,
          createdAt: 1,
        },
      ]),
    });
    const b = await collectBackup(kv, fakeSecure(SECURE_SEED));
    const groups = b.extensions?.["dudu.capability-groups.v1"] as Array<{
      members: Array<{ endpoint: string; pollEndpoint: string }>;
    }>;
    assert.ok(groups, "capability groups collected");
    assert.equal(
      groups[0].members[0].endpoint,
      "https://img.example.com/gen?size=large",
      "secret query param stripped from endpoint",
    );
    assert.equal(
      groups[0].members[0].pollEndpoint,
      "https://img.example.com/status",
      "secret query param stripped from pollEndpoint",
    );
    assert.ok(
      b.secretsExcluded.urlsSanitized >= 2,
      "stripped capability URLs are counted",
    );
  });

  it("collects dialogs, coordination, meetings, outreach prefs, plans (P1-2/P2-8)", async () => {
    const kv = fakeKV({
      ...SEED,
      "dudu.capability-groups.v1": JSON.stringify([]),
      "dudu.capability-routing-enabled.v1": JSON.stringify("1"),
      "dudu.multi-model-coordination.v1": JSON.stringify("1"),
      "dudu.ranking-mode.v1": JSON.stringify("manual"),
      "dudu.model-profiles.v1": JSON.stringify({ "https://x::m": { tools: "on" } }),
      "dudu.dialog-registry.v1": JSON.stringify([{ id: "d1", name: "main" }]),
      "dudu.dialog-model-override.v1": JSON.stringify({ d1: "m2" }),
      "dudu.cross-dialog-trace.v1": JSON.stringify([{ at: 1 }]),
      "dudu.cross-dialog-visibility.v1": JSON.stringify({ show: true }),
      "dudu.group-meetings.v1": JSON.stringify([{ id: "mt1" }]),
      "dudu.plan-gate.v1": JSON.stringify([{ id: "plan1", status: "approved" }]),
      "dudu.outreach.v1.frequency": JSON.stringify("moderate"),
      "dudu.outreach.v1.lastOpened": JSON.stringify(1700000000000),
      "dudu.outreach.v1.lastOutreach": JSON.stringify(1700000001000),
      "dudu.outreach.v1.loveLetterNudges": JSON.stringify({ letter1: 2 }),
      "dudu.sandbox.activeBackend.v1": JSON.stringify("a"),
      "dudu.ambientvideo.v1.overrides": JSON.stringify({ ourspace: null }),
      "dudu.theme.aiMode.v1": JSON.stringify("auto"),
    });
    const b = await collectBackup(kv, fakeSecure(SECURE_SEED));
    assert.ok(b.extensions, "extensions section must exist");
    for (const key of [
      "dudu.capability-groups.v1",
      "dudu.capability-routing-enabled.v1",
      "dudu.multi-model-coordination.v1",
      "dudu.ranking-mode.v1",
      "dudu.model-profiles.v1",
      "dudu.dialog-registry.v1",
      "dudu.dialog-model-override.v1",
      "dudu.cross-dialog-trace.v1",
      "dudu.cross-dialog-visibility.v1",
      "dudu.group-meetings.v1",
      "dudu.plan-gate.v1",
      "dudu.outreach.v1.frequency",
      "dudu.outreach.v1.lastOpened",
      "dudu.outreach.v1.lastOutreach",
      "dudu.outreach.v1.loveLetterNudges",
      "dudu.sandbox.activeBackend.v1",
      "dudu.ambientvideo.v1.overrides",
      "dudu.theme.aiMode.v1",
    ]) {
      assert.ok(key in b.extensions, `${key} collected`);
    }
    assert.deepEqual(b.extensions["dudu.plan-gate.v1"], [
      { id: "plan1", status: "approved" },
    ]);
  });

  it("restores extensions round-trip — music and approved plans survive", async () => {
    const src = fakeKV({
      ...SEED,
      "dudu.music.v1.tracks": JSON.stringify([{ id: "t1", title: "song" }]),
      "dudu.music.v1.playlists": JSON.stringify([{ id: "p1", name: "mix" }]),
      "dudu.plan-gate.v1": JSON.stringify([{ id: "plan1", status: "approved" }]),
      "dudu.outreach.v1.frequency": JSON.stringify("moderate"),
    });
    const b = await collectBackup(src, fakeSecure(SECURE_SEED));
    const serialized = serializeBackup(b);
    const parsed = parseBackup(serialized);
    assert.equal(parsed.ok, true, "serialized backup parses");
    const kv = fakeKV();
    await applyBackup(parsed.ok ? parsed.backup : b, kv, fakeSecure());
    assert.equal(
      await kv.getItem("dudu.music.v1.tracks"),
      JSON.stringify([{ id: "t1", title: "song" }]),
    );
    assert.equal(
      await kv.getItem("dudu.plan-gate.v1"),
      JSON.stringify([{ id: "plan1", status: "approved" }]),
    );
    assert.equal(await kv.getItem("dudu.outreach.v1.frequency"), JSON.stringify("moderate"));
  });

  it("never writes unknown keys from extensions", async () => {
    const b = await collectBackup(fakeKV(SEED), fakeSecure(SECURE_SEED));
    b.extensions = { "evil.extension": "x", "dudu.music.v1.tracks.evil": "x" };
    const kv = fakeKV();
    await applyBackup(b, kv, fakeSecure());
    assert.equal(await kv.getItem("evil.extension"), null);
    assert.equal(await kv.getItem("dudu.music.v1.tracks.evil"), null);
  });

  it("rejects a corrupt extensions section", async () => {
    const b = await collectBackup(fakeKV(SEED), fakeSecure(SECURE_SEED));
    b.extensions = "not-a-record" as unknown as Record<string, unknown>;
    const parsed = parseBackup(serializeBackup(b));
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.code, "invalid-shape");
  });

  it("restores knowledge via restoreSnapshot", async () => {
    const seen: { snap: { docs: unknown[]; chunks: unknown[] } | null } = { snap: null };
    const kb = {
      listDocs: async () => [
        {
          id: "doc1",
          name: "notes.md",
          kind: "md" as const,
          size: 10,
          chunkCount: 1,
          status: "ready" as const,
          createdAt: 1,
        },
      ],
      listChunks: async () => [
        {
          id: "c1",
          docId: "doc1",
          index: 0,
          text: "hello",
          headingPath: "",
          vector: [0.1, 0.2],
          embedModel: "api-embeddings",
        },
      ],
      restoreSnapshot: async (docs: unknown[], chunks: unknown[]) => {
        seen.snap = { docs, chunks };
      },
    };
    const b = await collectBackup(fakeKV(SEED), fakeSecure(SECURE_SEED), kb);
    await applyBackup(b, fakeKV(), fakeSecure(), kb);
    if (!seen.snap) throw new Error("restoreSnapshot must be called");
    assert.equal(seen.snap.docs.length, 1);
    assert.equal(seen.snap.chunks.length, 1);
    assert.deepEqual((seen.snap.chunks[0] as { vector: number[] }).vector, [0.1, 0.2]);
  });

  it("marks docs stuck in indexing as failed on knowledge restore", async () => {
    const seen: { docs: Array<{ id: string; status: string; error?: string }> | null } = {
      docs: null,
    };
    const kb = {
      listDocs: async () => [],
      listChunks: async () => [],
      restoreSnapshot: async (docs: Array<{ id: string; status: string; error?: string }>) => {
        seen.docs = docs;
      },
    };
    const b = await collectBackup(fakeKV(SEED), fakeSecure(SECURE_SEED));
    b.knowledge = {
      docs: [
        {
          id: "d1",
          name: "x.md",
          kind: "md",
          size: 1,
          chunkCount: 0,
          status: "indexing",
          createdAt: 1,
        } as never,
      ],
      chunks: [],
    };
    await applyBackup(b, fakeKV(), fakeSecure(), kb);
    const failed = seen.docs?.[0];
    if (!failed) throw new Error("restoreSnapshot must be called");
    assert.equal(failed.status, "failed");
    assert.equal(failed.error, "interruptedRestore");
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

describe("findUnbackedKeys", () => {
  it("reports nothing for the full known key set", () => {
    const known = [
      "dudu.local-chat.thread1.v1",
      "dudu.api-groups.v1",
      "dudu.api-groups.active.v1",
      "dudu.settings.chatMode.v1",
      "dudu.settings.fontSize.v1",
      "dudu.font.v1",
      "dudu.theme.bundle.v1",
      "dudu.theme.history.v1",
      "dudu.theme.customPresets.v1",
      "dudu.theme.aiMode.v1",
      "dudu.voice-settings.v1",
      "dudu.tts.v1",
      "dudu.stt.v1",
      "dudu.aiAuth.v1",
      "dudu.aiAuth.v1.bluetooth",
      "dudu.memory.v1.profile",
      "dudu.memory.v1.memories",
      "dudu.memory.v1.events",
      "dudu.memory.v1.autoExtract",
      "dudu.skills.v1.list",
      "dudu.ourspace.v1.diary",
      "dudu.ourspace.v2.works",
      "dudu.tasks.v1.task1",
      "dudu.kb.v1.docs",
      "dudu.music.v1.tracks",
      "dudu.music.v1.playlists",
      "dudu.capability-groups.v1",
      "dudu.capability-routing-enabled.v1",
      "dudu.model-profiles.v1",
      "dudu.dialog-registry.v1",
      "dudu.dialog-model-override.v1",
      "dudu.cross-dialog-trace.v1",
      "dudu.cross-dialog-visibility.v1",
      "dudu.group-meetings.v1",
      "dudu.plan-gate.v1",
      "dudu.outreach.v1.frequency",
      "dudu.outreach.v1.lastOpened",
      "dudu.outreach.v1.lastOutreach",
      "dudu.outreach.v1.loveLetterNudges",
      "dudu.sandbox.activeBackend.v1",
      "dudu.ambientvideo.v1.overrides",
      // deliberately excluded: secrets + bookkeeping
      "dudu.session.token",
      "dudu.music.v1.apple-music.user-token",
      "dudu.sandbox.sshConfig.v1",
      "dudu.backup.lastAt.v1",
      "dudu.kb.v2.migrated",
    ];
    assert.deepEqual(findUnbackedKeys(known), []);
  });

  it("flags a new user-owned key nobody wired into backup", () => {
    assert.deepEqual(findUnbackedKeys(["dudu.some-new-feature.v1"]), [
      "dudu.some-new-feature.v1",
    ]);
  });

  it("ignores non-dudu keys", () => {
    assert.deepEqual(findUnbackedKeys(["EXPO_PUBLIC_FOO", "other.key"]), []);
  });
});

describe("chat envelope backup round trip (gap fill A2)", () => {
  it("round-trips v2 envelopes verbatim (versions + meta survive)", async () => {
    // A2: a thread with multiple versions and version selections must come
    // back from backup with everything intact — no information断层.
    const envelope = {
      v: 2,
      messages: [
        { id: "u1", role: "user", content: "hi" },
        { id: "a1", role: "assistant", content: "v1 answer", groupId: "g1", versionIndex: 0 },
        { id: "a2", role: "assistant", content: "v2 answer", groupId: "g1", versionIndex: 1 },
      ],
      meta: {
        selectedVersions: { g1: "a2" },
        systemPrompt: "be brief",
        tokenBudget: 50000,
        createdAt: 1,
        updatedAt: 2,
      },
    };
    const kv = fakeKV({ "dudu.local-chat.envthread.v1": JSON.stringify(envelope) });
    const b = await collectBackup(kv, fakeSecure());
    const entry = b.chat.threads.find((t) => t.id === "envthread");
    assert.ok(entry, "thread collected");
    // Restore into a fresh store and read the raw value back.
    const kv2 = fakeKV();
    await applyBackup(b, kv2, fakeSecure());
    const raw = await kv2.getItem("dudu.local-chat.envthread.v1");
    assert.deepEqual(JSON.parse(raw ?? "null"), envelope);
  });

  it("restores legacy v1 array backups", async () => {
    const b = await collectBackup(fakeKV(SEED), fakeSecure(SECURE_SEED));
    const kv = fakeKV();
    await applyBackup(b, kv, fakeSecure());
    const raw = await kv.getItem("dudu.local-chat.thread1.v1");
    assert.deepEqual(JSON.parse(raw ?? "null"), JSON.parse(SEED["dudu.local-chat.thread1.v1"]));
  });
});
