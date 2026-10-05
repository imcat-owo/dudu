/**
 * Theme/wallpaper AI tools — let the AI change the wallpaper on request.
 * PURE module: no React Native imports (storage is injectable).
 */

import type { LocalTool } from "../api-groups/local-tools";
import { ToolError } from "../api-groups/local-tools";
import { coordinatesToSeed } from "./coordinates";
import { parseThemeCss } from "./css";
import { makeThemeBundle, normalizeHex } from "./derive";
import { PRESETS } from "./presets";
import { SURFACE_IDS, type SurfaceId, type ThemeBundle } from "./types";

/** Must match THEME_STORAGE_KEY in ThemeContext.tsx */
const THEME_STORAGE_KEY = "dudu.theme.bundle.v1";

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

export interface ThemeStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/**
 * Callback the UI layer registers to apply theme changes immediately
 * via ThemeContext.applyBundle (which updates React state + persists).
 * Falls back to direct storage write when no handler is registered.
 */
type ThemeApplyHandler = (patch: Record<string, unknown>) => Promise<string>;

let applyHandler: ThemeApplyHandler | null = null;

/** UI layer (ThemeContext provider) calls this once to wire immediate apply. */
export function registerThemeApplyHandler(h: ThemeApplyHandler): void {
  applyHandler = h;
}

type ThemeReloadHandler = () => Promise<void>;

let reloadHandler: ThemeReloadHandler | null = null;

/** UI layer (ThemeContext provider) calls this once to wire post-restore reload. */
export function registerThemeReloadHandler(h: ThemeReloadHandler): void {
  reloadHandler = h;
}

type ThemeStageHandler = (patch: Record<string, unknown>) => Promise<"ok" | "invalid">;

let stageHandler: ThemeStageHandler | null = null;

/**
 * UI layer (ThemeContext) calls this once to wire try-on staging:
 * applies in memory only, never persisted (§6.1).
 */
export function registerThemeStageHandler(h: ThemeStageHandler): void {
  stageHandler = h;
}

type ThemeCommitHandler = () => Promise<"ok" | "local-only" | "invalid" | "nothing-staged">;

let commitHandler: ThemeCommitHandler | null = null;

/** UI layer wires committing the staged try-on (persist it). */
export function registerThemeCommitHandler(h: ThemeCommitHandler): void {
  commitHandler = h;
}

type ThemeRollbackHandler = () => Promise<"ok">;

let rollbackHandler: ThemeRollbackHandler | null = null;

/** UI layer wires one-click rollback to the last confirmed bundle (§6.3). */
export function registerThemeRollbackHandler(h: ThemeRollbackHandler): void {
  rollbackHandler = h;
}

/**
 * Try-on fallback when no UI is mounted (tests / headless): the staged
 * patch lives in module memory and is NEVER written to storage until
 * commitStaged() runs.
 */
let stagedPatch: Record<string, unknown> | null = null;

/** Last confirmed bundle before the most recent persist (rollback fallback). */
let previousBundle: Record<string, unknown> | null = null;

/** Test-only reset for the module-level try-on / rollback state. */
export function resetThemeTryOnStateForTests(): void {
  stagedPatch = null;
  previousBundle = null;
}

