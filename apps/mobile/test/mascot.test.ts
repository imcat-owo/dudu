import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clampMascotIndex,
  DEFAULT_MASCOT_INDEX,
  MASCOT_COUNT,
  MASCOT_STICKER_FILES,
} from "../src/mascot.js";

describe("mascot token model", () => {
  it("has exactly 10 stickers", () => {
    assert.equal(MASCOT_COUNT, 10);
    assert.equal(MASCOT_STICKER_FILES.length, 10);
  });

  it("filenames are devil-01.jpg … devil-10.jpg in order", () => {
    MASCOT_STICKER_FILES.forEach((f, i) => {
      assert.equal(f, `devil-${String(i + 1).padStart(2, "0")}.jpg`);
    });
  });

  it("default index is 0 (devil-01.jpg, the default assistant face)", () => {
    assert.equal(DEFAULT_MASCOT_INDEX, 0);
  });

  it("clampMascotIndex keeps indices in range", () => {
    assert.equal(clampMascotIndex(0), 0);
    assert.equal(clampMascotIndex(9), 9);
    assert.equal(clampMascotIndex(-3), 0);
    assert.equal(clampMascotIndex(99), 9);
    assert.equal(clampMascotIndex(4.7), 4);
    assert.equal(clampMascotIndex(Number.NaN), DEFAULT_MASCOT_INDEX);
    assert.equal(clampMascotIndex(Number.POSITIVE_INFINITY), DEFAULT_MASCOT_INDEX);
  });
});
