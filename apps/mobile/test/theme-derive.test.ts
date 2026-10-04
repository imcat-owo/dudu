import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampFg, deriveSurfaces, normalizeHex } from "../src/theme/derive.js";
import { PRESETS } from "../src/theme/presets.js";
import { isThemeBundle, SURFACE_IDS } from "../src/theme/types.js";

const PURE_BLACK_OR_WHITE = /^(#000000|#ffffff)$/i;
const HEX6 = /^#[0-9a-f]{6}$/;

describe("deriveSurfaces", () => {
  it("returns all 8 surfaces with valid hex tokens in both modes", () => {
    for (const mode of ["light", "dark"] as const) {
      const surfaces = deriveSurfaces({ primary: "#6750a4" }, mode);
      assert.deepEqual(
        [...Object.keys(surfaces)].sort(),
        [...SURFACE_IDS].sort(),
        `mode=${mode}: must derive exactly the 8 surfaces`,
      );
      for (const id of SURFACE_IDS) {
        const s = surfaces[id];
        for (const key of ["bg", "fg", "accent"] as const) {
          assert.match(s[key], HEX6, `${mode}.${id}.${key} must be #rrggbb`);
        }
      }
    }
  });

  it("never emits pure black or pure white fg, across extreme seeds", () => {
    const seeds = [
      "#6750a4", // normal violet
      "#0b0b0c", // near-black
      "#f7f7f8", // near-white
      "#ff3b30", // vivid red
      "#808080", // mid gray (achromatic)
      "#1a2b1a", // very dark green
      "#e8d44d", // bright yellow
    ];
    for (const primary of seeds) {
      for (const mode of ["light", "dark"] as const) {
        const surfaces = deriveSurfaces({ primary }, mode);
        for (const id of SURFACE_IDS) {
          const fg = surfaces[id].fg;
          assert.ok(
            !PURE_BLACK_OR_WHITE.test(fg),
            `fg must not be pure black/white: seed=${primary} mode=${mode} surface=${id} fg=${fg}`,
          );
        }
      }
    }
  });

  it("clampFg keeps contrast without touching pure black/white", () => {
    // fg that starts as pure white on a light bg must be pulled into tonal range
    const fixed = clampFg("#f6eeff", "#ffffff");
    assert.ok(!PURE_BLACK_OR_WHITE.test(fixed), `clamped fg was ${fixed}`);
    assert.match(fixed, HEX6);
    // dark text on light bg keeps high contrast
    const dark = clampFg("#f6eeff", "#000000");
    assert.ok(!PURE_BLACK_OR_WHITE.test(dark), `clamped fg was ${dark}`);
  });

  it("normalizes short/uppercase hex and rejects garbage", () => {
    assert.equal(normalizeHex("#ABC"), "#aabbcc");
    assert.equal(normalizeHex("ff3b30"), "#ff3b30");
    assert.equal(normalizeHex("#F7F7F8"), "#f7f7f8");
    assert.throws(() => normalizeHex("not-a-color"));
    assert.throws(() => deriveSurfaces({ primary: "zzz" }, "light"));
  });
});

describe("presets", () => {
  it("ships 4–6 presets, mixing light and dark, all valid ThemeBundles", () => {
    assert.ok(
      PRESETS.length >= 4 && PRESETS.length <= 6,
      `expected 4–6 presets, got ${PRESETS.length}`,
    );
    const modes = new Set(PRESETS.map((p) => p.mode));
    assert.ok(modes.has("light"), "presets must include a light bundle");
    assert.ok(modes.has("dark"), "presets must include a dark bundle");
    for (const preset of PRESETS) {
      assert.ok(isThemeBundle(preset), `preset ${preset.id} failed validation`);
      assert.match(preset.name, /^theme\.preset\./, "preset name must be an i18n key");
      assert.ok(
        !PURE_BLACK_OR_WHITE.test(preset.surfaces.canvas.fg),
        `preset ${preset.id} canvas fg must not be pure black/white`,
      );
    }
  });

  it("rejects malformed bundles", () => {
    assert.equal(isThemeBundle(null), false);
    assert.equal(isThemeBundle({ kind: "dudu-theme-bundle" }), false);
    assert.equal(
      isThemeBundle({ ...PRESETS[0], surfaces: {} }),
      false,
      "missing surfaces must fail",
    );
    assert.equal(
      isThemeBundle({ ...PRESETS[0], avatar: { size: 8 } }),
      false,
      "avatar size below 12 must fail",
    );
    assert.equal(
      isThemeBundle({ ...PRESETS[0], avatar: { size: 200 } }),
      false,
      "avatar size above 96 must fail",
    );
    assert.ok(isThemeBundle({ ...PRESETS[0], avatar: { size: 30 } }), "avatar size 30 must pass");
  });
});

/**
 * P2-29: dark mode is a dedicated dark-first design, not the light recipes
 * tone-flipped. These tests pin the design principles:
 *  - elevation through lightness (canvas < card < input < aiBubble)
 *  - luminous restraint (dark colored fills are DEEPER than light ones,
 *    with bright text — they glow instead of glaring)
 *  - quiet text (bright but never pure white; strong contrast)
 */

/** Relative luminance of #rrggbb, 0 (black) .. 1 (white). */
function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe("dark design system (P2-29)", () => {
  const seeds = ["#3f9b8a", "#9b8afb", "#cf6a4d", "#5b9bd5"];
  for (const primary of seeds) {
    it(`elevation: canvas < card < input < aiBubble (seed ${primary})`, () => {
      const d = deriveSurfaces({ primary }, "dark");
      const lums = ["canvas", "card", "input", "aiBubble"].map((k) =>
        luminance(d[k as keyof typeof d].bg),
      );
      for (let i = 1; i < lums.length; i++) {
        assert.ok(
          lums[i] > lums[i - 1],
          `dark elevation broken for ${primary}: ${lums.map((l) => l.toFixed(3)).join(" < ")}`,
        );
      }
    });

    it(`luminous restraint: dark userBubble fill deeper than light, text bright (seed ${primary})`, () => {
      const dark = deriveSurfaces({ primary }, "dark").userBubble;
      const light = deriveSurfaces({ primary }, "light").userBubble;
      assert.ok(
        luminance(dark.bg) < luminance(light.bg),
        `dark userBubble bg must be deeper than light: dark=${dark.bg} light=${light.bg}`,
      );
      assert.ok(
        luminance(dark.fg) > 0.45,
        `dark userBubble text must be bright-on-deep: fg=${dark.fg}`,
      );
      assert.ok(
        contrast(dark.bg, dark.fg) >= 4.5,
        `dark userBubble contrast too low: ${contrast(dark.bg, dark.fg).toFixed(2)}`,
      );
    });

    it(`dark buttons stay readable without blooming (seed ${primary})`, () => {
      const a = deriveSurfaces({ primary }, "dark").accent;
      assert.ok(luminance(a.bg) < 0.55, `dark accent bg must stay below near-white glare: ${a.bg}`);
      assert.ok(
        contrast(a.bg, a.fg) >= 4.5,
        `dark accent contrast too low: ${contrast(a.bg, a.fg).toFixed(2)}`,
      );
    });

    it(`quiet text: bright but never pure white, strong contrast (seed ${primary})`, () => {
      const d = deriveSurfaces({ primary }, "dark");
      assert.ok(!PURE_BLACK_OR_WHITE.test(d.canvas.fg), `fg was ${d.canvas.fg}`);
      assert.ok(
        contrast(d.canvas.bg, d.canvas.fg) >= 7,
        `dark body contrast too low: ${contrast(d.canvas.bg, d.canvas.fg).toFixed(2)}`,
      );
    });
  }
});