async function readBundle(storage: ThemeStorage): Promise<Record<string, unknown>> {
  const raw = await storage.getItem(THEME_STORAGE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Persist a patch: via the UI handler when mounted, direct storage write
 * otherwise. Remembers the pre-write bundle so rollback_theme works
 * headless too.
 */
async function persistPatch(
  storage: ThemeStorage,
  patch: Record<string, unknown>,
): Promise<"ok" | "local-only"> {
  if (applyHandler) {
    const result = await applyHandler(patch);
    return result === "ok" ? "ok" : "local-only";
  }
  const bundle = await readBundle(storage);
  previousBundle = bundle;
  await storage.setItem(THEME_STORAGE_KEY, JSON.stringify({ ...bundle, ...patch }));
  return "ok";
}

/**
 * Persist a COMPLETE bundle (replaces the stored one). Used when a key must
 * be removed (patch-merge cannot delete keys).
 */
async function persistBundle(
  storage: ThemeStorage,
  bundle: Record<string, unknown>,
): Promise<"ok" | "local-only"> {
  if (applyHandler) {
    const result = await applyHandler(bundle);
    return result === "ok" ? "ok" : "local-only";
  }
  previousBundle = await readBundle(storage);
  await storage.setItem(THEME_STORAGE_KEY, JSON.stringify(bundle));
  return "ok";
}

function numArg(args: Record<string, unknown>, name: string, fallback: number): number {
  const v = args[name];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Parse the targets argument: "all" or a comma-separated / array list of surface ids. */
function parseTargets(raw: string, args: Record<string, unknown>): "all" | SurfaceId[] {
  const fromArgs = args.targets;
  const text =
    raw.trim() ||
    (Array.isArray(fromArgs) ? fromArgs.join(",") : typeof fromArgs === "string" ? fromArgs : "");
  if (!text.trim() || text.trim().toLowerCase() === "all") return "all";
  const ids = text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const bad = ids.filter((id) => !(SURFACE_IDS as readonly string[]).includes(id));
  if (bad.length > 0) {
    throw new ToolError(
      `Unknown surface(s): ${bad.join(", ")}. Valid: all, ${SURFACE_IDS.join(", ")}.`,
    );
  }
  return ids as SurfaceId[];
}

/** Stage a patch as a try-on (never persisted). */
async function stagePatch(patch: Record<string, unknown>): Promise<void> {
  if (stageHandler) {
    const result = await stageHandler(patch);
    if (result !== "ok") throw new ToolError("The theme preview was rejected as invalid.");
    return;
  }
  stagedPatch = { ...(stagedPatch ?? {}), ...patch };
}

/** Commit the staged try-on (persist it). */
async function commitStaged(storage: ThemeStorage): Promise<"ok" | "local-only"> {
  if (commitHandler) {
    const result = await commitHandler();
    if (result === "nothing-staged") {
      throw new ToolError("Nothing is staged. Use preview_theme first to stage a try-on.");
    }
    if (result === "invalid") {
      throw new ToolError("The staged preview was rejected as an invalid theme.");
    }
    return result;
  }
  if (!stagedPatch) {
    throw new ToolError("Nothing is staged. Use preview_theme first to stage a try-on.");
  }
  const patch = stagedPatch;
  stagedPatch = null;
  return persistPatch(storage, patch);
}

/** Roll back to the last confirmed bundle. */
async function rollbackToPrevious(storage: ThemeStorage): Promise<void> {
  if (rollbackHandler) {
    await rollbackHandler();
    return;
  }
  if (!previousBundle) {
    throw new ToolError("No previous theme to roll back to in this session.");
  }
  const target = previousBundle;
  previousBundle = null;
  stagedPatch = null;
  await storage.setItem(THEME_STORAGE_KEY, JSON.stringify(target));
}

/**
 * Ask the UI layer to re-read the theme bundle from storage (e.g. after a
 * backup restore wrote a new bundle behind the context's back).
 * Returns true when the UI actually reloaded, false when no UI is mounted
 * (the stored bundle applies on next launch).
 */
export async function requestThemeReload(): Promise<boolean> {
  if (!reloadHandler) return false;
  await reloadHandler();
  return true;
}

/**
 * Build the wallpaper tool set.
 */
export function createWallpaperTools(storage: ThemeStorage): LocalTool[] {
  return [
    {
      name: "set_wallpaper",
      description:
        "Set the app wallpaper to an image. Use when she says '帮我把这张图片变成壁纸' or asks to change the wallpaper. uri is the image URI (from a photo she shared in chat, or an image you generated). The wallpaper applies immediately.",
      parameters: {
        type: "object",
        properties: {
          uri: {
            type: "string",
            description: "Image URI (mp4 not supported, must be an image).",
          },
        },
        required: ["uri"],
        additionalProperties: false,
      },
      manualId: "themes",
      run: async (args) => {
        const uri = strArg(args, "uri").trim();
        if (!uri) throw new ToolError("uri is required.");
        const wallpaper = { uri, fit: "cover", dim: 0.35 };
        if (applyHandler) {
          const result = await applyHandler({ wallpaper });
          return result === "ok" ? "Wallpaper updated." : "Wallpaper updated (local only).";
        }
        // Read current bundle, update wallpaper, write back.
        const raw = await storage.getItem(THEME_STORAGE_KEY);
        let bundle: Record<string, unknown> = {};
        if (raw) {
          try {
            bundle = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            bundle = {};
          }
        }
        bundle.wallpaper = wallpaper;
        await storage.setItem(THEME_STORAGE_KEY, JSON.stringify(bundle));
        return "Wallpaper updated. It applies on the next theme refresh.";
      },
    },
  ];
}

/**
 * Build the theme tool set (stable four-axis + try-on).
 * Order matters: set_theme stays first (delegation-tools.test.ts pins it).
 */
export function createThemeTools(storage: ThemeStorage): LocalTool[] {
  return [
    {
      name: "set_theme",
      description:
        "Switch the app theme mode. Use when she says '换成深色模式' / '换成浅色' / '跟随系统'. mode is light | dark | system.",
      parameters: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            description: "light | dark | system — which theme mode to use.",
          },
        },
        required: ["mode"],
        additionalProperties: false,
      },
      manualId: "themes",
      run: async (args) => {
        const mode = strArg(args, "mode").toLowerCase().trim();
        if (mode !== "light" && mode !== "dark" && mode !== "system") {
          throw new ToolError('mode must be "light", "dark", or "system".');
        }
        if (applyHandler) {
          const result = await applyHandler({ mode });
          return result === "ok"
            ? `Theme mode set to ${mode}.`
            : `Theme mode set to ${mode} (local only).`;
        }
        const bundle = await readBundle(storage);
        bundle.mode = mode;
        await storage.setItem(THEME_STORAGE_KEY, JSON.stringify(bundle));
        return `Theme mode set to ${mode}. It applies on the next theme refresh.`;
      },
    },
    {
      name: "set_ai_avatar",
      description:
        "Change the AI assistant's avatar image. Use when she says '把你的头像换成这张' — uri is the image she shared or picked. Empty string resets to the default Sora avatar.",
      parameters: {
        type: "object",
        properties: {
          uri: {
            type: "string",
            description: "Image URI for the new avatar. Empty string resets to default.",
          },
        },
        required: ["uri"],
        additionalProperties: false,
      },
      manualId: "themes",
      run: async (args) => {
        const uri = strArg(args, "uri").trim();
        if (applyHandler) {
          const bundle = await readBundle(storage);
          const avatar =
            typeof bundle.avatar === "object" && bundle.avatar !== null
              ? (bundle.avatar as Record<string, unknown>)
              : {};
          if (uri) {
            avatar.assistant = uri;
          } else {
            delete avatar.assistant;
          }
          const result = await applyHandler({ avatar });
          return uri
            ? result === "ok"
              ? "AI avatar updated."
              : "AI avatar updated (local only)."
            : "AI avatar reset to the default.";
        }
        const bundle = await readBundle(storage);
        const avatar =
          typeof bundle.avatar === "object" && bundle.avatar !== null
            ? (bundle.avatar as Record<string, unknown>)
            : {};
        if (uri) {
          avatar.assistant = uri;
        } else {
          delete avatar.assistant;
        }
        bundle.avatar = avatar;
        await storage.setItem(THEME_STORAGE_KEY, JSON.stringify(bundle));
        return uri
          ? "AI avatar updated. It applies on the next theme refresh."
          : "AI avatar reset to the default. It applies on the next theme refresh.";
      },
    },
    {
      name: "get_theme",
      description:
        "Read the current theme bundle as JSON. Call this BEFORE changing anything so you know what the theme looks like now. section: 'all' or one surface id (canvas, card, input, userBubble, aiBubble, accent, text, overlay).",
      parameters: {
        type: "object",
        properties: {
          section: {
            type: "string",
            description: "'all' or one surface id. Defaults to 'all'.",
          },
        },
        additionalProperties: false,
      },
      manualId: "themes",
      run: async (args) => {
        const section = strArg(args, "section").trim() || "all";
        const bundle = await readBundle(storage);
        if (section === "all") return JSON.stringify(bundle);
        if (!(SURFACE_IDS as readonly string[]).includes(section)) {
          throw new ToolError(
            `Unknown section "${section}". Use "all" or one of: ${SURFACE_IDS.join(", ")}.`,
          );
        }
        const surfaces = (bundle.surfaces as Record<string, unknown> | undefined) ?? {};
        return JSON.stringify({ [section]: surfaces[section] ?? null });
      },
    },
    {
      name: "apply_theme_coordinates",
      description:
        "Stable four-axis recolor: give a FEELING and the engine computes a whole coherent theme from it (Polaris coordinates). hue: a feeling word (粉嫩, 樱花粉, 薄荷, 晚霞, 天空蓝, 薰衣草, mint, sakura, ocean...) or a #rrggbb hex. hueCount 1-5: color complexity, 1 = monochrome anchor. emotion -5..5: warm/bold (+) vs calm/muted (-). meaning -5..5: airy atmosphere (-) vs tactile material (+). Out-of-range numbers are clamped. Applies immediately and persists. For a no-commit preview, use preview_theme first, then confirm_theme.",
      parameters: {
        type: "object",
        properties: {
          targets: {
            type: "string",
            description:
              '"all" or comma-separated surface ids (canvas,card,input,userBubble,aiBubble,accent,text,overlay). Defaults to "all".',
          },
          hue: {
            type: "string",
            description: "Feeling word or #rrggbb hex. Required.",
          },
          hueCount: { type: "number", description: "Color complexity 1-5. Defaults to 3." },
          emotion: { type: "number", description: "Emotional intensity -5..5. Defaults to 0." },
          meaning: { type: "number", description: "Presence direction -5..5. Defaults to 0." },
          label: { type: "string", description: "Optional label for this theme." },
        },
        required: ["hue"],
        additionalProperties: false,
      },
      manualId: "themes",
      run: async (args) => {
        const hue = strArg(args, "hue");
        if (!hue.trim()) throw new ToolError("hue is required.");
        const seed = coordinatesToSeed({
          hue,
          hueCount: numArg(args, "hueCount", 3),
          emotion: numArg(args, "emotion", 0),
          meaning: numArg(args, "meaning", 0),
        });
        const targets = parseTargets(strArg(args, "targets"), args);
        const current = await readBundle(storage);
        const mode = (current.mode as ThemeBundle["mode"] | undefined) ?? "system";
        const derived = makeThemeBundle({
          id: "ai-coordinates",
          name: "ai-coordinates",
          seed,
          mode,
        });
        const label = strArg(args, "label").trim();
        const meta = {
          ...((current.meta as Record<string, unknown> | undefined) ?? {}),
          updatedAt: new Date().toISOString(),
          ...(label ? { label } : {}),
        };
        let patch: Record<string, unknown>;
        if (targets === "all") {
          patch = { seed: derived.seed, surfaces: derived.surfaces, meta };
        } else {
          const currentSurfaces = (current.surfaces as Record<string, unknown> | undefined) ?? {};
          const nextSurfaces = { ...currentSurfaces };
          for (const t of targets) {
            nextSurfaces[t] = (derived.surfaces as unknown as Record<string, unknown>)[t];
          }
          patch = { seed: derived.seed, surfaces: nextSurfaces, meta };
        }
        const result = await persistPatch(storage, patch);
        const where = targets === "all" ? "the whole theme" : `surface(s): ${targets.join(", ")}`;
        return result === "ok"
          ? `Recolored ${where} from "${hue.trim()}" (seed ${seed.primary}).`
          : `Recolored ${where} from "${hue.trim()}" (local only).`;
      },
    },
    {
      name: "apply_surface_tokens",
      description:
        "Fine-tune ONE theme surface (single-region precision). target: a surface id (canvas, card, input, userBubble, aiBubble, accent, text, overlay). tokens: any of bg, fg, accent, border (#rrggbb) and radius (number, px). Only the given tokens change; everything else stays. Applies immediately and persists.",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", description: "Surface id. Required." },
          tokens: {
            type: "object",
            description: "Token overrides: bg, fg, accent, border (#rrggbb), radius (number).",
            properties: {
              bg: { type: "string" },
              fg: { type: "string" },
              accent: { type: "string" },
              border: { type: "string" },
              radius: { type: "number" },
            },
            additionalProperties: false,
          },
        },
        required: ["target", "tokens"],
        additionalProperties: false,
      },
      manualId: "themes",
      run: async (args) => {
        const target = strArg(args, "target").trim();
        if (!(SURFACE_IDS as readonly string[]).includes(target)) {
          throw new ToolError(`Unknown surface "${target}". Valid: ${SURFACE_IDS.join(", ")}.`);
        }
        const tokens = args.tokens;
        if (typeof tokens !== "object" || tokens === null || Array.isArray(tokens)) {
          throw new ToolError("tokens must be an object.");
        }
        const t = tokens as Record<string, unknown>;
        const clean: Record<string, unknown> = {};
        for (const key of ["bg", "fg", "accent", "border"] as const) {
          const v = t[key];
          if (v !== undefined) {
            if (typeof v !== "string") throw new ToolError(`${key} must be a #rrggbb string.`);
            try {
              clean[key] = normalizeHex(v);
            } catch {
              throw new ToolError(`${key} must be a #rrggbb hex color, got "${v}".`);
            }
          }
        }
        if (t.radius !== undefined) {
          if (typeof t.radius !== "number" || !Number.isFinite(t.radius) || t.radius < 0) {
            throw new ToolError("radius must be a non-negative number.");
          }
          clean.radius = t.radius;
        }
        if (Object.keys(clean).length === 0) {
          throw new ToolError("tokens is empty — nothing to change.");
        }
        const bundle = await readBundle(storage);
        const surfaces = { ...((bundle.surfaces as Record<string, unknown> | undefined) ?? {}) };
        surfaces[target] = {
          ...((surfaces[target] as Record<string, unknown> | undefined) ?? {}),
          ...clean,
        };
        const result = await persistPatch(storage, { surfaces });
        return result === "ok"
          ? `Surface "${target}" updated.`
          : `Surface "${target}" updated (local only).`;
      },
    },
    {
      name: "apply_preset",
      description:
        "Apply a built-in theme preset by id. Never invent an id — unknown ids are rejected. Valid: preset-sora-gray, preset-mint-frost, preset-sunset-peach, preset-sakura-mist, preset-lavender-night, preset-deep-ocean. Applies immediately and persists.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Preset id. Required." },
        },
        required: ["id"],
        additionalProperties: false,
      },
      manualId: "themes",
      run: async (args) => {
        const id = strArg(args, "id").trim();
        const preset = PRESETS.find((p) => p.id === id);
        if (!preset) {
          throw new ToolError(
            `Unknown preset "${id}". Valid: ${PRESETS.map((p) => p.id).join(", ")}.`,
          );
        }
        const patch = {
          ...preset,
          meta: { ...preset.meta, updatedAt: new Date().toISOString() },
        };
        const result = await persistPatch(storage, patch);
        return result === "ok" ? `Preset "${id}" applied.` : `Preset "${id}" applied (local only).`;
      },
    },
    {
      name: "preview_theme",
      description:
        "Try-on: stage a theme change as a PREVIEW without saving it. She sees it immediately with a try-on banner; nothing is persisted. Then call confirm_theme to keep it. This is the preferred flow — preview first, save second, zero silent changes.",
      parameters: {
        type: "object",
        properties: {
          seed: {
            type: "object",
            description: "Seed colors to preview.",
            properties: {
              primary: { type: "string", description: "#rrggbb. Required." },
              secondary: { type: "string", description: "#rrggbb." },
              tertiary: { type: "string", description: "#rrggbb." },
            },
            required: ["primary"],
            additionalProperties: false,
          },
          mode: { type: "string", description: "light | dark | system." },
          css: { type: "string", description: "Restricted theme-CSS to preview." },
          label: { type: "string", description: "Optional label." },
        },
        additionalProperties: false,
      },
      manualId: "themes",
      run: async (args) => {
        const patch: Record<string, unknown> = {};
        const current = await readBundle(storage);
        const seedArg = args.seed;
        if (seedArg !== undefined) {
          if (typeof seedArg !== "object" || seedArg === null || Array.isArray(seedArg)) {
            throw new ToolError("seed must be an object with at least primary.");
          }
          const s = seedArg as Record<string, unknown>;
          let seed: { primary: string; secondary?: string; tertiary?: string };
          try {
            seed = {
              primary: normalizeHex(strArg(s, "primary")),
              ...(s.secondary ? { secondary: normalizeHex(strArg(s, "secondary")) } : {}),
              ...(s.tertiary ? { tertiary: normalizeHex(strArg(s, "tertiary")) } : {}),
            };
          } catch {
            throw new ToolError("seed colors must be #rrggbb hex.");
          }
          const mode = (current.mode as ThemeBundle["mode"] | undefined) ?? "system";
          const derived = makeThemeBundle({ id: "ai-preview", name: "ai-preview", seed, mode });
          patch.seed = derived.seed;
          patch.surfaces = derived.surfaces;
        }
        const mode = strArg(args, "mode").toLowerCase().trim();
        if (mode) {
          if (mode !== "light" && mode !== "dark" && mode !== "system") {
            throw new ToolError('mode must be "light", "dark", or "system".');
          }
          patch.mode = mode;
        }
        const css = strArg(args, "css");
        if (css) {
          const parsed = parseThemeCss(css);
          if (!parsed.ok) throw new ToolError(`CSS rejected: ${parsed.error}`);
          patch.css = css;
        }
        const label = strArg(args, "label").trim();
        if (label) {
          patch.meta = {
            ...((current.meta as Record<string, unknown> | undefined) ?? {}),
            label,
            updatedAt: new Date().toISOString(),
          };
        }
        if (Object.keys(patch).length === 0) {
          throw new ToolError("Nothing to preview — give at least seed, mode, or css.");
        }
        await stagePatch(patch);
        return "Preview staged — she sees it now, nothing saved. Call confirm_theme to keep it.";
      },
    },
    {
      name: "confirm_theme",
      description:
        "Save the staged try-on preview (from preview_theme) permanently. Fails honestly when nothing is staged — call preview_theme first.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "themes",
      run: async () => {
        const result = await commitStaged(storage);
        return result === "ok" ? "Preview saved — theme updated." : "Preview saved (local only).";
      },
    },
    {
      name: "rollback_theme",
      description:
        "One-click rollback: restore the last confirmed theme, discarding any staged preview and undoing the most recent theme change. Use when she says the new look is wrong or asks to change it back.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "themes",
      run: async () => {
        await rollbackToPrevious(storage);
        return "Rolled back to the previous theme.";
      },
    },
  ];
}

