import "./helpers/rn-stub.js";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { clearCrashReports, readCrashReports } from "../src/crash-report.js";

/**
 * Fake the RN-global ErrorUtils BEFORE the module under test loads.
 * Loaded with require() (not static import) so the fake is installed
 * first — static imports hoist past it.
 */
type Handler = (error: Error, isFatal?: boolean) => void;
let installed: Handler | null = null;
const prevCalls: { error: Error; isFatal?: boolean }[] = [];
const fakePrev: Handler = (error, isFatal) => {
  prevCalls.push({ error, isFatal });
};
(globalThis as Record<string, unknown>).ErrorUtils = {
  getGlobalHandler: () => installed,
  setGlobalHandler: (h: Handler) => {
    installed = h;
  },
};

const require = createRequire(__filename);
const { installJSGlobalHandler } = require("../src/js-global-handler.js") as {
  installJSGlobalHandler: () => void;
};

test("install is idempotent and chains the previous handler", async () => {
  await clearCrashReports();
  installed = fakePrev;
  prevCalls.length = 0;
  installJSGlobalHandler();
  installJSGlobalHandler(); // second call must be a no-op
  assert.ok(installed, "handler installed");
  const err = new Error("converted NSException boom");
  installed(err, true);
  // Give the async recordCrashReport a tick.
  await new Promise((r) => setTimeout(r, 20));
  const reports = await readCrashReports();
  assert.equal(reports.length, 1);
  assert.equal(reports[0].message, "converted NSException boom");
  assert.equal(reports[0].label, "fatal-js");
  assert.equal(prevCalls.length, 1, "previous handler chained exactly once");
  assert.equal(prevCalls[0].error, err);
  await clearCrashReports();
});

test("non-fatal errors get the js-global label", async () => {
  await clearCrashReports();
  const handler = installed;
  assert.ok(handler, "handler from previous test persists (same process)");
  handler(new Error("soft"), false);
  await new Promise((r) => setTimeout(r, 20));
  const reports = await readCrashReports();
  assert.equal(reports.length, 1);
  assert.equal(reports[0].label, "js-global");
  await clearCrashReports();
});
