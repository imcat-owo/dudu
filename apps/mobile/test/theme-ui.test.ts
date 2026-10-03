/**
 * ui.tsx theme migration — reactivity test.
 *
 * The migration replaces the old static `colors` / `s` exports with two hooks,
 * useColors() and useStyles(), computed from ThemeContext tokens (+ the
 * font-size setting). This test proves the reactive chain end to end:
 *
 *  1. pipeline: deriveSurfaces(seed) -> paletteFromTokens -> createThemedStyles
 *     yields different rendered style values for different presets, with text
 *     colors never pure black/white and font scale applied;
 *  2. provider: a component mounted inside ThemeProvider that reads useColors()
 *     / useStyles() actually re-renders with new style values after
 *     stageBundle() and applyBundle() with a different preset, and rollback()
 *     restores the previously confirmed styles.
 *
 * react-native and friends are stubbed via node module customization hooks
 * (test harness only); react-test-renderer loads from an isolated /tmp install
 * so the repo's package.json is untouched.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement as h, type ReactNode } from "react";
import { act, create } from "react-test-renderer";
import { deriveSurfaces } from "../src/theme/derive.ts";
import { PRESETS } from "../src/theme/presets.ts";
import { ThemeProvider, useTheme } from "../src/theme/ThemeContext.tsx";
import type { ThemeBundle } from "../src/theme/types.ts";
import { createThemedStyles, paletteFromTokens, useColors, useStyles } from "../src/ui.tsx";

// react-test-renderer has no bundled types in this repo; describe the sliver
// of its API this test uses so tsc stays happy (runtime comes from the harness).
declare module "react-test-renderer" {
  export function create(element: unknown): { unmount(): void };
  export function act<T>(fn: () => T | Promise<T>): Promise<T>;
}

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const NOT_PURE_BW = /^(#000000|#ffffff)$/i;
const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/;

function bgOf(style: unknown): string {
  return (style as { backgroundColor: string }).backgroundColor;
}
function fgOf(style: unknown): string {
  return (style as { color: string }).color;
}
function fsOf(style: unknown): number {
  return (style as { fontSize: number }).fontSize;
}

describe("ui theme migration", () => {
  it("pipeline: different presets produce different rendered styles", () => {
    const light = PRESETS[0]; // mint-frost, light
    const dark = PRESETS[3]; // lavender-night, dark
    const palL = paletteFromTokens(deriveSurfaces(light.seed, "light"), "light");
    const palD = paletteFromTokens(deriveSurfaces(dark.seed, "dark"), "dark");
    assert.notEqual(palL.card, palD.card, "card follows theme");
    assert.notEqual(palL.text, palD.text, "text follows theme");
    assert.notEqual(palL.blue, palD.blue, "accent follows theme");
    assert.notEqual(palL.danger, palD.danger, "danger adapts to mode");

    const sL = createThemedStyles(palL, 1);
    const sD = createThemedStyles(palD, 1);
    assert.notEqual(bgOf(sL.card), bgOf(sD.card), "rendered card bg changes");
    assert.notEqual(fgOf(sL.text), fgOf(sD.text), "rendered text color changes");
    assert.notEqual(bgOf(sL.primary), bgOf(sD.primary), "rendered button bg changes");
    assert.notEqual(bgOf(sL.input), bgOf(sD.input), "rendered input bg changes");

    for (const [name, st] of [
      ["light", sL],
      ["dark", sD],
    ] as const) {
      // buttonText intentionally has no color: Button passes color inline
      // (same as the pre-migration stylesheet), so it is not asserted here.
      for (const key of ["text", "muted", "small", "title", "heading", "chipText"] as const) {
        const c = fgOf(st[key]);
        assert.match(c, HEX, `${name}.${key} is a hex color`);
        assert.doesNotMatch(c, NOT_PURE_BW, `${name}.${key} must not be pure black/white`);
      }
    }

    const sScaled = createThemedStyles(palL, 0.88);
    assert.ok(
      fsOf(sScaled.text) < fsOf(sL.text),
      `font scale applies (0.88): ${fsOf(sScaled.text)} < ${fsOf(sL.text)}`,
    );
  });

  it("provider: stage/apply/rollback repaint a mounted themed component", async () => {
    let seen: Record<string, string> = {};
    function Probe(): ReactNode {
      const colors = useColors();
      const s = useStyles();
      seen = {
        cardBg: bgOf(s.card),
        textColor: fgOf(s.text),
        primaryBg: bgOf(s.primary),
        blue: colors.blue,
        danger: colors.danger,
      };
      return null;
    }
    let api: {
      stageBundle: (b: ThemeBundle) => boolean;
      applyBundle: (b: ThemeBundle) => Promise<boolean>;
      rollback: () => Promise<void>;
    } | null = null;
    function Grab(): ReactNode {
      api = useTheme();
      return null;
    }

    let root: { unmount(): void } | undefined;
    await act(async () => {
      root = create(h(ThemeProvider, null, h(Probe), h(Grab)));
    });
    try {
      assert.ok(api, "grabbed theme api from context");
      const before = { ...seen };
      assert.ok(before.cardBg, "probe captured initial styles");

      await act(async () => {
        assert.equal(api?.stageBundle(PRESETS[3]), true, "stageBundle accepts preset");
      });
      assert.notEqual(seen.cardBg, before.cardBg, "stageBundle repaints card bg");
      assert.notEqual(seen.textColor, before.textColor, "stageBundle repaints text");
      assert.notEqual(seen.blue, before.blue, "stageBundle repaints accent");
      const staged = { ...seen };

      await act(async () => {
        assert.equal(await api?.applyBundle(PRESETS[4]), true, "applyBundle accepts preset");
      });
      assert.notEqual(seen.cardBg, staged.cardBg, "applyBundle repaints card bg");
      // danger is a fixed-hue semantic red (seed-independent by design, same as
      // the pre-migration static palette); it only varies by light/dark mode,
      // which the pipeline test covers. Assert it stays a valid themed color.
      assert.match(seen.danger, HEX, "danger is a valid hex after applyBundle");
      assert.doesNotMatch(seen.danger, NOT_PURE_BW, "danger is not pure black/white");

      await act(async () => {
        await api?.rollback();
      });
      assert.equal(seen.cardBg, before.cardBg, "rollback restores confirmed card bg");
      assert.equal(seen.textColor, before.textColor, "rollback restores confirmed text");
    } finally {
      root?.unmount();
    }
  });
});
