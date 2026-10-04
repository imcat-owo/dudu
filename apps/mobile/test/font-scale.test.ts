/**
 * TText font-size scaling (ui P2-1, round 3) — unit tests for the pure
 * scaleTextStyle helper. TText is the SINGLE place the font-size setting
 * takes effect: the shared stylesheet and all component styles carry BASE
 * sizes, and TText scales fontSize/lineHeight exactly once at render time.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scaleTextStyle } from "../src/text-scale.js";

describe("scaleTextStyle", () => {
  it("scale 1 is a no-op (same reference)", () => {
    const s = { fontSize: 15, lineHeight: 23, color: "red" };
    assert.equal(scaleTextStyle(s, 1), s);
  });

  it("scales fontSize and lineHeight together", () => {
    const out = scaleTextStyle({ fontSize: 15, lineHeight: 23 }, 0.88);
    assert.equal(out?.fontSize, 13.2);
    assert.equal(out?.lineHeight, 20.2);
  });

  it("scales large option", () => {
    const out = scaleTextStyle({ fontSize: 20 }, 1.15);
    assert.equal(out?.fontSize, 23);
  });

  it("leaves other properties untouched", () => {
    const out = scaleTextStyle(
      { fontSize: 15, color: "red", fontWeight: "600", textAlign: "center" } as never,
      0.88,
    );
    assert.equal((out as { color: string }).color, "red");
    assert.equal((out as { fontWeight: string }).fontWeight, "600");
  });

  it("handles missing fontSize/lineHeight", () => {
    const out = scaleTextStyle({ color: "red" } as never, 0.88);
    assert.equal((out as { color: string }).color, "red");
    assert.ok(!("fontSize" in (out as object)));
  });

  it("handles null/undefined", () => {
    assert.equal(scaleTextStyle(null, 0.88), null);
    assert.equal(scaleTextStyle(undefined, 0.88), undefined);
  });

  it("rounds to one decimal like the old fs() helper", () => {
    const out = scaleTextStyle({ fontSize: 13 }, 0.88);
    assert.equal(out?.fontSize, 11.4);
  });
});
