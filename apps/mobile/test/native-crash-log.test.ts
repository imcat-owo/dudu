import "./helpers/rn-stub.js";
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import test from "node:test";

/**
 * In-memory expo-file-system/legacy stand-in. Installed by wrapping
 * Module._load AFTER rn-stub (each test file runs in its own process,
 * so the extra wrap cannot leak). The module under test is loaded with
 * require() AFTER the wrap — static import would hoist past the patch.
 */
const files = new Map<string, string>();
const fsStub = {
  cacheDirectory: "file:///cache/",
  getInfoAsync: async (uri: string) => ({ exists: files.has(uri), uri }),
  readAsStringAsync: async (uri: string) => {
    const v = files.get(uri);
    if (v === undefined) throw new Error("not found");
    return v;
  },
};

const mod = Module as unknown as { _load: (...a: unknown[]) => unknown };
const prevLoad = mod._load;
mod._load = function (request: unknown, ...rest: unknown[]) {
  if (request === "expo-file-system/legacy") return fsStub;
  return prevLoad.call(this, request, ...rest);
};

const require = createRequire(__filename);
const { readNativeCrashLog } = require("../src/native-crash-log.js") as {
  readNativeCrashLog: () => Promise<string[]>;
};

test("missing native log file → empty array, never throws", async () => {
  files.clear();
  assert.deepEqual(await readNativeCrashLog(), []);
});

test("present file → last 40 lines, blanks filtered", async () => {
  files.clear();
  const lines = Array.from({ length: 50 }, (_, i) => `line-${i}`);
  lines.splice(10, 0, "", "   ");
  files.set("file:///cache/dudu-native-crash.log", lines.join("\n"));
  const out = await readNativeCrashLog();
  assert.equal(out.length, 40);
  assert.equal(out[0], "line-10");
  assert.equal(out[39], "line-49");
  assert.ok(!out.some((l) => l.trim().length === 0), "no blank lines");
});

test("short file → all lines", async () => {
  files.clear();
  files.set(
    "file:///cache/dudu-native-crash.log",
    "[t] NSEXCEPTION name=NSInternalInconsistencyException reason=boom\n[t]   frame#0 0x123\n",
  );
  const out = await readNativeCrashLog();
  assert.equal(out.length, 2);
  assert.ok(out[0].includes("NSEXCEPTION"), "exception line preserved");
});
