import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createBackupTools,
  type BackupToolDeps,
} from "../src/backup-tools.js";
import type { KeyValueStore, SecureKV, KnowledgeBackupTarget } from "../src/backup.js";
import { serializeBackup, type BackupFile } from "../src/backup.js";

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

function makeDeps(overrides: Partial<BackupToolDeps> = {}): BackupToolDeps & {
  savedFiles: Map<string, string>;
  wasRestored: () => boolean;
} {
  const savedFiles = new Map<string, string>();
  let restored = false;
  const deps: BackupToolDeps = {
    kv: fakeKV({
      "dudu.local-chat.thread1.v1": JSON.stringify([{ role: "user", content: "hi" }]),
      "dudu.api-groups.active.v1": JSON.stringify("g1"),
    }),
    secure: fakeSecure({
      "dudu.api-groups.v1": JSON.stringify([{ id: "g1", name: "main" }]),
    }),
    getKnowledgeStore: async (): Promise<KnowledgeBackupTarget | null> => null,
    saveBackupFile: async (filename: string, json: string) => {
      savedFiles.set(filename, json);
      return `saved ${filename}`;
    },
    listBackupFiles: async () => {
      return [...savedFiles.keys()]
        .filter((n) => n.startsWith("dudu-backup-"))
        .map((name, i) => ({ name, modifiedAt: Date.now() - i * 1000 }));
    },
    readBackupFile: async (name: string) => {
      const v = savedFiles.get(name);
      if (!v) throw new Error(`not found: ${name}`);
      return v;
    },
    onRestored: async () => {
      restored = true;
      return true;
    },
    ...overrides,
  };
  return { ...deps, savedFiles, wasRestored: () => restored };
}

const ctx = { authorize: async () => true };

describe("backup AI tools", () => {
  it("backup_create produces a valid backup file", async () => {
    const deps = makeDeps();
    const tools = createBackupTools(deps);
    const create = tools.find((t) => t.name === "backup_create");
    assert.ok(create, "backup_create registered");
    assert.equal(create.manualId, "backup");

    const out = await create.run({}, ctx);
    assert.match(out, /Backup created at/);
    assert.match(out, /Chat threads: 1/);
    assert.equal(deps.savedFiles.size, 1);
    const [filename, json] = [...deps.savedFiles.entries()][0];
    assert.match(filename, /^dudu-backup-\d{4}-\d{2}-\d{2}\.json$/);
    // The saved JSON must parse as a valid backup.
    const parsed = JSON.parse(json) as BackupFile;
    assert.equal(parsed.kind, "dudu-backup");
    assert.equal(parsed.chat.threads.length, 1);
  });

  it("backup_status reports last backup and files", async () => {
    const deps = makeDeps();
    const tools = createBackupTools(deps);
    const status = tools.find((t) => t.name === "backup_status");
    assert.ok(status, "backup_status registered");

    let out = await status.run({}, ctx);
    assert.match(out, /Last backup: never/);
    assert.match(out, /No backup files/);

    const create = tools.find((t) => t.name === "backup_create")!;
    await create.run({}, ctx);
    out = await status.run({}, ctx);
    assert.match(out, /Last backup: \d{4}-/);
    assert.match(out, /dudu-backup-/);
  });

  it("backup_restore round-trips through a created backup", async () => {
    const deps = makeDeps();
    const tools = createBackupTools(deps);
    const create = tools.find((t) => t.name === "backup_create")!;
    const restore = tools.find((t) => t.name === "backup_restore")!;
    assert.ok(restore, "backup_restore registered");
    assert.equal(restore.manualId, "backup");

    await create.run({}, ctx);
    // Wipe the chat thread, then restore from latest file.
    await deps.kv.setItem("dudu.local-chat.thread1.v1", JSON.stringify([]));
    const out = await restore.run({}, ctx);
    assert.match(out, /Restore complete from file dudu-backup-/);
    assert.ok(deps.wasRestored(), "onRestored called");
    const raw = await deps.kv.getItem("dudu.local-chat.thread1.v1");
    assert.deepEqual(JSON.parse(raw!), [{ role: "user", content: "hi" }]);
  });

  it("backup_restore with explicit backup_json", async () => {
    const deps = makeDeps();
    const tools = createBackupTools(deps);
    const create = tools.find((t) => t.name === "backup_create")!;
    const restore = tools.find((t) => t.name === "backup_restore")!;

    const createOut = await create.run({}, ctx);
    assert.ok(createOut);
    const json = [...deps.savedFiles.values()][0];
    // Clear saved files so it must use the provided JSON.
    deps.savedFiles.clear();
    const out = await restore.run({ backup_json: json }, ctx);
    assert.match(out, /Restore complete from provided JSON/);
  });

  it("backup_restore rejects corrupt JSON safely", async () => {
    const deps = makeDeps();
    const tools = createBackupTools(deps);
    const restore = tools.find((t) => t.name === "backup_restore")!;

    await assert.rejects(
      () => restore.run({ backup_json: "not json at all" }, ctx),
      /Backup validation failed.*Not valid JSON.*Nothing was changed/,
    );
    assert.equal(deps.wasRestored(), false);
  });

  it("backup_restore rejects wrong kind", async () => {
    const deps = makeDeps();
    const tools = createBackupTools(deps);
    const restore = tools.find((t) => t.name === "backup_restore")!;

    await assert.rejects(
      () => restore.run({ backup_json: JSON.stringify({ kind: "nope" }) }, ctx),
      /Not a 嘟嘟 backup file/,
    );
  });

  it("backup_restore fails cleanly with no backups available", async () => {
    const deps = makeDeps();
    const tools = createBackupTools(deps);
    const restore = tools.find((t) => t.name === "backup_restore")!;

    await assert.rejects(() => restore.run({}, ctx), /No backup file found/);
  });

  it("backup_create warns that secrets are excluded", async () => {
    const deps = makeDeps();
    const tools = createBackupTools(deps);
    const create = tools.find((t) => t.name === "backup_create")!;
    const out = await create.run({}, ctx);
    assert.match(out, /Secrets.*NOT backed up/);
    assert.match(out, /re-enter them after a restore/);
  });
});
