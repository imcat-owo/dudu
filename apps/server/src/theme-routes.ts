import { Hono } from "hono";
import type { Store } from "./db.ts";

export const THEME_KIND = "openmuse-theme-bundle";
export const SUPPORTED_THEME_VERSIONS: readonly number[] = [1];
export const SURFACE_IDS = [
  "canvas",
  "card",
  "input",
  "userBubble",
  "aiBubble",
  "accent",
  "text",
  "overlay",
] as const;

export type ThemeBundle = {
  kind: typeof THEME_KIND;
  version: number;
  surfaces: Record<(typeof SURFACE_IDS)[number], unknown>;
} & Record<string, unknown>;

export type ThemeValidation = { ok: true; bundle: ThemeBundle } | { ok: false; error: string };

/**
 * Validate an untrusted theme bundle. Unknown fields are ignored (forward
 * compatibility) and preserved on store; only the three required checks are
 * enforced here.
 */
export function validateThemeBundle(input: unknown): ThemeValidation {
  if (typeof input !== "object" || input === null)
    return { ok: false, error: "bundle must be an object" };
  const bundle = input as Record<string, unknown>;
  if (bundle.kind !== THEME_KIND)
    return { ok: false, error: `bundle.kind must be "${THEME_KIND}"` };
  if (typeof bundle.version !== "number" || !SUPPORTED_THEME_VERSIONS.includes(bundle.version))
    return {
      ok: false,
      error: `bundle.version ${JSON.stringify(bundle.version)} is not supported`,
    };
  const surfaces = bundle.surfaces;
  if (typeof surfaces !== "object" || surfaces === null)
    return { ok: false, error: "bundle.surfaces must be an object" };
  const missing = SURFACE_IDS.filter((id) => !(id in surfaces));
  if (missing.length > 0)
    return { ok: false, error: `bundle.surfaces is missing: ${missing.join(", ")}` };
  return { ok: true, bundle: bundle as ThemeBundle };
}

const THEME_RECORD_ID = "current";
const THEME_HISTORY_ID = "history";
/** Keep the last N confirmed versions (theme-design.md §6.2). */
export const THEME_HISTORY_LIMIT = 20;

export type ThemeHistoryEntry = {
  version: number;
  bundle: ThemeBundle;
  savedAt: string;
};

export type ThemeToolMode = "stable" | "creative" | "off";

export type StagedTheme = { bundle: ThemeBundle; updatedAt: string } | null;

const THEME_MODE_ID = "tool-mode";
const THEME_STAGED_ID = "staged";

export class ThemeStore {
  constructor(private readonly db: Store) {}
  async get(owner: string): Promise<{ bundle: ThemeBundle | null; version: number }> {
    const record = await this.db.get<{ version: number; bundle: ThemeBundle }>(
      owner,
      "themes",
      THEME_RECORD_ID,
    );
    return { bundle: record?.bundle ?? null, version: record?.version ?? 0 };
  }
  async save(owner: string, bundle: ThemeBundle): Promise<number> {
    const current = await this.get(owner);
    const version = current.version + 1;
    // Archive the previous confirmed version before overwriting.
    if (current.bundle) {
      await this.pushHistory(owner, {
        version: current.version,
        bundle: current.bundle,
        savedAt: new Date().toISOString(),
      });
    }
    await this.db.put(owner, "themes", { id: THEME_RECORD_ID, version, bundle });
    return version;
  }
  async history(owner: string): Promise<ThemeHistoryEntry[]> {
    const record = await this.db.get<{ entries: ThemeHistoryEntry[] }>(
      owner,
      "themes",
      THEME_HISTORY_ID,
    );
    return record?.entries ?? [];
  }
  private async pushHistory(owner: string, entry: ThemeHistoryEntry): Promise<void> {
    const entries = [entry, ...(await this.history(owner))].slice(0, THEME_HISTORY_LIMIT);
    await this.db.put(owner, "themes", { id: THEME_HISTORY_ID, entries });
  }

