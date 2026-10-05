import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enStrings } from "../src/i18n/en.js";
import { resolveLocale } from "../src/i18n/locale.js";
import { zhHansStrings } from "../src/i18n/zh-Hans.js";

describe("resolveLocale", () => {
  it("maps Simplified Chinese variants to zh-Hans", () => {
    for (const tag of ["zh", "zh-Hans", "zh-CN", "zh-SG", "ZH-cn"]) {
      assert.equal(resolveLocale(tag), "zh-Hans", tag);
    }
  });
  it("maps Traditional Chinese variants to zh-Hant", () => {
    for (const tag of ["zh-Hant", "zh-TW", "zh-HK", "zh-MO", "ZH-tw"]) {
      assert.equal(resolveLocale(tag), "zh-Hant", tag);
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
  it("zh-Hant covers every zh-Hans key", async () => {
    const { zhHantStrings } = await import("../src/i18n/zh-Hant.js");
    const zhKeys = Object.keys(zhHansStrings);
    for (const key of zhKeys) {
      assert.ok(
        typeof (zhHantStrings as Record<string, string>)[key] === "string" &&
          (zhHantStrings as Record<string, string>)[key].length > 0,
        `zh-Hant is missing key: ${key}`,
      );
    }
  });
  it("zh-Hant has no extra keys beyond zh-Hans", async () => {
    const { zhHantStrings } = await import("../src/i18n/zh-Hant.js");
    for (const key of Object.keys(zhHantStrings)) {
      assert.ok(key in zhHansStrings, `zh-Hant has extra key: ${key}`);
    }
  });
});
