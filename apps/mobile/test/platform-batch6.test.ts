/**
 * Batch 6 (H) platform tests.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  advanceTask,
  computeNextFire,
  type ScheduledTask,
} from "../src/platform/scheduled-tasks.js";
import { type PendingShare, shareToPrompt } from "../src/platform/share-intake.js";
import { buildSiriLink, parseSiriLink } from "../src/platform/siri-shortcuts.js";
import { buildWidgetData } from "../src/platform/widget-data.js";

describe("scheduled tasks", () => {
  it("computes next daily fire tomorrow when time passed", () => {
    const from = new Date("2026-10-05T10:00:00").getTime();
    const next = computeNextFire({ timeOfDay: "09:00", recurrence: "daily", from });
    const d = new Date(next);
    assert.equal(d.getDate(), 6);
    assert.equal(d.getHours(), 9);
  });

  it("computes next daily fire today when time not passed", () => {
    const from = new Date("2026-10-05T08:00:00").getTime();
    const next = computeNextFire({ timeOfDay: "09:00", recurrence: "daily", from });
    const d = new Date(next);
    assert.equal(d.getDate(), 5);
    assert.equal(d.getHours(), 9);
  });

  it("computes weekly fire on the right weekday", () => {
    // 2026-10-05 is a Monday (getDay()=1)
    const from = new Date("2026-10-05T10:00:00").getTime();
    const next = computeNextFire({ timeOfDay: "09:00", recurrence: "weekly", daySpec: 3, from });
    const d = new Date(next);
    assert.equal(d.getDay(), 3); // Wednesday
  });

  it("once task fires tomorrow when time passed today", () => {
    const from = new Date("2026-10-05T10:00:00").getTime();
    const next = computeNextFire({ timeOfDay: "09:00", recurrence: "once", from });
    const d = new Date(next);
    assert.equal(d.getDate(), 6);
  });

  it("advanceTask returns null for once tasks", () => {
    const task = {
      id: "1",
      title: "t",
      message: "m",
      nextFireAt: 0,
      recurrence: "once",
      timeOfDay: "09:00",
      enabled: true,
      createdAt: 0,
      notificationIds: [],
    } as ScheduledTask;
    assert.equal(advanceTask(task), null);
  });

  it("advanceTask moves daily forward", () => {
    const task = {
      id: "1",
      title: "t",
      message: "m",
      nextFireAt: 0,
      recurrence: "daily",
      timeOfDay: "09:00",
      enabled: true,
      createdAt: 0,
      notificationIds: [],
    } as ScheduledTask;
    const next = advanceTask(task, new Date("2026-10-05T10:00:00").getTime());
    assert.ok(next != null && next > Date.now() - 86400000);
  });
});

describe("siri links", () => {
  it("parses ask link", () => {
    const l = parseSiriLink("dudu://siri?action=ask&prompt=" + encodeURIComponent("hello"));
    assert.ok(l);
    assert.equal(l.action, "ask");
    assert.equal(l.prompt, "hello");
  });

  it("parses open link with dialog", () => {
    const l = parseSiriLink("dudu://siri?action=open&dialog=abc123");
    assert.ok(l);
    assert.equal(l.action, "open");
    assert.equal(l.dialogId, "abc123");
  });

  it("rejects non-siri links", () => {
    assert.equal(parseSiriLink("dudu://chat?id=1"), null);
    assert.equal(parseSiriLink("https://example.com"), null);
    assert.equal(parseSiriLink("dudu://siri?action=bogus"), null);
  });

  it("round-trips build/parse", () => {
    const built = buildSiriLink({ action: "ask", prompt: "test prompt", dialogId: "d1" });
    const parsed = parseSiriLink(built);
    assert.ok(parsed);
    assert.equal(parsed.action, "ask");
    assert.equal(parsed.prompt, "test prompt");
    assert.equal(parsed.dialogId, "d1");
  });
});

describe("widget data", () => {
  it("clamps progress and caps at 5 tasks", () => {
    const tasks = Array.from({ length: 8 }, (_, i) => ({
      id: `t${i}`,
      title: `Task ${i}`,
      progress: i === 0 ? 1.5 : 0.5,
      status: "running",
    }));
    const data = buildWidgetData(tasks, 3);
    assert.equal(data.tasks.length, 5);
    assert.equal(data.tasks[0].progress, 1);
    assert.equal(data.pendingCount, 3);
  });

  it("normalizes unknown status to running", () => {
    const data = buildWidgetData([{ id: "1", title: "t", progress: 0.1, status: "weird" }], 0);
    assert.equal(data.tasks[0].status, "running");
  });
});

describe("share intake", () => {
  it("splits text and attachments", () => {
    const share: PendingShare = {
      items: [
        { kind: "text", value: "hello" },
        { kind: "url", value: "https://example.com" },
        { kind: "image", value: "", filePath: "/tmp/a.jpg", fileName: "a.jpg" },
      ],
      receivedAt: Date.now(),
    };
    const { text, attachments } = shareToPrompt(share);
    assert.ok(text.includes("hello"));
    assert.ok(text.includes("https://example.com"));
    assert.equal(attachments.length, 1);
    assert.equal(attachments[0].kind, "image");
  });
});