  async getMode(owner: string): Promise<ThemeToolMode> {
    const record = await this.db.get<{ mode: string }>(owner, "themes", THEME_MODE_ID);
    return record?.mode === "creative" || record?.mode === "off" ? record.mode : "stable";
  }
  async setMode(owner: string, mode: ThemeToolMode): Promise<void> {
    await this.db.put(owner, "themes", { id: THEME_MODE_ID, mode });
  }
  async getStaged(owner: string): Promise<StagedTheme> {
    const record = await this.db.get<{ bundle: ThemeBundle | null; updatedAt: string }>(
      owner,
      "themes",
      THEME_STAGED_ID,
    );
    return record?.bundle ? { bundle: record.bundle, updatedAt: record.updatedAt } : null;
  }
  async setStaged(owner: string, bundle: ThemeBundle): Promise<string> {
    const updatedAt = new Date().toISOString();
    await this.db.put(owner, "themes", { id: THEME_STAGED_ID, bundle, updatedAt });
    return updatedAt;
  }
  async clearStaged(owner: string): Promise<void> {
    await this.db.put(owner, "themes", { id: THEME_STAGED_ID, bundle: null, updatedAt: "" });
  }
  /** Promote staged to current (records history) and clear staged. */
  async confirmStaged(owner: string): Promise<{ version: number; bundle: ThemeBundle } | null> {
    const staged = await this.getStaged(owner);
    if (!staged?.bundle) return null;
    const version = await this.save(owner, staged.bundle);
    await this.clearStaged(owner);
    return { version, bundle: staged.bundle };
  }
  /** Restore the most recent history entry (first non-current entry). */
  async rollbackHistory(owner: string): Promise<{ version: number; bundle: ThemeBundle } | null> {
    const entries = await this.history(owner);
    if (entries.length === 0) return null;
    const current = await this.get(owner);
    const previous = current.bundle
      ? entries.find((e) => e.version !== current.version)
      : entries[0];
    if (!previous) return null;
    const version = await this.save(owner, previous.bundle);
    return { version, bundle: previous.bundle };
  }
}

export function themeRoutes(db: Store) {
  const store = new ThemeStore(db);
  const app = new Hono<{ Variables: { owner: string } }>();
  app.get("/", async (c) => {
    const owner = c.get("owner");
    const { bundle, version } = await store.get(owner);
    const staged = await store.getStaged(owner);
    return c.json({ bundle, version, staged });
  });
  app.get("/history", async (c) => {
    const entries = await store.history(c.get("owner"));
    // Summaries only — the client fetches the full bundle when restoring.
    return c.json({
      entries: entries.map((e) => ({
        version: e.version,
        savedAt: e.savedAt,
        name: (e.bundle as Record<string, unknown>).name ?? "",
        label: ((e.bundle as Record<string, unknown>).meta as Record<string, unknown> | undefined)
          ?.label ?? null,
      })),
    });
  });
  app.get("/history/:version", async (c) => {
    const version = Number(c.req.param("version"));
    const entries = await store.history(c.get("owner"));
    const found = entries.find((e) => e.version === version);
    if (!found) return c.json({ error: "version not found" }, 404);
    return c.json({ version: found.version, bundle: found.bundle });
  });
  app.put("/", async (c) => {
    const validation = validateThemeBundle((await c.req.json())?.bundle);
    if (!validation.ok) return c.json({ error: validation.error }, 400);
    return c.json({ version: await store.save(c.get("owner"), validation.bundle) });
  });

  // --- AI try-on protocol (theme-design.md §4/§11) ---
  app.get("/mode", async (c) => {
    return c.json({ mode: await store.getMode(c.get("owner")) });
  });
  app.put("/mode", async (c) => {
    const mode = (await c.req.json())?.mode;
    if (mode !== "stable" && mode !== "creative" && mode !== "off") {
      return c.json({ error: "mode must be stable | creative | off" }, 400);
    }
    await store.setMode(c.get("owner"), mode);
    return c.json({ mode });
  });
  app.post("/preview", async (c) => {
    if (!checkStageRate(c.get("owner"))) {
      return c.json({ error: "rate limited: wait 3s between theme changes" }, 429);
    }
    const validation = validateThemeBundle((await c.req.json())?.bundle);
    if (!validation.ok) return c.json({ error: validation.error }, 400);
    const updatedAt = await store.setStaged(c.get("owner"), validation.bundle);
    return c.json({ staged: true, updatedAt });
  });
  app.post("/confirm", async (c) => {
    const result = await store.confirmStaged(c.get("owner"));
    if (!result) return c.json({ error: "nothing staged" }, 404);
    return c.json({ version: result.version });
  });
  app.post("/rollback", async (c) => {
    const result = await store.rollbackHistory(c.get("owner"));
    if (!result) return c.json({ error: "no previous version" }, 404);
    return c.json({ version: result.version });
  });
  app.delete("/preview", async (c) => {
    await store.clearStaged(c.get("owner"));
    return c.json({ cleared: true });
  });
  return app;
}

/** 3s minimum between staged writes per owner (theme-design.md §12). */
const stageRate = new Map<string, number>();
function checkStageRate(owner: string): boolean {
  const now = Date.now();
  const last = stageRate.get(owner) ?? 0;
  if (now - last < 3000) return false;
  stageRate.set(owner, now);
  return true;
}
