/**
 * 原生应用授权 — pure logic tests.
 * Tests the capability definitions, status normalization, and tool auth gating.
 * Native modules are not available in node — checkers return "unavailable".
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkAppleMusicStatus,
  checkCalendarStatus,
  checkContactsStatus,
  checkHealthKitStatus,
  checkRemindersStatus,
  checkUnwired,
  NATIVE_APP_ORDER,
  NATIVE_APPS,
} from "../src/native-apps.js";
import { createNativeAppTools } from "../src/native-apps-tools.js";
import { getManual } from "../src/manuals/index.js";

describe("native-apps definitions", () => {
  it("has 9 capabilities in a stable order", () => {
    assert.equal(NATIVE_APP_ORDER.length, 9);
    assert.ok(NATIVE_APP_ORDER.includes("apple-music"));
    assert.ok(NATIVE_APP_ORDER.includes("calendar"));
    assert.ok(NATIVE_APP_ORDER.includes("healthkit"));
  });

  it("every capability has a definition with i18n keys", () => {
    for (const id of NATIVE_APP_ORDER) {
      const def = NATIVE_APPS[id];
      assert.ok(def, `missing def for ${id}`);
      assert.ok(def.nameKey.startsWith("napp."), `bad nameKey for ${id}`);
      assert.ok(def.descKey.startsWith("napp."), `bad descKey for ${id}`);
    }
  });

  it("wired capabilities are the 5 with real packages", () => {
    const wired = NATIVE_APP_ORDER.filter((id) => NATIVE_APPS[id].wired);
    assert.deepEqual(wired.sort(), ["apple-music", "calendar", "contacts", "healthkit", "reminders"].sort());
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
  it("creates 6 tools with unique names", () => {
    const tools = createNativeAppTools({});
    assert.equal(tools.length, 6);
    const names = tools.map((t) => t.name);
    assert.equal(new Set(names).size, 6);
    assert.ok(names.every((n) => n.startsWith("napp_")));
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
    const cal = tools.find((t) => t.name === "napp_calendar_today")!;
    await assert.rejects(() => cal.run({}, {} as never), /未授权/);
  });

  it("tools fail honestly when hooks are missing", async () => {
    const tools = createNativeAppTools({
      getAuthState: async () => "granted",
    });
    const cal = tools.find((t) => t.name === "napp_calendar_today")!;
    // No listTodayEvents hook → empty list → honest "没安排"
    const result = await cal.run({}, {} as never);
    assert.ok(result.includes("没安排"));
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
      assert.ok(getManual(tool.manualId!), `manual ${tool.manualId} not found for ${tool.name}`);
    }
  });
});
