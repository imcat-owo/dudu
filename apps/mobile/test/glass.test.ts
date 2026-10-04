import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";

// react-native / expo-blur can't load under plain tsx (Flow syntax), so stub
// the imports before the module under test is required. ThemeContext is
// stubbed too — it pulls in AsyncStorage and half the app.
const originalLoad = (Module as any)._load;
(Module as any)._load = function (request: string, ...rest: unknown[]) {
  if (request === "react-native") {
    return {
      AccessibilityInfo: {
        isReduceTransparencyEnabled: async () => false,
        addEventListener: () => ({ remove: () => {} }),
      },
      StyleSheet: { flatten: (s: unknown) => s, absoluteFill: {} },
      View: "View",
    };
  }
  if (request === "expo-blur") {
    return { BlurView: "BlurView" };
  }
  if (request.endsWith("/theme/ThemeContext") || request === "./theme/ThemeContext") {
    return { useTheme: () => ({ resolvedMode: "light", tokens: { overlay: { bg: "#fafafa" } } }) };
  }
  if (request.endsWith("/theme/radii")) {
    return { radii: { xs: 6 } };
  }
  if (request.endsWith("/accessibility")) {
    return { useReduceTransparency: () => false };
  }
  return originalLoad.call(this, request, ...rest);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolveGlassFill, GlassView } = require("../src/glass") as typeof import("../src/glass");

test("reduce-transparency off → blur renders (no solid fill)", () => {
  assert.deepEqual(resolveGlassFill(false, "#fafafa"), { kind: "blur" });
});

test("reduce-transparency on → solid fill from the theme overlay token", () => {
  assert.deepEqual(resolveGlassFill(true, "#1a1a1a"), {
    kind: "solid",
    backgroundColor: "#1a1a1a",
  });
});

test("solid fallback uses the passed theme token, never a hardcoded grey", () => {
  const light = resolveGlassFill(true, "#faf8f2");
  const dark = resolveGlassFill(true, "#14161a");
  assert.equal(light.kind, "solid");
  assert.equal(dark.kind, "solid");
  if (light.kind === "solid" && dark.kind === "solid") {
    assert.equal(light.backgroundColor, "#faf8f2");
    assert.equal(dark.backgroundColor, "#14161a");
    assert.ok(!["#888", "#888888", "#999999", "#ccc", "#cccccc"].includes(light.backgroundColor));
  }
});

test("GlassView wires the system reduce-transparency hook and overlay token", () => {
  assert.equal(typeof GlassView, "function");
  const src = readFileSync(join(dirname(__filename), "..", "src", "glass.tsx"), "utf8");
  assert.ok(src.includes("useReduceTransparency"), "must read the OS reduce-transparency switch");
  assert.ok(src.includes("tokens.overlay.bg"), "solid fallback must come from theme tokens");
  assert.ok(
    src.includes("resolveGlassFill(reduceTransparency"),
    "component must branch on the switch",
  );
});
