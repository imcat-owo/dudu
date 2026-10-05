/**
 * B6: the 16 AI theme tools are REAL.
 * Registry count == 16; every tool invocable; every mutating tool observably
 * changes theme state (apply -> read back the store -> assert).
 * Try-on: preview does NOT persist; confirm DOES persist.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { LocalTool } from "../src/api-groups/local-tools.js";
import { coordinatesToSeed, resolveHue } from "../src/theme/coordinates.js";
import {
  createCreativeThemeTools,
  createThemeTools,
  createWallpaperTools,
  resetThemeTryOnStateForTests,
} from "../src/theme/tools.js";

const THEME_KEY = "dudu.theme.bundle.v1";

function memStorage() {
  const map = new Map<string, string>();
  return {
    getItem: async (k: string) => map.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      map.set(k, v);
    },
    _map: map,
  };
}

/** Minimal ToolContext stub — in-app tools don't hit the authorize gate. */
const ctx = { authorize: async () => true };

function allTools(s: ReturnType<typeof memStorage>) {
  return [...createWallpaperTools(s), ...createThemeTools(s), ...createCreativeThemeTools(s)];
}

function readBundle(s: ReturnType<typeof memStorage>): Record<string, unknown> {
  const raw = s._map.get(THEME_KEY);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function tool(s: ReturnType<typeof memStorage>, name: string): LocalTool {
  const t = allTools(s).find((x) => x.name === name);
  if (!t) throw new Error(`${name} is not registered`);
  return t;
}

test("registry has exactly 16 unique AI theme tools", () => {
  const s = memStorage();
  const tools = allTools(s);
  assert.equal(tools.length, 16);
  assert.equal(new Set(tools.map((t) => t.name)).size, 16);
  for (const t of tools) {
    assert.ok(t.description.length > 20, `${t.name} has a real description`);
    assert.equal((t as { manualId?: string }).manualId, "themes");
  }
});

test("set_wallpaper persists the wallpaper", async () => {
  const s = memStorage();
  await tool(s, "set_wallpaper").run({ uri: "https://example.com/w.png" }, ctx);
  const bundle = readBundle(s);
  assert.equal((bundle.wallpaper as { uri: string }).uri, "https://example.com/w.png");
});

test("set_theme switches mode and rejects bad mode", async () => {
  const s = memStorage();
  await tool(s, "set_theme").run({ mode: "dark" }, ctx);
  assert.equal(readBundle(s).mode, "dark");
  await assert.rejects(() => tool(s, "set_theme").run({ mode: "neon" }, ctx));
});

test("set_ai_avatar sets and resets", async () => {
  const s = memStorage();
  await tool(s, "set_ai_avatar").run({ uri: "https://example.com/a.png" }, ctx);
  assert.equal(
    (readBundle(s).avatar as { assistant: string }).assistant,
    "https://example.com/a.png",
  );
  await tool(s, "set_ai_avatar").run({ uri: "" }, ctx);
  assert.ok(!(readBundle(s).avatar as { assistant?: string }).assistant);
});

test("get_theme returns the bundle JSON; sections and bad sections", async () => {
  const s = memStorage();
  await tool(s, "apply_preset").run({ id: "preset-sakura-mist" }, ctx);
  const all = JSON.parse((await tool(s, "get_theme").run({}, ctx)) as string) as Record<
    string,
    unknown
  >;
  assert.equal(all.id, "preset-sakura-mist");
  const card = JSON.parse((await tool(s, "get_theme").run({ section: "card" }, ctx)) as string);
  assert.ok((card.card as { bg: string }).bg, "card section returned");
  await assert.rejects(() => tool(s, "get_theme").run({ section: "nope" }, ctx));
});

test("apply_theme_coordinates: 粉嫩 becomes a pink theme", async () => {
  const s = memStorage();
  assert.equal(resolveHue("粉嫩"), "#f4a7c3");
  const res = (await tool(s, "apply_theme_coordinates").run({ hue: "粉嫩" }, ctx)) as string;
  assert.match(res, /粉嫩/);
  const bundle = readBundle(s);
  const seed = bundle.seed as { primary: string };
  assert.equal(seed.primary, coordinatesToSeed({ hue: "粉嫩" }).primary);
  // Pink, not gray: hue-rotate check via a second axis value changing output.
  const other = coordinatesToSeed({ hue: "粉嫩", emotion: 5 }).primary;
  assert.notEqual(seed.primary, other, "emotion axis observably changes the seed");
  const mono = coordinatesToSeed({ hue: "粉嫩", hueCount: 1 });
  assert.ok(!mono.secondary && !mono.tertiary, "hueCount=1 is monochrome");
});

test("apply_theme_coordinates rejects unknown hues and surfaces", async () => {
  const s = memStorage();
  await assert.rejects(() => tool(s, "apply_theme_coordinates").run({ hue: "blurple" }, ctx));
  await assert.rejects(() =>
    tool(s, "apply_theme_coordinates").run({ hue: "#ff0000", targets: "nope" }, ctx),
  );
  // Direct hex works too.
  await tool(s, "apply_theme_coordinates").run({ hue: "#123456" }, ctx);
  assert.ok((readBundle(s).seed as { primary: string }).primary);
});

test("apply_theme_coordinates targets a single surface", async () => {
  const s = memStorage();
  await tool(s, "apply_surface_tokens").run({ target: "card", tokens: { bg: "#111111" } }, ctx);
  await tool(s, "apply_theme_coordinates").run({ hue: "#ff0000", targets: "accent" }, ctx);
  const surfaces = readBundle(s).surfaces as Record<string, { bg: string }>;
  assert.equal(surfaces.card.bg, "#111111", "untargeted surface untouched");
  assert.notEqual(surfaces.accent.bg, "#111111", "targeted surface recolored");
});

test("apply_surface_tokens validates", async () => {
  const s = memStorage();
  await tool(s, "apply_surface_tokens").run({ target: "card", tokens: { bg: "#123456" } }, ctx);
  assert.equal((readBundle(s).surfaces as Record<string, { bg: string }>).card.bg, "#123456");
  await assert.rejects(() =>
    tool(s, "apply_surface_tokens").run({ target: "nope", tokens: { bg: "#123456" } }, ctx),
  );
  await assert.rejects(() =>
    tool(s, "apply_surface_tokens").run({ target: "card", tokens: { bg: "red" } }, ctx),
  );
  await assert.rejects(() =>
    tool(s, "apply_surface_tokens").run({ target: "card", tokens: {} }, ctx),
  );
});

test("apply_preset applies a real preset; unknown ids rejected (no silent fallback)", async () => {
  const s = memStorage();
  await tool(s, "apply_preset").run({ id: "preset-sakura-mist" }, ctx);
  assert.equal(readBundle(s).id, "preset-sakura-mist");
  const before = s._map.get(THEME_KEY);
  await assert.rejects(() => tool(s, "apply_preset").run({ id: "preset-fake" }, ctx));
  assert.equal(s._map.get(THEME_KEY), before, "failed preset apply changed nothing");
});

test("try-on: preview does NOT persist; confirm DOES; rollback restores", async () => {
  const s = memStorage();
  resetThemeTryOnStateForTests();
  await tool(s, "set_theme").run({ mode: "light" }, ctx);
  const before = s._map.get(THEME_KEY);

  const msg = (await tool(s, "preview_theme").run({ seed: { primary: "#ff0000" } }, ctx)) as string;
  assert.match(msg, /nothing saved/i);
  assert.equal(s._map.get(THEME_KEY), before, "preview must not persist");

  const saved = (await tool(s, "confirm_theme").run({}, ctx)) as string;
  assert.match(saved, /saved/i);
  assert.equal((readBundle(s).seed as { primary: string }).primary, "#ff0000");

  await tool(s, "rollback_theme").run({}, ctx);
  assert.equal(s._map.get(THEME_KEY), before, "rollback restores the previous bundle");
});

test("confirm_theme with nothing staged fails honestly", async () => {
  const s = memStorage();
  resetThemeTryOnStateForTests();
  await assert.rejects(() => tool(s, "confirm_theme").run({}, ctx));
});

test("preview_theme validates its inputs", async () => {
  const s = memStorage();
  resetThemeTryOnStateForTests();
  await assert.rejects(() => tool(s, "preview_theme").run({}, ctx));
  await assert.rejects(() => tool(s, "preview_theme").run({ seed: { primary: "red" } }, ctx));
  await assert.rejects(() => tool(s, "preview_theme").run({ mode: "neon" }, ctx));
  await assert.rejects(() =>
    tool(s, "preview_theme").run({ css: ".surface-nope { bg: #112233; }" }, ctx),
  );
});

const GOOD_CSS = ".surface-card { bg: #112233; radius: 8; }";

test("creative CSS tools: replace/read/append/edit/insert/delete", async () => {
  const s = memStorage();
  assert.equal(await tool(s, "read_theme_css").run({}, ctx), "No custom theme CSS set.");

  await tool(s, "replace_theme_css").run({ css: GOOD_CSS }, ctx);
  assert.equal(readBundle(s).css, GOOD_CSS);
  assert.equal(await tool(s, "read_theme_css").run({}, ctx), GOOD_CSS);

  await tool(s, "append_theme_css").run({ css: ".surface-accent { bg: #445566; }" }, ctx);
  const appended = readBundle(s).css as string;
  assert.ok(appended.includes(GOOD_CSS) && appended.includes(".surface-accent"));

  await tool(s, "edit_theme_css").run({ oldText: "#112233", newText: "#aabbcc" }, ctx);
  assert.ok((readBundle(s).css as string).includes("#aabbcc"));
  assert.ok(!(readBundle(s).css as string).includes("#112233"));

  await tool(s, "insert_theme_css").run(
    { anchor: ".surface-accent", css: ".surface-text { fg: #778899; }" },
    ctx,
  );
  const inserted = readBundle(s).css as string;
  assert.ok(inserted.indexOf(".surface-text") > inserted.indexOf(".surface-accent"));

  await tool(s, "delete_theme_css").run({}, ctx);
  assert.ok(!("css" in readBundle(s)), "css key really removed");
  assert.equal(await tool(s, "read_theme_css").run({}, ctx), "No custom theme CSS set.");
});

test("creative CSS tools reject invalid CSS (blockingIssues: nothing applied)", async () => {
  const s = memStorage();
  const before = s._map.get(THEME_KEY) ?? null;
  await assert.rejects(() =>
    tool(s, "replace_theme_css").run({ css: ".surface-nope { bg: #112233; }" }, ctx),
  );
  await assert.rejects(() =>
    tool(s, "replace_theme_css").run({ css: ".surface-card { bg: red; }" }, ctx),
  );
  await assert.rejects(() =>
    tool(s, "replace_theme_css").run({ css: ".surface-card { background: #112233; }" }, ctx),
  );
  await assert.rejects(() => tool(s, "append_theme_css").run({ css: "@import url(evil);" }, ctx));
  assert.equal(s._map.get(THEME_KEY) ?? null, before, "rejected CSS changed nothing");
  await assert.rejects(() =>
    tool(s, "edit_theme_css").run({ oldText: "missing", newText: "x" }, ctx),
  );
  await assert.rejects(() =>
    tool(s, "insert_theme_css").run({ anchor: "missing", css: GOOD_CSS }, ctx),
  );
});
