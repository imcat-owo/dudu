import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AI_THEME_MODE_KEY,
  getAiThemeMode,
  isAiThemeMode,
  setAiThemeMode,
} from "../src/theme/ai-mode.js";

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      m.set(k, v);
    },
  };
}

describe("ai-theme-mode", () => {
  it("defaults to stable when unset", async () => {
    assert.equal(await getAiThemeMode(memoryStorage()), "stable");
  });

  it("defaults to stable when corrupt", async () => {
    const s = memoryStorage();
    await s.setItem(AI_THEME_MODE_KEY, "nonsense");
    assert.equal(await getAiThemeMode(s), "stable");
  });

  it("round-trips stable/creative/off", async () => {
    const s = memoryStorage();
    for (const mode of ["stable", "creative", "off"] as const) {
      await setAiThemeMode(s, mode);
      assert.equal(await getAiThemeMode(s), mode);
    }
  });

  it("isAiThemeMode validates", () => {
    assert.ok(isAiThemeMode("stable"));
    assert.ok(isAiThemeMode("creative"));
    assert.ok(isAiThemeMode("off"));
    assert.ok(!isAiThemeMode("x"));
    assert.ok(!isAiThemeMode(null));
    assert.ok(!isAiThemeMode(undefined));
  });
});
