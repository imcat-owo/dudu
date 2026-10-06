import "./helpers/rn-stub.js";
import assert from "node:assert/strict";
import test from "node:test";
import { bootMark, clearBootLog, readBootLog } from "../src/bootlog.js";

test("marks are recorded in order", async () => {
  await clearBootLog();
  await bootMark("app-launch");
  await bootMark("splash-done");
  await bootMark("chatscreen-mounted");
  const marks = await readBootLog();
  assert.deepEqual(
    marks.map((m) => m.name),
    ["app-launch", "splash-done", "chatscreen-mounted"],
  );
  assert.ok(marks[0].t <= marks[1].t && marks[1].t <= marks[2].t);
  await clearBootLog();
});

test("ring buffer caps at 60 entries, oldest first", async () => {
  await clearBootLog();
  for (let i = 0; i < 65; i++) {
    await bootMark(`mark-${i}`);
  }
  const marks = await readBootLog();
  assert.equal(marks.length, 60);
  assert.equal(marks[0].name, "mark-5");
  assert.equal(marks[59].name, "mark-64");
  await clearBootLog();
});

test("clearBootLog empties the log", async () => {
  await bootMark("x");
  await clearBootLog();
  assert.deepEqual(await readBootLog(), []);
});

test("startup bisection sequence is representable", async () => {
  await clearBootLog();
  // The exact sequence a healthy launch records.
  for (const name of [
    "app-launch",
    "splash-done",
    "localapp-mounted",
    "chatscreen-mounted",
    "webview-skipped",
  ]) {
    await bootMark(name);
  }
  const marks = await readBootLog();
  assert.ok(marks.some((m) => m.name === "webview-skipped"));
  assert.ok(!marks.some((m) => m.name === "webview-mounted"));
  await clearBootLog();
});
