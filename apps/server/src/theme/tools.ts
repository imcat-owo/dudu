/**
 * AI theme tools (theme-design.md §3, aligned with Polaris).
 *
 * Injected per-owner per-request in engine/conversation.ts, filtered by the
 * owner's themeToolMode: "off" → the model never sees these tools;
 * "stable" → the 4-axis + surface tools; "creative" → also the CSS and
 * image-palette tools.
 *
 * Safety (theme-design.md §6): every mutating tool writes to the STAGED
 * copy only (try-on) — the client shows a "试穿中" banner and the theme
 * is confirmed only when the user taps Apply or explicitly says so.
 * Nothing here ever writes the confirmed theme silently.
 * Theme changes are rate-limited to one per 3s per owner (§12).
 */

import { defineTool } from "@copilotkit/runtime/v2";
import { z } from "zod";
import type { Store } from "../db.ts";
import { ThemeStore, type ThemeBundle as LooseBundle, type ThemeToolMode } from "../theme-routes.ts";
import { parseThemeCss } from "./css.ts";
import { clampFg, deriveSurfaces, makeThemeBundle, shiftSeed } from "./derive.ts";
import { clampAxis, feelWordToHex } from "./feel-words.ts";
import { extractPalette } from "./palette.ts";
import { PRESET_SEEDS, presetBundle } from "./presets.ts";
import {
  isThemeBundle,
  normalizeHex,
  SURFACE_IDS,
  type SurfaceId,
  type SurfaceTokens,
  type ThemeBundle as StrictBundle,
} from "./types.ts";

/** 3s minimum between staged theme writes per owner (theme-design.md §12). */
const stageRate = new Map<string, number>();
function checkStageRate(owner: string): { ok: true } | { ok: false; error: string } {
  const now = Date.now();
  const last = stageRate.get(owner) ?? 0;
  if (now - last < 3000) {
    return { ok: false, error: "Rate limited: wait 3 seconds between theme changes, then retry" };
  }
  stageRate.set(owner, now);
  return { ok: true };
}

type Ctx = { store: ThemeStore; db: Store; owner: string };

/**
 * The store keeps the loose wire type; tools work with the strict validated
 * bundle. Stored data that fails strict validation is treated as absent
 * (self-heal, theme-design.md §4.4).
 */
function strict(bundle: LooseBundle | null | undefined): StrictBundle | null {
  return bundle && isThemeBundle(bundle) ? bundle : null;
}

async function baseBundle(ctx: Ctx): Promise<StrictBundle | null> {
  const staged = await ctx.store.getStaged(ctx.owner);
  return strict(staged?.bundle) ?? strict((await ctx.store.get(ctx.owner)).bundle);
}

async function stage(ctx: Ctx, bundle: StrictBundle, label?: string) {
  const rate = checkStageRate(ctx.owner);
  if (!rate.ok) return rate;
  const stamped: StrictBundle = {
    ...bundle,
    meta: { ...bundle.meta, updatedAt: new Date().toISOString(), ...(label ? { label } : {}) },
  };
  const updatedAt = await ctx.store.setStaged(ctx.owner, stamped);
  return { staged: true, updatedAt, tryOn: "The new look is now previewing on the user's phone with an Apply / Discard banner. Do NOT call confirm_theme unless the user explicitly approved it." };
}

