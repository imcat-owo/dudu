/**
 * Coding loop — store tests (PURE).
 *
 * Hard guarantees under test:
 * 1. Invalid plans are rejected (missing title/request/outcome/criteria/steps).
 * 2. propose → "proposed"; decide(true) → "approved"; decide(false) → "rejected".
 * 3. decide() on a non-proposed task is a no-op (can't re-decide).
 * 4. recordVerify is bounded: MAX_VERIFY_ATTEMPTS then refuses.
 * 5. activeForThread returns the latest non-terminal task.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCodingStore } from "../src/coding/store.js";
import { MAX_VERIFY_ATTEMPTS } from "../src/coding/types.js";

function makeStore() {
  let n = 0;
  return createCodingStore(undefined, {
    now: () => 1_000_000 + n,
    newId: () => `ct_test${++n}`,
  });
}

const GOOD_INPUT = {
  title: "加个按钮",
  request: "在设置页加个按钮",
  steps: [{ title: "改 UI", detail: "加按钮", files: ["apps/mobile/src/x.ts"] }],
  expectedOutcome: "多一个按钮",
  doneCriteria: "按钮能点",
};

function fakeVerify(ok: boolean) {
  const c = (o: boolean) => ({ ok: o, output: o ? "ok" : "boom" });
  return {
    ok,
    tsc: c(ok),
    biome: c(true),
    tests: c(true),
    attempt: 0,
    summary: ok ? "pass" : "fail",
  };
}

describe("coding store", () => {
  it("rejects invalid plans", () => {
    const s = makeStore();
    assert.throws(() => s.propose("t1", { ...GOOD_INPUT, title: " " }), /titleRequired/);
    assert.throws(() => s.propose("t1", { ...GOOD_INPUT, request: "" }), /requestRequired/);
    assert.throws(() => s.propose("t1", { ...GOOD_INPUT, expectedOutcome: "" }), /outcomeRequired/);
    assert.throws(() => s.propose("t1", { ...GOOD_INPUT, doneCriteria: "" }), /criteriaRequired/);
    assert.throws(() => s.propose("t1", { ...GOOD_INPUT, steps: [] }), /stepsRequired/);
    assert.throws(
      () => s.propose("t1", { ...GOOD_INPUT, steps: [{ title: " " }] }),
      /stepsInvalid/,
    );
  });

  it("propose → proposed, decide approves/rejects", () => {
    const s = makeStore();
    const t = s.propose("thread1", GOOD_INPUT);
    assert.equal(t.status, "proposed");
    assert.ok(t.branch.startsWith("coding/"));
    assert.equal(t.steps.length, 1);
    assert.equal(t.steps[0].files[0], "apps/mobile/src/x.ts");

    const approved = s.decide(t.id, true);
    assert.equal(approved?.status, "approved");

    const t2 = s.propose("thread1", GOOD_INPUT);
    const rejected = s.decide(t2.id, false);
    assert.equal(rejected?.status, "rejected");
  });

  it("decide is a no-op once decided", () => {
    const s = makeStore();
    const t = s.propose("thread1", GOOD_INPUT);
    s.decide(t.id, true);
    const again = s.decide(t.id, false);
    assert.equal(again?.status, "approved");
  });

  it("recordVerify is bounded by MAX_VERIFY_ATTEMPTS", () => {
    const s = makeStore();
    const t = s.propose("thread1", GOOD_INPUT);
    for (let i = 1; i <= MAX_VERIFY_ATTEMPTS; i++) {
      assert.equal(s.recordVerify(t.id, fakeVerify(false)), true, `attempt ${i} accepted`);
      assert.equal(s.getTask(t.id)?.attempts, i);
      assert.equal(s.getTask(t.id)?.verify?.attempt, i);
    }
    assert.equal(s.recordVerify(t.id, fakeVerify(false)), false, "4th attempt refused");
    assert.equal(s.getTask(t.id)?.attempts, MAX_VERIFY_ATTEMPTS);
  });

  it("activeForThread returns the latest non-terminal task", () => {
    const s = makeStore();
    const a = s.propose("thread1", GOOD_INPUT);
    s.decide(a.id, false); // terminal
    const b = s.propose("thread1", GOOD_INPUT);
    assert.equal(s.activeForThread("thread1")?.id, b.id);
    assert.equal(s.activeForThread("other"), null);
  });

  it("complete sets the terminal state and report", () => {
    const s = makeStore();
    const t = s.propose("thread1", GOOD_INPUT);
    s.decide(t.id, true);
    s.recordVerify(t.id, fakeVerify(true));
    const done = s.complete(t.id, "done", "做完了");
    assert.equal(done?.status, "done");
    assert.match(done?.report ?? "", /做完了/);
  });

  it("touchFile dedupes and appendLog caps the log", () => {
    const s = makeStore();
    const t = s.propose("thread1", GOOD_INPUT);
    s.touchFile(t.id, "a.ts");
    s.touchFile(t.id, "a.ts");
    assert.deepEqual(s.getTask(t.id)?.touchedFiles, ["a.ts"]);
    for (let i = 0; i < 400; i++) s.appendLog(t.id, "run", `line ${i}`);
    assert.ok((s.getTask(t.id)?.log.length ?? 0) <= 300);
  });
});
