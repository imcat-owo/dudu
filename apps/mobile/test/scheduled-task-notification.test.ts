/**
 * D10: scheduled-task notifications carry a data payload so the tap can
 * deep-link to the tasks section (copies the outreach pattern).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type ScheduledTask,
  scheduledTaskDeepLink,
  taskNotificationContent,
} from "../src/platform/scheduled-tasks.js";

function task(over: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: "task-123",
    title: "Drink water",
    message: "Time for water",
    nextFireAt: Date.now() + 3600_000,
    recurrence: "daily",
    timeOfDay: "09:00",
    enabled: true,
    createdAt: Date.now(),
    notificationIds: [],
    ...over,
  };
}

describe("taskNotificationContent", () => {
  it("carries title and body from the task", () => {
    const c = taskNotificationContent(task());
    assert.equal(c.title, "Drink water");
    assert.equal(c.body, "Time for water");
  });

  it("data has kind scheduled_task and the task id", () => {
    const c = taskNotificationContent(task({ id: "abc-999" }));
    assert.equal(c.data.kind, "scheduled_task");
    assert.equal(c.data.taskId, "abc-999");
  });

  it("data is a plain JSON-serializable object", () => {
    const c = taskNotificationContent(task());
    assert.equal(
      JSON.stringify(c.data),
      JSON.stringify({ kind: "scheduled_task", taskId: "task-123" }),
    );
  });
});

describe("scheduledTaskDeepLink", () => {
  it("lands on the appearance section, tasks subsection", () => {
    const link = scheduledTaskDeepLink();
    assert.equal(link.section, "appearance");
    assert.equal(link.sectionId, "tasks");
  });
});
