import assert from "node:assert/strict";
import { test } from "node:test";
import { makeThemeBundle } from "../src/theme/derive.js";
import {
  bundleFitsQr,
  exportBundleJson,
  parseImportBundle,
  QR_MAX_BYTES,
  stripLocalUris,
} from "../src/theme/share.js";

function sample() {
  return makeThemeBundle({
    id: "test-1",
    name: "Test",
    seed: { primary: "#3f9b8a" },
    mode: "light",
  });
}

test("exportBundleJson round-trips through parseImportBundle", () => {
  const json = exportBundleJson(sample());
  const result = parseImportBundle(json);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.bundle.id, "test-1");
});

test("parseImportBundle rejects empty / non-JSON / wrong-kind loudly", () => {
  assert.equal(parseImportBundle("   ").ok, false);
  assert.equal(
    parseImportBundle("   ") && (parseImportBundle("   ") as { code: string }).code,
    "empty",
  );
  const notJson = parseImportBundle("{oops");
  assert.equal(notJson.ok, false);
  assert.equal((notJson as { code: string }).code, "not-json");
  const wrongKind = parseImportBundle(JSON.stringify({ kind: "nope", version: 1 }));
  assert.equal(wrongKind.ok, false);
  assert.equal((wrongKind as { code: string }).code, "invalid-bundle");
});

test("parseImportBundle ignores unknown fields (forward compat)", () => {
  const json = JSON.stringify({ ...JSON.parse(exportBundleJson(sample())), future: 123 });
  const result = parseImportBundle(json);
  assert.equal(result.ok, true);
});

test("bundleFitsQr guards oversized payloads", () => {
  assert.equal(bundleFitsQr(exportBundleJson(sample())), true);
  assert.equal(bundleFitsQr("x".repeat(QR_MAX_BYTES + 1)), false);
});

test("stripLocalUris removes file:// wallpaper/avatar and reports what", () => {
  const b = {
    ...sample(),
    wallpaper: { uri: "file:///local/w.png", fit: "cover" as const, dim: 0.3 },
    avatar: { user: "file:///local/u.png", assistant: "https://x/y.png" },
  };
  const { bundle, stripped } = stripLocalUris(b);
  assert.deepEqual(stripped.sort(), ["avatar.user", "wallpaper"]);
  assert.equal(bundle.wallpaper, undefined);
  assert.equal(bundle.avatar?.user, undefined);
  assert.equal(bundle.avatar?.assistant, "https://x/y.png");
});