const surfaceIdSchema = z.enum(SURFACE_IDS as [SurfaceId, ...SurfaceId[]]);
const hexSchema = z.string().regex(/^#?[0-9a-fA-F]{6}$/, "must be a hex color like #3f9b8a");

const tokenSchema = z.object({
  bg: hexSchema.optional(),
  fg: hexSchema.optional(),
  accent: hexSchema.optional(),
  border: hexSchema.optional(),
  radius: z.number().min(0).max(64).optional(),
  dim: z.number().min(0).max(1).optional(),
});

function normalizeTokens(tokens: z.infer<typeof tokenSchema>): Partial<SurfaceTokens> {
  const out: Partial<SurfaceTokens> = {};
  if (tokens.bg) out.bg = normalizeHex(tokens.bg);
  if (tokens.fg) out.fg = normalizeHex(tokens.fg);
  if (tokens.accent) out.accent = normalizeHex(tokens.accent);
  if (tokens.border) out.border = normalizeHex(tokens.border);
  if (tokens.radius !== undefined) out.radius = tokens.radius;
  if (tokens.dim !== undefined) out.dim = tokens.dim;
  return out;
}

function steadyTools(ctx: Ctx) {
  return [
    defineTool({
      name: "get_theme",
      description:
        "Read the owner's current app theme. Call this before changing anything so you know what the theme looks like now. Returns the full theme bundle (colors per surface, wallpaper, avatar, mode), the confirmed version, and whether a try-on is currently staged.",
      parameters: z.object({
        section: z.enum(["all", ...SURFACE_IDS] as [string, ...string[]]).optional(),
      }),
      execute: async ({ section }) => {
        const { bundle, version } = await ctx.store.get(ctx.owner);
        const staged = await ctx.store.getStaged(ctx.owner);
        if (!bundle) return { theme: null, version, staged: !!staged };
        if (section && section !== "all") {
          return {
            theme: { section, tokens: bundle.surfaces[section as SurfaceId] },
            version,
            staged: !!staged,
          };
        }
        return { theme: bundle, version, staged: !!staged };
      },
    }),

    defineTool({
      name: "apply_theme_coordinates",
      description:
        "Change the app's color mood using four plain-language axes, then try it on. hue accepts a feel-word (Chinese like 薄荷, 晚霞粉, or English like mint, sunset) or a hex code like #3f9b8a — unknown words keep the current color. emotion -5 (cool, calm) to +5 (warm, lively); meaning -5 (muted, understated) to +5 (vivid, expressive). Out-of-range values are clamped to the edge. This only stages a try-on preview — the user confirms it on their phone.",
      parameters: z.object({
        targets: z.union([z.literal("all"), z.array(surfaceIdSchema)]).default("all"),
        hue: z.string().min(1).max(120),
        emotion: z.number().min(-5).max(5).default(0),
        meaning: z.number().min(-5).max(5).default(0),
        label: z.string().max(80).optional(),
      }),
      execute: async ({ targets, hue, emotion, meaning, label }) => {
        const current = await baseBundle(ctx);
        if (!current) return { error: "No theme exists yet" };
        const hueHex = feelWordToHex(hue) ?? current.seed.primary;
        const shifted = shiftSeed(hueHex, clampAxis(emotion), clampAxis(meaning));
        const resolved = current.mode === "dark" ? "dark" : "light";
        const derived = deriveSurfaces({ primary: shifted }, resolved);
        const surfaces =
          targets === "all"
            ? derived
            : { ...current.surfaces, ...Object.fromEntries(targets.map((t) => [t, derived[t]])) };
        const bundle = makeThemeBundle({
          id: current.id,
          name: current.name,
          seed: { primary: shifted },
          mode: current.mode,
          author: current.author,
          wallpaper: current.wallpaper,
          avatar: current.avatar,
          css: current.css,
          label,
        });
        bundle.surfaces = surfaces;
        return stage(ctx, bundle, label);
      },
    }),

    defineTool({
      name: "apply_surface_tokens",
      description:
        "Fine-tune one surface area of the app (for example just the chat bubbles or just the cards) by overriding its color tokens. Colors are #rrggbb hex. Text color is auto-corrected if contrast is too low. Only stages a try-on preview.",
      parameters: z.object({
        target: surfaceIdSchema,
        tokens: tokenSchema,
        label: z.string().max(80).optional(),
      }),
      execute: async ({ target, tokens, label }) => {
        const current = await baseBundle(ctx);
        if (!current) return { error: "No theme exists yet" };
        const partial = normalizeTokens(tokens);
        const merged = { ...current.surfaces[target], ...partial };
        merged.fg = clampFg(merged.bg, merged.fg);
        const bundle: StrictBundle = {
          ...current,
          surfaces: { ...current.surfaces, [target]: merged },
        };
        return stage(ctx, bundle, label);
      },
    }),

    defineTool({
      name: "set_wallpaper",
      description:
        "Change the app's chat wallpaper. Pass an http(s) image URL, or an empty uri to remove the wallpaper. fit cover fills the screen, contain shows the whole image. dim 0-1 darkens it so text stays readable. With extractPalette true, the theme colors are regenerated from the image's dominant colors. Only stages a try-on preview.",
      parameters: z.object({
        uri: z.string().max(2000).default(""),
        fit: z.enum(["cover", "contain"]).default("cover"),
        dim: z.number().min(0).max(1).default(0),
        extractPalette: z.boolean().default(false),
        label: z.string().max(80).optional(),
      }),
      execute: async ({ uri, fit, dim, extractPalette: extract, label }) => {
        const current = await baseBundle(ctx);
        if (!current) return { error: "No theme exists yet" };
        let bundle: StrictBundle = {
          ...current,
          ...(uri ? { wallpaper: { uri, fit, dim } } : { wallpaper: undefined }),
        };
        if (extract && uri) {
          const palette = await extractPalette(uri);
          if (!palette.ok) return { error: `Palette extraction failed: ${palette.error}` };
          const resolved = current.mode === "dark" ? "dark" : "light";
          bundle = {
            ...bundle,
            seed: { primary: palette.dominant },
            surfaces: deriveSurfaces({ primary: palette.dominant }, resolved),
          };
        }
        return stage(ctx, bundle, label);
      },
    }),

    defineTool({
      name: "set_avatar",
      description:
        "Change an avatar image: the user's own avatar or the assistant's avatar. Pass an http(s) image URL and which side it is for. Only stages a try-on preview.",
      parameters: z.object({
        uri: z.string().min(1).max(2000),
        for: z.enum(["user", "assistant"]),
        label: z.string().max(80).optional(),
      }),
      execute: async ({ uri, for: side, label }) => {
        const current = await baseBundle(ctx);
        if (!current) return { error: "No theme exists yet" };
        const bundle: StrictBundle = {
          ...current,
          avatar: { ...current.avatar, [side]: uri },
        };
        return stage(ctx, bundle, label);
      },
    }),

    defineTool({
      name: "set_font_size",
      description:
        "Change the app's font size. Use when she says the text is too big/small. option is system (follow OS) | small (compact, default) | standard | large. Only stages a try-on preview.",
      parameters: z.object({
        option: z.enum(["system", "small", "standard", "large"]),
        label: z.string().max(80).optional(),
      }),
      execute: async ({ option, label }) => {
        const current = await baseBundle(ctx);
        if (!current) return { error: "No theme exists yet" };
        const bundle: StrictBundle = { ...current, fontSize: option };
        return stage(ctx, bundle, label);
      },
    }),

    defineTool({
      name: "apply_preset",
      description:
        "Try on one of the built-in theme presets by id (list_theme_presets shows them). Only stages a try-on preview.",
      parameters: z.object({ id: z.string().min(1).max(80), label: z.string().max(80).optional() }),
      execute: async ({ id, label }) => {
        const bundle = presetBundle(id, id, label);
        if (!bundle) {
          return {
            error: `Unknown preset "${id}"`,
            available: PRESET_SEEDS.map((p) => p.id),
          };
        }
        return stage(ctx, bundle, label);
      },
    }),

    defineTool({
      name: "save_theme_preset",
      description:
        "Save the current look (the staged try-on if there is one, otherwise the confirmed theme) as a named preset the user can re-apply later.",
      parameters: z.object({ name: z.string().min(1).max(80) }),
      execute: async ({ name }) => {
        const current = await baseBundle(ctx);
        if (!current) return { error: "No theme exists yet" };
        const id = `user-${Date.now().toString(36)}`;
        await ctx.db.put(ctx.owner, "theme-presets", {
          id,
          name,
          bundle: current,
          savedAt: new Date().toISOString(),
        });
        return { saved: true, id, name };
      },
    }),

    defineTool({
      name: "list_theme_presets",
      description:
        "List available theme presets: the built-in set plus presets the user saved with save_theme_preset.",
      parameters: z.object({}),
      execute: async () => {
        const saved = await ctx.db.list<{
          id: string;
          name: string;
          savedAt: string;
        }>(ctx.owner, "theme-presets");
        return {
          builtIn: PRESET_SEEDS.map((p) => ({ id: p.id, mode: p.mode, seed: p.seed })),
          saved: saved.map((s) => ({ id: s.id, name: s.name, savedAt: s.savedAt })),
        };
      },
    }),

    defineTool({
      name: "preview_theme",
      description:
        "Try on a complete theme bundle (for example one built from an imported theme pack). The bundle is validated strictly — bad input fails loudly with the reason. Only stages a preview, never confirms.",
      parameters: z.object({ bundle: z.record(z.string(), z.unknown()), label: z.string().max(80).optional() }),
      execute: async ({ bundle, label }) => {
        if (!isThemeBundle(bundle)) {
          return {
            error:
              "Invalid theme bundle: must be {kind:'openmuse-theme-bundle', version:1, id, name, seed:{primary:'#rrggbb'}, mode, surfaces:{8 surfaces with bg/fg/accent hex}}",
          };
        }
        return stage(ctx, bundle, label);
      },
    }),

    defineTool({
      name: "export_theme_bundle",
      description:
        "Export the current confirmed theme as a shareable JSON bundle (the same format as the app's import/export).",
      parameters: z.object({}),
      execute: async () => {
        const { bundle, version } = await ctx.store.get(ctx.owner);
        return { bundle, version };
      },
    }),

    defineTool({
      name: "import_theme_bundle",
      description:
        "Import a theme pack JSON the user pasted or shared. Validated strictly — bad input fails loudly with the reason. Only stages a try-on preview.",
      parameters: z.object({ bundle: z.record(z.string(), z.unknown()) }),
      execute: async ({ bundle }) => {
        if (!isThemeBundle(bundle)) {
          return {
            error:
              "Invalid theme bundle: must be {kind:'openmuse-theme-bundle', version:1, id, name, seed:{primary:'#rrggbb'}, mode, surfaces:{8 surfaces with bg/fg/accent hex}}. Unknown fields are ignored; version must be 1.",
          };
        }
        return stage(ctx, bundle);
      },
    }),

    defineTool({
      name: "confirm_theme",
      description:
        "Confirm the currently staged try-on so it becomes the saved theme. ONLY call this when the user explicitly approved the new look in this conversation (said yes, apply it, looks good, etc.). Never call it proactively or silently — the default is to leave the try-on banner for the user to confirm on their phone.",
      parameters: z.object({}),
      execute: async () => {
        const result = await ctx.store.confirmStaged(ctx.owner);
        if (!result) return { error: "Nothing is staged right now" };
        return { confirmed: true, version: result.version };
      },
    }),

    defineTool({
      name: "rollback_theme",
      description:
        "Undo the last confirmed theme change: restores the previous confirmed version immediately. Use when the user says the new look is wrong or asks to go back.",
      parameters: z.object({}),
      execute: async () => {
        const result = await ctx.store.rollbackHistory(ctx.owner);
        if (!result) return { error: "No previous version to roll back to" };
        return { rolledBack: true, version: result.version };
      },
    }),
  ];
}

function creativeTools(ctx: Ctx) {
  return [
    defineTool({
      name: "read_theme_css",
      description:
        "Read the current creative-mode theme CSS overlay (may be empty). Creative CSS can only override color tokens on the 8 app surfaces — it cannot change layout or behavior.",
      parameters: z.object({}),
      execute: async () => {
        const current = await baseBundle(ctx);
        return { css: current?.css ?? "" };
      },
    }),

    defineTool({
      name: "edit_theme_css",
      description:
        "Edit the creative-mode theme CSS overlay. The language is restricted: only rules like .surface-card { bg: #ffffff; radius: 20; } are allowed — selectors must be .surface-<one of canvas, card, input, userBubble, aiBubble, accent, text, overlay>, properties only bg, fg, accent, border, radius, dim. Invalid CSS is rejected with a line number. Pass css for a full replace, or oldText+newText for a surgical edit (oldText must occur exactly once). Only stages a try-on preview.",
      parameters: z.object({
        css: z.string().max(20000).optional(),
        oldText: z.string().max(5000).optional(),
        newText: z.string().max(20000).optional(),
      }),
      execute: async ({ css, oldText, newText }) => {
        const current = await baseBundle(ctx);
        if (!current) return { error: "No theme exists yet" };
        let next: string;
        if (oldText !== undefined) {
          if (newText === undefined) return { error: "newText is required with oldText" };
          const occurrences = current.css?.split(oldText).length ?? 0;
          if (occurrences - 1 !== 1) {
            return { error: `oldText occurs ${occurrences - 1} times, must occur exactly once` };
          }
          next = (current.css ?? "").replace(oldText, newText);
        } else if (css !== undefined) {
          next = css;
        } else {
          return { error: "Pass css for full replace, or oldText+newText for a surgical edit" };
        }
        const parsed = parseThemeCss(next);
        if (!parsed.ok) return { error: `CSS rejected: ${parsed.error}` };
        return stage(ctx, { ...current, css: next });
      },
    }),

    defineTool({
      name: "extract_palette_from_image",
      description:
        "Extract the dominant colors from an image URL. Returns dominant, a 5-color palette, and a suggested readable text color. PNG and JPEG are supported; other formats and unreachable URLs fail with a clear error. Use the result with apply_theme_coordinates or set_wallpaper.",
      parameters: z.object({ uri: z.string().min(1).max(2000) }),
      execute: async ({ uri }) => extractPalette(uri),
    }),
  ];
}

/**
 * Build the theme tools for an owner, filtered by their themeToolMode.
 * "off" → no tools (the model never sees them).
 */
export async function themeToolsForOwner(db: Store, owner: string) {
  const store = new ThemeStore(db);
  const mode: ThemeToolMode = await store.getMode(owner);
  if (mode === "off") return [];
  const ctx: Ctx = { store, db, owner };
  const tools = steadyTools(ctx);
  if (mode === "creative") tools.push(...creativeTools(ctx));
  return tools;
}
