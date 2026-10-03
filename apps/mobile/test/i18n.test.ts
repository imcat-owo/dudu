import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enStrings } from "../src/i18n/en.js";
import { resolveLocale } from "../src/i18n/locale.js";
import { zhHansStrings } from "../src/i18n/zh-Hans.js";

describe("resolveLocale", () => {
  it("maps Chinese variants to zh-Hans", () => {
    for (const tag of ["zh", "zh-Hans", "zh-Hant", "zh-CN", "zh-HK", "zh-TW", "ZH-cn"]) {
      assert.equal(resolveLocale(tag), "zh-Hans", tag);
    }
  });
  it("maps English to en", () => {
    assert.equal(resolveLocale("en"), "en");
    assert.equal(resolveLocale("en-US"), "en");
  });
  it("falls back to en for other languages and missing tags", () => {
    assert.equal(resolveLocale("ja-JP"), "en");
    assert.equal(resolveLocale("fr-FR"), "en");
    assert.equal(resolveLocale(undefined), "en");
    assert.equal(resolveLocale(null), "en");
    assert.equal(resolveLocale(""), "en");
  });
});

describe("language packs", () => {
  it("en covers every zh-Hans key (fallback safety)", () => {
    const zhKeys = Object.keys(zhHansStrings);
    assert.ok(zhKeys.length > 0, "zh-Hans pack must not be empty");
    for (const key of zhKeys) {
      assert.ok(
        typeof (enStrings as Record<string, string>)[key] === "string" &&
          (enStrings as Record<string, string>)[key].length > 0,
        `en is missing key: ${key}`,
      );
    }
  });
  it("en has no extra keys beyond zh-Hans", () => {
    for (const key of Object.keys(enStrings)) {
      assert.ok(key in zhHansStrings, `en has extra key: ${key}`);
    }
  });
});
