import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { resolveMode } from "../src/theme/derive.js";
import { DEFAULT_PRESET_ID, defaultPreset, getPreset, PRESETS } from "../src/theme/presets.js";

// Same source-reading pattern as test/backup.test.ts: URL -> pathname string.
const TEST_DIR = new URL(".", import.meta.url).pathname;
const APP_TSX = join(TEST_DIR, "..", "App.tsx");
const THEME_CTX = join(TEST_DIR, "..", "src", "theme", "ThemeContext.tsx");

describe("C4: default theme + follow iOS system appearance", () => {
  it("fresh install defaults to the sora-gray preset", () => {
    assert.equal(DEFAULT_PRESET_ID, "preset-sora-gray");
    assert.equal(getPreset(DEFAULT_PRESET_ID).id, "preset-sora-gray");
    assert.equal(defaultPreset.id, "preset-sora-gray");
  });

  it("every built-in preset follows the system appearance", () => {
    assert.ok(PRESETS.length >= 6, "expected at least 6 built-in presets");
    for (const p of PRESETS) {
      assert.equal(p.mode, "system", `${p.id} must follow the system, not pin light/dark`);
    }
  });

  it("system mode resolves with the OS scheme", () => {
    assert.equal(resolveMode("system", true), "dark");
    assert.equal(resolveMode("system", false), "light");
  });

  it("an explicit light/dark bundle choice still wins over the system", () => {
    assert.equal(resolveMode("light", true), "light");
    assert.equal(resolveMode("dark", false), "dark");
  });

  it("no hardcoded dark StatusBar remains in the app shell", () => {
    const appShell = readFileSync(APP_TSX, "utf8");
    assert.ok(
      !/style=["']dark["']/.test(appShell),
      'App.tsx must not hardcode StatusBar style="dark"',
    );
    assert.ok(
      appShell.includes("<ThemedStatusBar />"),
      "App.tsx must render ThemedStatusBar instead",
    );
  });

  it("ThemedStatusBar derives its style from the resolved theme", () => {
    const ctx = readFileSync(THEME_CTX, "utf8");
    assert.ok(ctx.includes("export function ThemedStatusBar"), "ThemedStatusBar must be exported");
    assert.ok(
      ctx.includes('resolvedMode === "dark" ? "light" : "dark"'),
      "ThemedStatusBar must map resolvedMode to the StatusBar style",
    );
  });
});
