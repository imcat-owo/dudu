import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatBytes } from "../src/voice/cache-cleanup.js";

describe("voice/cache-cleanup: formatBytes", () => {
  it("formats bytes in Chinese", () => {
    assert.equal(formatBytes(500, true), "500 字节");
    assert.equal(formatBytes(2048, true), "2.0 KB");
    assert.equal(formatBytes(3 * 1024 * 1024, true), "3.0 MB");
  });

  it("formats bytes in English", () => {
    assert.equal(formatBytes(500, false), "500 B");
    assert.equal(formatBytes(2048, false), "2.0 KB");
    assert.equal(formatBytes(3 * 1024 * 1024, false), "3.0 MB");
  });

  it("never emits emoji", () => {
    // eslint-disable-next-line no-control-regex
    const emoji = /[\u{1F000}-\u{1FAFF}\u2600-\u{27BF}]/u;
    assert.doesNotMatch(formatBytes(12345678, true), emoji);
    assert.doesNotMatch(formatBytes(12345678, false), emoji);
  });
});
