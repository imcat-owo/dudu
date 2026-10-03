import assert from "node:assert/strict";
import { test } from "node:test";
import { hexToHsv, hsvToHex } from "../src/color.js";

test("hsvToHex produces known colors", () => {
  assert.equal(hsvToHex(0, 1, 1), "#ff0000");
  assert.equal(hsvToHex(120, 1, 1), "#00ff00");
  assert.equal(hsvToHex(240, 1, 1), "#0000ff");
  assert.equal(hsvToHex(0, 0, 1), "#ffffff");
  assert.equal(hsvToHex(0, 0, 0), "#000000");
  assert.equal(hsvToHex(360, 1, 1), "#ff0000"); // wraps
});

test("hexToHsv round-trips", () => {
  for (const hex of ["#3f9b8a", "#cf6a4d", "#9b8afb", "#808080", "#ffffff"]) {
    const { h, s, v } = hexToHsv(hex);
    assert.equal(hsvToHex(h, s, v), hex);
  }
});

test("hexToHsv handles achromatic", () => {
  const { s, v } = hexToHsv("#808080");
  assert.ok(Math.abs(s) < 0.01);
  assert.ok(Math.abs(v - 0.502) < 0.01);
});