/**
 * Creative-mode theme-CSS tools (gated on the "creative" AI theme mode in
 * local-agent.ts). The AI authors restricted theme-CSS — a token-override
 * layer over the derived surfaces, never layout / interaction / business
 * logic. Every write is validated by parseThemeCss first (blockingIssues:
 * invalid CSS is rejected with a line number, nothing is applied).
 */

const CSS_LANG =
  "Restricted language: selectors must be .surface-<id> with id in canvas, card, input, userBubble, aiBubble, accent, text, overlay; " +
  "properties: bg, fg, accent, border (#rrggbb), radius (number, px), dim (0-1).";

async function readCss(storage: ThemeStorage): Promise<string> {
  const bundle = await readBundle(storage);
  const css = bundle.css;
  return typeof css === "string" ? css : "";
}

/** Validate CSS, then persist it as the bundle's css field. */
async function writeCss(storage: ThemeStorage, css: string): Promise<"ok" | "local-only"> {
  const parsed = parseThemeCss(css);
  if (!parsed.ok) throw new ToolError(`CSS rejected: ${parsed.error}`);
  return persistPatch(storage, { css });
}

export function createCreativeThemeTools(storage: ThemeStorage): LocalTool[] {
  return [
    {
      name: "read_theme_css",
      description:
        "Read the current custom theme-CSS (creative mode). Returns the raw CSS text, or says there is none. Read before editing.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "themes",
      run: async () => {
        const css = await readCss(storage);
        return css ? css : "No custom theme CSS set.";
      },
    },
    {
      name: "replace_theme_css",
      description: `Replace the ENTIRE custom theme-CSS with new text (creative mode). ${CSS_LANG} Invalid CSS is rejected with a line number — nothing is applied on failure.`,
      parameters: {
        type: "object",
        properties: {
          css: { type: "string", description: "Complete replacement CSS. Required." },
        },
        required: ["css"],
        additionalProperties: false,
      },
      manualId: "themes",
      run: async (args) => {
        const css = strArg(args, "css");
        if (!css.trim()) throw new ToolError("css is required.");
        const result = await writeCss(storage, css);
        return result === "ok" ? "Theme CSS replaced." : "Theme CSS replaced (local only).";
      },
    },
    {
      name: "append_theme_css",
      description: `Append new CSS rules to the existing custom theme-CSS (creative mode). ${CSS_LANG} The combined result is validated before applying.`,
      parameters: {
        type: "object",
        properties: {
          css: { type: "string", description: "CSS rules to append. Required." },
        },
        required: ["css"],
        additionalProperties: false,
      },
      manualId: "themes",
      run: async (args) => {
        const fragment = strArg(args, "css");
        if (!fragment.trim()) throw new ToolError("css is required.");
        const existing = await readCss(storage);
        const combined = existing ? `${existing}\n${fragment}` : fragment;
        const result = await writeCss(storage, combined);
        return result === "ok" ? "Theme CSS appended." : "Theme CSS appended (local only).";
      },
    },
    {
      name: "edit_theme_css",
      description: `Replace a snippet of the existing custom theme-CSS (creative mode). oldText must match exactly; newText replaces it. ${CSS_LANG} Validated before applying.`,
      parameters: {
        type: "object",
        properties: {
          oldText: { type: "string", description: "Exact text to find. Required." },
          newText: { type: "string", description: "Replacement text. Required." },
        },
        required: ["oldText", "newText"],
        additionalProperties: false,
      },
      manualId: "themes",
      run: async (args) => {
        const oldText = strArg(args, "oldText");
        const newText = strArg(args, "newText");
        if (!oldText) throw new ToolError("oldText is required.");
        const existing = await readCss(storage);
        if (!existing.includes(oldText)) {
          throw new ToolError("oldText not found in the current theme CSS.");
        }
        const result = await writeCss(storage, existing.replace(oldText, newText));
        return result === "ok" ? "Theme CSS edited." : "Theme CSS edited (local only).";
      },
    },
    {
      name: "insert_theme_css",
      description: `Insert new CSS rules right after the rule containing the anchor text (creative mode). ${CSS_LANG} Validated before applying.`,
      parameters: {
        type: "object",
        properties: {
          anchor: { type: "string", description: "Anchor text to insert after. Required." },
          css: { type: "string", description: "CSS rules to insert. Required." },
        },
        required: ["anchor", "css"],
        additionalProperties: false,
      },
      manualId: "themes",
      run: async (args) => {
        const anchor = strArg(args, "anchor");
        const fragment = strArg(args, "css");
        if (!anchor) throw new ToolError("anchor is required.");
        if (!fragment.trim()) throw new ToolError("css is required.");
        const existing = await readCss(storage);
        const idx = existing.indexOf(anchor);
        if (idx < 0) throw new ToolError("anchor not found in the current theme CSS.");
        // Insert after the closing brace of the rule containing the anchor.
        const closeIdx = existing.indexOf("}", idx);
        if (closeIdx < 0) throw new ToolError("anchor rule has no closing brace.");
        const insertAt = closeIdx + 1;
        const combined = `${existing.slice(0, insertAt)}\n${fragment}${existing.slice(insertAt)}`;
        const result = await writeCss(storage, combined);
        return result === "ok" ? "Theme CSS inserted." : "Theme CSS inserted (local only).";
      },
    },
    {
      name: "delete_theme_css",
      description: "Remove ALL custom theme-CSS, returning to the derived theme (creative mode).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "themes",
      run: async () => {
        const bundle = await readBundle(storage);
        if (typeof bundle.css !== "string") return "No custom theme CSS to delete.";
        delete bundle.css;
        const result = await persistBundle(storage, bundle);
        return result === "ok"
          ? "Custom theme CSS deleted."
          : "Custom theme CSS deleted (local only).";
      },
    },
  ];
}
