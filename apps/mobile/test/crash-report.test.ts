import "./helpers/rn-stub.js";
import assert from "node:assert/strict";
import test from "node:test";
import { clearCrashReports, readCrashReports, recordCrashReport } from "../src/crash-report.js";

test("crash reports round-trip: message + stack + label + timestamp", async () => {
  await clearCrashReports();
  const err = new Error("boom in ChatScreen");
  err.stack = "Error: boom in ChatScreen\n    at render (chat.tsx:10:5)";
  await recordCrashReport(err, "chat");
  const reports = await readCrashReports();
  assert.equal(reports.length, 1);
  assert.equal(reports[0].message, "boom in ChatScreen");
  assert.equal(reports[0].label, "chat");
  assert.ok(reports[0].stack.includes("chat.tsx:10:5"), "stack preserved");
  assert.ok(typeof reports[0].t === "number" && reports[0].t > 0, "timestamp recorded");
  await clearCrashReports();
});

test("ring buffer caps at 10 entries, oldest first", async () => {
  await clearCrashReports();
  for (let i = 0; i < 12; i++) {
    await recordCrashReport(new Error(`err-${i}`));
  }
  const reports = await readCrashReports();
  assert.equal(reports.length, 10);
  assert.equal(reports[0].message, "err-2");
  assert.equal(reports[9].message, "err-11");
  await clearCrashReports();
});

test("non-Error values are recorded honestly, never throws", async () => {
  await clearCrashReports();
  await recordCrashReport("a plain string blew up");
  await recordCrashReport(undefined);
  const reports = await readCrashReports();
  assert.equal(reports.length, 2);
  assert.equal(reports[0].message, "a plain string blew up");
  await clearCrashReports();
  assert.deepEqual(await readCrashReports(), [], "clear works");
});
