import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createStore } from "../apps/server/src/db.ts";
import {
  SURFACE_IDS,
  type ThemeBundle,
  ThemeStore,
  validateThemeBundle,
} from "../apps/server/src/theme-routes.ts";

function surfaces(): Record<string, unknown> {
  return Object.fromEntries(
    SURFACE_IDS.map((id) => [id, { bg: "#111111", fg: "#eeeeee", accent: "#ff00aa" }]),
  );
}

function validBundle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "openmuse-theme-bundle",
    version: 1,
    id: "theme-1",
    name: "Test theme",
    surfaces: surfaces(),
    ...overrides,
  };
}

test("validateThemeBundle accepts a valid bundle and ignores unknown fields", () => {
  const result = validateThemeBundle({ ...validBundle(), someFutureField: { nested: true } });
  assert.equal(result.ok, true);
  if (result.ok)
    assert.deepEqual((result.bundle as Record<string, unknown>).someFutureField, {
      nested: true,
    });
});

test("validateThemeBundle rejects a bundle with the wrong kind", () => {
  const result = validateThemeBundle(validBundle({ kind: "not-a-theme" }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /kind/);
});

test("validateThemeBundle rejects a bundle missing a surface", () => {
  const all = surfaces();
  delete all.overlay;
  const result = validateThemeBundle(validBundle({ surfaces: all }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /overlay/);
});

test("validateThemeBundle rejects an unsupported bundle version", () => {
  const result = validateThemeBundle(validBundle({ version: 99 }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /99/);
});

test("theme history keeps the last 20 confirmed versions", async () => {
  const root = await mkdtemp(join(tmpdir(), "openmuse-theme-"));
  try {
    const db = await createStore({ dataDir: join(root, "postgres") });
    try {
      const store = new ThemeStore(db);
      assert.deepEqual(await store.history("owner-h"), []);
      for (let i = 1; i <= 22; i++) {
        await store.save("owner-h", validBundle({ name: `v${i}` }) as ThemeBundle);
      }
      const history = await store.history("owner-h");
      // 22 saves -> 21 archived (the first save had nothing before it), capped at 20.
      assert.equal(history.length, 20);
      // Newest first: versions 21..2.
      assert.equal(history[0].version, 21);
      assert.equal(history[0].bundle.name, "v21");
      assert.equal(history[19].version, 2);
      assert.ok(typeof history[0].savedAt === "string");
    } finally {
      await db.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("theme version starts at 0, bumps on each save, and is isolated per owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "openmuse-theme-"));
  try {
    const db = await createStore({ dataDir: join(root, "postgres") });
    try {
      const store = new ThemeStore(db);

      assert.deepEqual(await store.get("owner-a"), { bundle: null, version: 0 });
      assert.equal(await store.save("owner-a", validBundle() as ThemeBundle), 1);
      assert.equal(await store.save("owner-a", validBundle({ name: "v2" }) as ThemeBundle), 2);

      const current = await store.get("owner-a");
      assert.equal(current.version, 2);
      assert.equal(current.bundle?.name, "v2");
      // Unknown fields survive the store round-trip (forward compatibility).
      await store.save("owner-b", validBundle({ futureField: 42 }) as ThemeBundle);
      const other = await store.get("owner-b");
      assert.equal(other.version, 1);
      assert.equal(other.bundle?.futureField, 42);

      // Owner A still sees only its own theme.
      const again = await store.get("owner-a");
      assert.equal(again.version, 2);
      assert.equal(again.bundle?.name, "v2");
    } finally {
      await db.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("staged try-on lifecycle: set, get, confirm, clear", async () => {
  const root = await mkdtemp(join(tmpdir(), "theme-staged-"));
  try {
    const db = await createStore({ dataDir: join(root, "db") });
    try {
      const store = new ThemeStore(db);
      const owner = "owner-staged";
      await store.save(owner, validBundle({ name: "v1" }) as ThemeBundle);

      assert.equal(await store.getStaged(owner), null);

      const stagedBundle = validBundle({ name: "try-on" });
      const updatedAt = await store.setStaged(owner, stagedBundle as ThemeBundle);
      assert.ok(updatedAt);
      const staged = await store.getStaged(owner);
      assert.equal(staged?.bundle.name, "try-on");

      // Confirm promotes staged → current and clears staged.
      const confirmed = await store.confirmStaged(owner);
      assert.equal(confirmed?.version, 2);
      assert.equal((await store.get(owner)).bundle?.name, "try-on");
      assert.equal(await store.getStaged(owner), null);

      // Confirm with nothing staged returns null.
      assert.equal(await store.confirmStaged(owner), null);

      // Clear is idempotent.
      await store.clearStaged(owner);
      assert.equal(await store.getStaged(owner), null);
    } finally {
      await db.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rollbackHistory restores the previous confirmed version", async () => {
  const root = await mkdtemp(join(tmpdir(), "theme-rollback-"));
  try {
    const db = await createStore({ dataDir: join(root, "db") });
    try {
      const store = new ThemeStore(db);
      const owner = "owner-rollback";
      assert.equal(await store.rollbackHistory(owner), null);
      await store.save(owner, validBundle({ name: "v1" }) as ThemeBundle);
      await store.save(owner, validBundle({ name: "v2" }) as ThemeBundle);
      const rolled = await store.rollbackHistory(owner);
      assert.equal(rolled?.version, 3);
      assert.equal((await store.get(owner)).bundle?.name, "v1");
    } finally {
      await db.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("theme tool mode defaults to stable and round-trips", async () => {
  const root = await mkdtemp(join(tmpdir(), "theme-mode-"));
  try {
    const db = await createStore({ dataDir: join(root, "db") });
    try {
      const store = new ThemeStore(db);
      const owner = "owner-mode";
      assert.equal(await store.getMode(owner), "stable");
      await store.setMode(owner, "creative");
      assert.equal(await store.getMode(owner), "creative");
      await store.setMode(owner, "off");
      assert.equal(await store.getMode(owner), "off");
    } finally {
      await db.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
