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
    const version = (await this.get(owner)).version + 1;
    await this.db.put(owner, "themes", { id: THEME_RECORD_ID, version, bundle });
    return version;
  }
}

export function themeRoutes(db: Store) {
  const store = new ThemeStore(db);
  const app = new Hono<{ Variables: { owner: string } }>();
  app.get("/", async (c) => c.json(await store.get(c.get("owner"))));
  app.put("/", async (c) => {
    const validation = validateThemeBundle((await c.req.json())?.bundle);
    if (!validation.ok) return c.json({ error: validation.error }, 400);
    return c.json({ version: await store.save(c.get("owner"), validation.bundle) });
  });
  return app;
}
