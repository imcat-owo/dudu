/**
 * D22: alarm management backend — setEnabled toggle + reschedule.
 *
 * The settings UI's switches all hit the real store; these tests pin the
 * store behavior: disable cancels native scheduling but keeps the record,
 * enable re-schedules, reschedule moves the time, and everything fails
 * loudly with honest messages.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type Alarm,
  type AlarmKitNative,
  type NotificationsNative,
  createAlarmStore,
} from "../src/voice/alarms.js";

function memBackend() {
  const m = new Map<string, string>();
  return {
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: async (k: string) => {
      m.delete(k);
    },
    // Test helper: write raw records straight into storage.
    raw: m,
  };
}

interface KitLog {
  scheduled: Array<{ fireAt: number; label: string }>;
  cancelled: string[];
}

function kitDeps(log: KitLog): {
  alarmKit: () => Promise<AlarmKitNative>;
  notifications: () => Promise<NotificationsNative | null>;
} {
  let n = 0;
  return {
    alarmKit: async () => ({
      isAvailable: () => true,
      requestAuthorization: async () => true,
      scheduleAlarm: async (fireAt: number, label: string) => {
        log.scheduled.push({ fireAt, label });
        n += 1;
        return `kit-${n}`;
      },
      cancelAlarm: async (id: string) => {
        log.cancelled.push(id);
      },
      listAlarms: async () => [],
    }),
    notifications: async () => null,
  };
}

function newLog(): KitLog {
  return { scheduled: [], cancelled: [] };
}

describe("alarms: setEnabled toggle", () => {
  it("disable cancels the native alarm but keeps the record", async () => {
    const backend = memBackend();
    const log = newLog();
    const store = createAlarmStore({ backend, ...kitDeps(log) });
    const alarm = await store.schedule(Date.now() + 3600_000, "起床");

    const updated = await store.setEnabled(alarm.id, false);
    assert.equal(updated.enabled, false);
    assert.deepEqual(log.cancelled, [alarm.id]);

    const list = await store.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].enabled, false);
    assert.equal(list[0].label, "起床");
  });

  it("disable is idempotent — no double native cancel", async () => {
    const backend = memBackend();
    const log = newLog();
    const store = createAlarmStore({ backend, ...kitDeps(log) });
    const alarm = await store.schedule(Date.now() + 3600_000, "起床");

    await store.setEnabled(alarm.id, false);
    await store.setEnabled(alarm.id, false);
    assert.deepEqual(log.cancelled, [alarm.id]);
  });

  it("enable re-schedules a disabled alarm natively", async () => {
    const backend = memBackend();
    const log = newLog();
    const store = createAlarmStore({ backend, ...kitDeps(log) });
    const alarm = await store.schedule(Date.now() + 3600_000, "吃药");
    await store.setEnabled(alarm.id, false);
    const scheduledBefore = log.scheduled.length;

    const updated = await store.setEnabled(alarm.id, true);
    assert.equal(updated.enabled, true);
    assert.equal(log.scheduled.length, scheduledBefore + 1);
    assert.deepEqual(log.scheduled[log.scheduled.length - 1], {
      fireAt: alarm.fireAt,
      label: "吃药",
    });
  });

  it("enable fails honestly when the time has passed", async () => {
    const backend = memBackend();
    const log = newLog();
    const store = createAlarmStore({ backend, ...kitDeps(log) });
    const past: Alarm = {
      id: "old-1",
      fireAt: Date.now() - 3600_000,
      label: "过期",
      viaAlarmKit: false,
      enabled: false,
      createdAt: Date.now() - 7200_000,
    };
    await backend.setItem("dudu.alarms.v1", JSON.stringify([past]));

    await assert.rejects(() => store.setEnabled("old-1", true), /时间已经过了/);
    // Nothing was scheduled, record untouched.
    assert.equal(log.scheduled.length, 0);
    const list = await store.list();
    assert.equal(list[0].enabled, false);
  });

  it("setEnabled on a missing id fails loudly", async () => {
    const backend = memBackend();
    const log = newLog();
    const store = createAlarmStore({ backend, ...kitDeps(log) });
    await assert.rejects(() => store.setEnabled("nope", false), /找不到这个闹钟/);
  });
});

describe("alarms: reschedule", () => {
  it("moves an enabled alarm: old native cancelled, new one scheduled", async () => {
    const backend = memBackend();
    const log = newLog();
    const store = createAlarmStore({ backend, ...kitDeps(log) });
    const alarm = await store.schedule(Date.now() + 3600_000, "起床");
    const newFireAt = Date.now() + 7200_000;

    const updated = await store.reschedule(alarm.id, newFireAt);
    assert.equal(updated.fireAt, newFireAt);
    assert.equal(updated.label, "起床");
    assert.equal(updated.enabled, true);
    // Old native alarm cancelled, new one scheduled.
    assert.deepEqual(log.cancelled, [alarm.id]);
    assert.equal(log.scheduled.length, 2);
    assert.equal(log.scheduled[1].fireAt, newFireAt);
    // Still exactly one record.
    assert.equal((await store.list()).length, 1);
  });

  it("reschedule can change the label too", async () => {
    const backend = memBackend();
    const log = newLog();
    const store = createAlarmStore({ backend, ...kitDeps(log) });
    const alarm = await store.schedule(Date.now() + 3600_000, "起床");

    const updated = await store.reschedule(alarm.id, Date.now() + 7200_000, "吃药");
    assert.equal(updated.label, "吃药");
    assert.equal(log.scheduled[1].label, "吃药");
  });

  it("reschedule on a disabled alarm moves the time but stays off", async () => {
    const backend = memBackend();
    const log = newLog();
    const store = createAlarmStore({ backend, ...kitDeps(log) });
    const alarm = await store.schedule(Date.now() + 3600_000, "起床");
    await store.setEnabled(alarm.id, false);
    const scheduledBefore = log.scheduled.length;

    const newFireAt = Date.now() + 7200_000;
    const updated = await store.reschedule(alarm.id, newFireAt);
    assert.equal(updated.fireAt, newFireAt);
    assert.equal(updated.enabled, false);
    // Nothing scheduled natively — it's still off.
    assert.equal(log.scheduled.length, scheduledBefore);
  });

  it("reschedule keeps the old alarm intact when the new schedule fails", async () => {
    const backend = memBackend();
    const log = newLog();
    const deps = kitDeps(log);
    // The initial schedule succeeds; every later native schedule throws
    // (permission revoked between taps — the P2 lying-state scenario).
    let calls = 0;
    const store = createAlarmStore({
      backend,
      alarmKit: async () => {
        const kit = await deps.alarmKit();
        const orig = kit.scheduleAlarm;
        return {
          ...kit,
          scheduleAlarm: async (fireAt: number, label: string) => {
            calls += 1;
            if (calls > 1) throw new Error("permission revoked");
            return orig(fireAt, label);
          },
        };
      },
      notifications: deps.notifications,
    });
    const alarm = await store.schedule(Date.now() + 3600_000, "起床");

    await assert.rejects(
      () => store.reschedule(alarm.id, Date.now() + 7200_000),
      /叫不醒|不可用/,
    );
    // Record untouched: still enabled, still the old time, same native id.
    const kept = (await store.list())[0];
    assert.equal(kept.enabled, true);
    assert.equal(kept.fireAt, alarm.fireAt);
    assert.equal(kept.id, alarm.id);
    // Old native alarm was NOT cancelled — it still fires.
    assert.deepEqual(log.cancelled, []);
  });

  it("reschedule rejects past times loudly", async () => {
    const backend = memBackend();
    const log = newLog();
    const store = createAlarmStore({ backend, ...kitDeps(log) });
    const alarm = await store.schedule(Date.now() + 3600_000, "起床");

    await assert.rejects(() => store.reschedule(alarm.id, Date.now() - 1000), /未来/);
    // Old alarm untouched.
    assert.equal((await store.list())[0].fireAt, alarm.fireAt);
  });

  it("reschedule on a missing id fails loudly", async () => {
    const backend = memBackend();
    const log = newLog();
    const store = createAlarmStore({ backend, ...kitDeps(log) });
    await assert.rejects(
      () => store.reschedule("nope", Date.now() + 3600_000),
      /找不到这个闹钟/,
    );
  });
});

describe("alarms: disabled records survive list cleanup", () => {
  it("a disabled past alarm is kept; an enabled past one is dropped", async () => {
    const backend = memBackend();
    const log = newLog();
    const store = createAlarmStore({ backend, ...kitDeps(log) });
    const now = Date.now();
    const records: Alarm[] = [
      {
        id: "disabled-old",
        fireAt: now - 7200_000,
        label: "关掉的",
        viaAlarmKit: false,
        enabled: false,
        createdAt: now - 10800_000,
      },
      {
        id: "enabled-old",
        fireAt: now - 7200_000,
        label: "响过的",
        viaAlarmKit: false,
        enabled: true,
        createdAt: now - 10800_000,
      },
    ];
    await backend.setItem("dudu.alarms.v1", JSON.stringify(records));

    const list = await store.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "disabled-old");
  });

  it("old records without enabled default to enabled", async () => {
    const backend = memBackend();
    const log = newLog();
    const store = createAlarmStore({ backend, ...kitDeps(log) });
    const record = {
      id: "legacy-1",
      fireAt: Date.now() + 3600_000,
      label: "老的",
      viaAlarmKit: false,
      createdAt: Date.now(),
    };
    await backend.setItem("dudu.alarms.v1", JSON.stringify([record]));

    const list = await store.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].enabled, true);
  });
});
