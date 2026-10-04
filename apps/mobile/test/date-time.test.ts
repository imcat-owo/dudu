import assert from "node:assert/strict";
import test from "node:test";
import { deviceTimeLine, isCompleteInstant, localDateTime, zonedInstant } from "../src/date-time.ts";

test("deviceTimeLine labels the device timezone and includes the weekday (AI-use P2-1/P2-2)", () => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const line = deviceTimeLine(new Date("2026-10-05T04:00:00Z"));
  // Same clock the get_current_time tool reports: device tz, labelled.
  assert.ok(line.includes(`(${tz})`), `expected device tz label (${tz}), got: ${line}`);
  assert.ok(line.includes("星期"), `expected weekday in line, got: ${line}`);
  // Never a hardcoded foreign clock unless the device really is there.
  assert.ok(!line.includes("Asia/Shanghai") || tz === "Asia/Shanghai", `hardcoded Shanghai leak: ${line}`);
});

test("calendar time is rendered and entered in the selected named zone", () => {
  assert.deepEqual(localDateTime("2026-09-15T17:30:00Z", "America/Los_Angeles"), {
    date: "2026-09-15",
    time: "10:30",
  });
  assert.equal(
    zonedInstant("2026-09-15", "10:30", "America/Los_Angeles"),
    "2026-09-15T17:30:00.000Z",
  );
});
test("a zone crossing the UTC date boundary preserves the selected day", () => {
  assert.equal(zonedInstant("2026-09-15", "08:00", "Asia/Tokyo"), "2026-09-14T23:00:00.000Z");
});
test("invalid calendar dates and out-of-range times do not normalize silently", () => {
  assert.throws(() => zonedInstant("2026-02-31", "09:00", "UTC"));
  assert.throws(() => zonedInstant("2026-09-15", "25:00", "UTC"));
});
test("a daylight-saving gap cannot become a different appointment time", () => {
  assert.throws(() => zonedInstant("2026-03-08", "02:30", "America/Los_Angeles"), /does not exist/);
  assert.equal(
    zonedInstant("2026-03-08", "03:30", "America/Los_Angeles"),
    "2026-03-08T10:30:00.000Z",
  );
});

test("partial native date edits never normalize from Date.parse", () => {
  for (const value of [
    "2026-09-1 09:00",
    "2026-09-15 09:0",
    "2026-09-15 09:00",
    "2026-09-15T09:00",
  ])
    assert.equal(isCompleteInstant(value), false);
  assert.equal(isCompleteInstant("2026-09-15T17:30:00.000Z"), true);
  assert.equal(isCompleteInstant("2026-09-15T10:30:00-07:00"), true);
});
