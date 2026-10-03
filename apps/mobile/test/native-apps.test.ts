/**
 * 原生应用授权 — pure logic tests.
 * Tests the capability definitions, status normalization, and tool auth gating.
 * Native modules are not available in node — checkers return "unavailable".
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getManual } from "../src/manuals/index.js";
import {
  checkAppleMusicStatus,
  checkCalendarStatus,
  checkContactsStatus,
  checkDeviceInfoStatus,
  checkHealthKitStatus,
  checkRemindersStatus,
  checkUnwired,
  formatBatteryState,
  getDeviceInfo,
  NATIVE_APP_ORDER,
  NATIVE_APPS,
} from "../src/native-apps.js";
import { createNativeAppTools } from "../src/native-apps-tools.js";

describe("native-apps definitions", () => {
  it("has 10 capabilities in a stable order", () => {
    assert.equal(NATIVE_APP_ORDER.length, 10);
    assert.ok(NATIVE_APP_ORDER.includes("apple-music"));
    assert.ok(NATIVE_APP_ORDER.includes("calendar"));
    assert.ok(NATIVE_APP_ORDER.includes("healthkit"));
    assert.ok(NATIVE_APP_ORDER.includes("device-info"));
  });

  it("every capability has a definition with i18n keys", () => {
    for (const id of NATIVE_APP_ORDER) {
      const def = NATIVE_APPS[id];
      assert.ok(def, `missing def for ${id}`);
      assert.ok(def.nameKey.startsWith("napp."), `bad nameKey for ${id}`);
      assert.ok(def.descKey.startsWith("napp."), `bad descKey for ${id}`);
    }
  });

  it("wired capabilities are the 6 with real packages", () => {
    const wired = NATIVE_APP_ORDER.filter((id) => NATIVE_APPS[id].wired);
    assert.deepEqual(
      wired.sort(),
      ["apple-music", "calendar", "contacts", "device-info", "healthkit", "reminders"].sort(),
    );
  });

  it("unwired capabilities have setup instructions", () => {
    const unwired = NATIVE_APP_ORDER.filter((id) => !NATIVE_APPS[id].wired);
    assert.ok(unwired.length > 0);
    for (const id of unwired) {
      assert.ok(NATIVE_APPS[id].setupKey, `missing setupKey for ${id}`);
    }
  });
});

describe("native-apps checkers (node: no native modules)", () => {
  it("unwired checkers return needs-setup", async () => {
    assert.equal(await checkUnwired(), "needs-setup");
  });

  it("calendar/contacts/reminders return unavailable without native module", async () => {
    // In node, require("expo-calendar") fails → "unavailable" (honest).
    assert.equal(await checkCalendarStatus(), "unavailable");
    assert.equal(await checkRemindersStatus(), "unavailable");
    assert.equal(await checkContactsStatus(), "unavailable");
  });

  it("healthkit returns unavailable without native module", async () => {
    assert.equal(await checkHealthKitStatus(), "unavailable");
  });

  it("apple-music checker does not throw", async () => {
    const status = await checkAppleMusicStatus();
    assert.ok(["granted", "denied", "undetermined", "unavailable"].includes(status));
  });
});

describe("native-apps tools", () => {
  it("creates 7 tools with unique names", () => {
    const tools = createNativeAppTools({});
    assert.equal(tools.length, 7);
    const names = tools.map((t) => t.name);
    assert.equal(new Set(names).size, 7);
    assert.ok(names.every((n) => n.startsWith("napp_")));
    assert.ok(names.includes("napp_battery_status"));
  });

  it("all tools point at the native-apps manual", () => {
    const tools = createNativeAppTools({});
    for (const tool of tools) {
      assert.equal(tool.manualId, "native-apps", `tool ${tool.name} missing manualId`);
    }
  });

  it("tools fail honestly when not authorized", async () => {
    const tools = createNativeAppTools({
      getAuthState: async () => "undetermined",
    });
    const cal = tools.find((t) => t.name === "napp_calendar_today");
    assert.ok(cal, "napp_calendar_today tool not found");
    await assert.rejects(() => cal.run({}, {} as never), /未授权/);
  });

  it("tools fail honestly when hooks are missing", async () => {
    const tools = createNativeAppTools({
      getAuthState: async () => "granted",
    });
    const cal = tools.find((t) => t.name === "napp_calendar_today");
    assert.ok(cal, "napp_calendar_today tool not found");
    // No listTodayEvents hook → empty list → honest "没安排"
    const result = await cal.run({}, {} as never);
    assert.ok(result.includes("没安排"));
  });

  it("napp_battery_status needs no auth and reports honestly", async () => {
    const tools = createNativeAppTools({
      getBatteryStatus: async () => ({
        batteryLevel: 82,
        batteryState: "charging",
        lowPowerMode: false,
        modelName: "iPhone 16",
        osName: "iOS",
        osVersion: "18.0",
        deviceName: null,
      }),
    });
    const tool = tools.find((t) => t.name === "napp_battery_status");
    assert.ok(tool, "napp_battery_status tool not found");
    const result = await tool.run({}, {} as never);
    assert.ok(result.includes("82%"), `unexpected: ${result}`);
    assert.ok(result.includes("正在充电"), `unexpected: ${result}`);
  });

  it("napp_battery_status fails honestly without the hook", async () => {
    const tools = createNativeAppTools({});
    const tool = tools.find((t) => t.name === "napp_battery_status");
    assert.ok(tool, "napp_battery_status tool not found");
    await assert.rejects(() => tool.run({}, {} as never), /读不到/);
  });

  it("napp_battery_status handles unknown battery gracefully", async () => {
    const tools = createNativeAppTools({
      getBatteryStatus: async () => ({
        batteryLevel: null,
        batteryState: "unknown",
        lowPowerMode: null,
        modelName: null,
        osName: null,
        osVersion: null,
        deviceName: null,
      }),
    });
    const tool = tools.find((t) => t.name === "napp_battery_status");
    assert.ok(tool, "napp_battery_status tool not found");
    const result = await tool.run({}, {} as never);
    assert.ok(typeof result === "string" && result.length > 0);
  });
});

describe("device-info checker (node: no native modules)", () => {
  it("returns unavailable without native modules", async () => {
    assert.equal(await checkDeviceInfoStatus(), "unavailable");
  });

  it("getDeviceInfo throws honestly without native modules", async () => {
    // In node, require("expo-battery")/require("expo-device") fail → throws.
    // Message language depends on test i18n locale — just assert it throws.
    await assert.rejects(() => getDeviceInfo());
  });

  it("formatBatteryState maps states to i18n keys", () => {
    assert.equal(formatBatteryState("charging"), "napp.deviceInfo.charging");
    assert.equal(formatBatteryState("full"), "napp.deviceInfo.full");
    assert.equal(formatBatteryState("unplugged"), "napp.deviceInfo.unplugged");
    assert.equal(formatBatteryState("unknown"), "napp.deviceInfo.unknown");
  });
});

describe("native-apps manual", () => {
  it("is registered and resolvable", () => {
    const manual = getManual("native-apps");
    assert.ok(manual, "native-apps manual not registered");
    assert.equal(manual.id, "native-apps");
  });

  it("every tool manualId resolves", () => {
    const tools = createNativeAppTools({});
    for (const tool of tools) {
      assert.ok(tool.manualId, `tool ${tool.name} missing manualId`);
      assert.ok(getManual(tool.manualId), `manual ${tool.manualId} not found for ${tool.name}`);
    }
  });
});
