import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createStore } from "../apps/server/src/db.ts";
import { parseThemeCss } from "../apps/server/src/theme/css.ts";
import { shiftSeed } from "../apps/server/src/theme/derive.ts";
import { clampAxis, feelWordToHex } from "../apps/server/src/theme/feel-words.ts";
import { themeToolsForOwner } from "../apps/server/src/theme/tools.ts";
import { ThemeStore } from "../apps/server/src/theme-routes.ts";

test("feelWordToHex passes hex through and resolves feel-words", () => {
  assert.equal(feelWordToHex("#3f9b8a"), "#3f9b8a");
  assert.equal(feelWordToHex("3F9B8A"), "#3f9b8a");
  assert.equal(feelWordToHex("abc"), "#aabbcc");
  assert.equal(feelWordToHex("薄荷偏青绿"), "#3f9b8a");
  assert.equal(feelWordToHex("minty teal"), "#3f9b8a");
  assert.equal(feelWordToHex("晚霞粉"), "#cf6a4d");
  assert.equal(feelWordToHex("not a color at all xyz"), null);
});

test("clampAxis clamps to [-5, 5]", () => {
  assert.equal(clampAxis(99), 5);
  assert.equal(clampAxis(-99), -5);
  assert.equal(clampAxis(2.5), 2.5);
});

test("parseThemeCss accepts surface token overrides", () => {
  const result = parseThemeCss(".surface-card { bg: #ffffff; radius: 20; }\n.surface-accent { bg: #ff0000; }");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.overrides.card, { bg: "#ffffff", radius: 20 });
    assert.deepEqual(result.overrides.accent, { bg: "#ff0000" });
  }
});

test("parseThemeCss rejects unknown selectors and bad values with line numbers", () => {
  const badSelector = parseThemeCss(".surface-card { bg: #ffffff; }\n.foo { bg: #000000; }");
  assert.equal(badSelector.ok, false);
  if (!badSelector.ok) assert.match(badSelector.error, /line 2/i);

  const badProp = parseThemeCss(".surface-card { position: absolute; }");
  assert.equal(badProp.ok, false);

  const blocked = parseThemeCss('.surface-card { bg: #ffffff; }\n/* x */\n.surface-text { background: url("evil.png"); }');
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.error, /blocked/i);
});

test("shiftSeed moves hue with emotion and stays a valid hex", () => {
  const shifted = shiftSeed("#3f9b8a", 5, 0);
  assert.match(shifted, /^#[0-9a-f]{6}$/);
  assert.notEqual(shifted, "#3f9b8a");
  assert.equal(shiftSeed("#3f9b8a", 0, 0), "#3f9b8a");
});

test("themeToolsForOwner filters by mode", async () => {
  const dir = await mkdtemp(join(tmpdir(), "theme-tools-"));
  try {
    const db = await createStore(dir);
    const owner = "owner-1";
    const names = (tools: { name: string }[]) => tools.map((t) => t.name);

    // Default mode is stable.
    let tools = await themeToolsForOwner(db, owner);
    let n = names(tools);
    assert.ok(n.includes("get_theme"));
    assert.ok(n.includes("apply_theme_coordinates"));
    assert.ok(n.includes("confirm_theme"));
    assert.ok(!n.includes("edit_theme_css"), "stable must not include creative CSS tools");
    assert.ok(!n.includes("extract_palette_from_image"));

    // Creative adds the CSS + palette tools.
    const store = new ThemeStore(db);
    await store.setMode(owner, "creative");
    tools = await themeToolsForOwner(db, owner);
    n = names(tools);
    assert.ok(n.includes("edit_theme_css"));
    assert.ok(n.includes("read_theme_css"));
    assert.ok(n.includes("extract_palette_from_image"));

    // Off hides everything.
    await store.setMode(owner, "off");
    tools = await themeToolsForOwner(db, owner);
    assert.deepEqual(tools, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
