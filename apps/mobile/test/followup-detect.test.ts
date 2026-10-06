/**
 * Memory-driven next-day follow-up （次日跟进） — detection tests.
 *
 * Under test: Chinese relative-date parsing (Shanghai wall clock),
 * event extraction, and the conservative nulls (no date / no what /
 * same-day states like "今天好累").
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectFollowup } from "../src/followup/detect.js";

// Tue 2026-10-06 20:00 Shanghai.
const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);
// Wed 2026-10-07 00:00 Shanghai.
const WED_START = Date.UTC(2026, 9, 6, 16, 0, 0);

describe("detectFollowup", () => {
  it("detects 明天 + event noun", () => {
    const d = detectFollowup("我明天有个面试", NOW);
    assert.ok(d);
    assert.equal(d.what, "面试");
    assert.equal(d.eventDateMs, WED_START);
    assert.equal(d.eventLabel, "明天");
    // Day after the event, 17:00 Shanghai = Thu 2026-10-08 09:00 UTC.
    assert.equal(d.followUpAtMs, Date.UTC(2026, 9, 8, 9, 0, 0));
    assert.ok(d.keywords.includes("面试"));
  });

  it("detects 下周三 (next week's Wednesday)", () => {
    // Tue 10-06 → next Wed is 10-14 (+8 days).
    const d = detectFollowup("下周三要去看牙", NOW);
    assert.ok(d);
    assert.equal(d.what, "看牙");
    assert.equal(d.eventDateMs, Date.UTC(2026, 9, 13, 16, 0, 0));
  });

  it("detects 周五 (this week's Friday)", () => {
    const d = detectFollowup("周五交稿", NOW);
    assert.ok(d);
    assert.equal(d.what, "交稿");
    assert.equal(d.eventDateMs, Date.UTC(2026, 9, 8, 16, 0, 0));
  });

  it("detects explicit month/day, rolling to next year when past", () => {
    const d = detectFollowup("5月20号和朋友去迪士尼", NOW);
    assert.ok(d);
    // 2026-05-20 is past → 2027-05-20 00:00 Shanghai = 2027-05-19 16:00 UTC.
    assert.equal(d.eventDateMs, Date.UTC(2027, 4, 19, 16, 0, 0));
    assert.equal(d.what, "朋友去迪士尼");
  });

  it("detects 后天", () => {
    const d = detectFollowup("后天去看牙", NOW);
    assert.ok(d);
    assert.equal(d.what, "看牙");
    assert.equal(d.eventDateMs, WED_START + 86_400_000);
  });

  it("detects 大后天", () => {
    const d = detectFollowup("大后天要出差", NOW);
    assert.ok(d);
    assert.equal(d.what, "出差");
    assert.equal(d.eventDateMs, WED_START + 2 * 86_400_000);
  });

  it("detects 今天 only with a real event noun", () => {
    const d = detectFollowup("今天下午有个面试", NOW);
    assert.ok(d);
    assert.equal(d.what, "面试");
    assert.equal(d.eventDateMs, Date.UTC(2026, 9, 5, 16, 0, 0));
  });

  it("returns null for same-day states without an event noun", () => {
    assert.equal(detectFollowup("今天好累", NOW), null);
    assert.equal(detectFollowup("今天很开心", NOW), null);
  });

  it("returns null when there is no date", () => {
    assert.equal(detectFollowup("我想你了", NOW), null);
    assert.equal(detectFollowup("面试好难", NOW), null);
  });

  it("returns null for past dates", () => {
    assert.equal(detectFollowup("昨天去面试了", NOW), null);
  });

  it("returns null for empty input", () => {
    assert.equal(detectFollowup("", NOW), null);
    assert.equal(detectFollowup("   ", NOW), null);
  });

  it("never throws on garbage", () => {
    assert.doesNotThrow(() => detectFollowup("！！！12345@#$%", NOW));
  });
});
