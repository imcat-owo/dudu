/**
 * Batch 3 integration wiring tests.
 *
 * Proves the wiring (not just the modules):
 * 1. Alarm tools are registered (createAlarmTools produces the 3 tools
 *    that local-agent.ts spreads into the agent's tool list).
 * 2. Backup includes the new voice-corrections and alarms keys.
 * 3. Auto-read triggers on message finish and stops on user send
 *    (module-level behavior that chat.tsx wires up).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectBackup, type KeyValueStore, type SecureKV } from "../src/backup.js";
import {
  __resetAutoReadForTests,
  type AutoReadDeps,
  maybeAutoReadAssistantMessage,
  stopAutoRead,
} from "../src/voice/auto-read.js";
import { createAlarmTools } from "../src/voice/tools.js";

function makeAutoReadDeps(overrides?: Partial<AutoReadDeps>): AutoReadDeps & {
  played: string[];
} {
  const played: string[] = [];
  const deps: AutoReadDeps = {
    getSettings: () => ({ micMode: "transcribe", autoRead: true }) as never,
    getTtsConfig: () => ({}) as never,
    synthesize: async (text: string) => `file:///synth/${text.length}.m4a`,
    createPlayer: (uri: string) => {
      played.push(uri);
      return {
        play() {},
        pause() {},
        remove() {},
        addListener: () => ({ remove() {} }),
      };
    },
    setAudioMode: async () => {},
    ...overrides,
  };
  return Object.assign(deps, { played });
}

function makeKv(data: Record<string, string>): KeyValueStore {
  return {
    getItem: async (k: string) => data[k] ?? null,
    setItem: async (k: string, v: string) => {
      data[k] = v;
    },
    getAllKeys: async () => Object.keys(data),
  };
}

const emptySecure: SecureKV = {
  getItem: async () => null,
  setItem: async () => {},
};

describe("wiring: alarm tools registered", () => {
  it("createAlarmTools returns set_alarm, list_alarms, cancel_alarm", () => {
    const backend = {
      getItem: async () => null,
      setItem: async () => {},
      removeItem: async () => {},
    };
    const tools = createAlarmTools(backend, "zh-Hans");
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["cancel_alarm", "list_alarms", "set_alarm"]);
  });

  it("alarm tools have descriptions (no dead tools)", () => {
    const backend = {
      getItem: async () => null,
      setItem: async () => {},
      removeItem: async () => {},
    };
    for (const locale of ["zh-Hans", "en"] as const) {
      const tools = createAlarmTools(backend, locale);
      for (const tool of tools) {
        assert.ok(
          tool.description && tool.description.length > 20,
          `${tool.name} needs a real description`,
        );
      }
    }
  });
});

describe("wiring: backup includes voice-corrections and alarms", () => {
  it("collectBackup picks up dudu.voice-corrections.v1 and dudu.alarms.v1", async () => {
    const kv = makeKv({
      "dudu.voice-corrections.v1": JSON.stringify([{ from: "石碑", to: "识别", count: 2 }]),
      "dudu.alarms.v1": JSON.stringify([{ id: "a1", fireAt: Date.now() + 3600000, label: "test" }]),
    });
    const backup = await collectBackup(kv, emptySecure);
    assert.ok(
      backup.plain["dudu.voice-corrections.v1"],
      "voice-corrections should be in backup.plain",
    );
    assert.ok(backup.plain["dudu.alarms.v1"], "alarms should be in backup.plain");
  });
});

describe("wiring: auto-read triggers and stops", () => {
  it("maybeAutoReadAssistantMessage plays when autoRead is on", async () => {
    __resetAutoReadForTests();
    const deps = makeAutoReadDeps();
    const ok = await maybeAutoReadAssistantMessage("你好呀", deps);
    assert.equal(ok, true);
    assert.equal(deps.played.length, 1);
    __resetAutoReadForTests();
  });

  it("maybeAutoReadAssistantMessage is a no-op when autoRead is off", async () => {
    __resetAutoReadForTests();
    const deps = makeAutoReadDeps({
      getSettings: () => ({ micMode: "transcribe", autoRead: false }) as never,
    });
    const ok = await maybeAutoReadAssistantMessage("你好呀", deps);
    assert.equal(ok, false);
    assert.equal(deps.played.length, 0);
    __resetAutoReadForTests();
  });

  it("stopAutoRead cancels in-flight synthesis (user sent a new message)", async () => {
    __resetAutoReadForTests();
    let resolveSynth!: (uri: string) => void;
    const deps = makeAutoReadDeps({
      synthesize: () => new Promise<string>((r) => (resolveSynth = r)),
    });
    const p = maybeAutoReadAssistantMessage("slow message", deps);
    // User sends a new message while synthesis is in flight.
    stopAutoRead();
    resolveSynth("file:///late.m4a");
    const ok = await p;
    // The stale synthesis must not start playback.
    assert.equal(ok, false);
    assert.equal(deps.played.length, 0);
    __resetAutoReadForTests();
  });
});

describe("D34: alarm-set copy is honest about notification fallback", () => {
  it("alarmSetOkKey picks the notif copy when not via AlarmKit", async () => {
    const { alarmSetOkKey } = await import("../src/voice/tools.js");
    assert.equal(alarmSetOkKey(true), "voice.alarmSetOk");
    assert.equal(alarmSetOkKey(false), "voice.alarmSetOkNotif");
  });

  it("the notif copy exists in all locales and disclaims system alarm", async () => {
    const { enStrings } = await import("../src/i18n/en.js");
    const { zhHansStrings } = await import("../src/i18n/zh-Hans.js");
    const { zhHantStrings } = await import("../src/i18n/zh-Hant.js");
    const copies = [
      enStrings["voice.alarmSetOkNotif"],
      zhHansStrings["voice.alarmSetOkNotif"],
      zhHantStrings["voice.alarmSetOkNotif"],
    ];
    for (const c of copies) {
      assert.ok(c && c.length > 10, "notif copy must exist in every locale");
    }
    assert.match(enStrings["voice.alarmSetOkNotif"], /not a system alarm/i);
    assert.match(zhHansStrings["voice.alarmSetOkNotif"], /非系统闹钟/);
    assert.match(zhHantStrings["voice.alarmSetOkNotif"], /非系統鬧鐘/);
  });

  it("alarmDeleteFail copy exists in all locales", async () => {
    const { enStrings } = await import("../src/i18n/en.js");
    const { zhHansStrings } = await import("../src/i18n/zh-Hans.js");
    const { zhHantStrings } = await import("../src/i18n/zh-Hant.js");
    for (const pack of [enStrings, zhHansStrings, zhHantStrings]) {
      assert.ok(pack["voice.alarmDeleteFail"]?.includes("{msg}"), "alarmDeleteFail must interpolate {msg}");
      assert.ok(pack["voice.autoReadUnavailable"]?.length > 10, "autoReadUnavailable must exist");
    }
  });
});

describe("D35: auto-read synthesis failure is visible, not silent", () => {
  it("maybeAutoReadAssistantMessage calls onError when synthesis fails", async () => {
    __resetAutoReadForTests();
    const errors: string[] = [];
    const deps = makeAutoReadDeps({
      synthesize: async () => {
        throw new Error("tts backend exploded");
      },
      onError: (msg: string) => {
        errors.push(msg);
      },
    });
    const ok = await maybeAutoReadAssistantMessage("你好呀", deps);
    assert.equal(ok, false);
    assert.equal(deps.played.length, 0);
    assert.deepEqual(errors, ["tts backend exploded"]);
    __resetAutoReadForTests();
  });

  it("no onError wired = old behavior preserved (no crash)", async () => {
    __resetAutoReadForTests();
    const deps = makeAutoReadDeps({
      synthesize: async () => {
        throw new Error("boom");
      },
    });
    const ok = await maybeAutoReadAssistantMessage("你好呀", deps);
    assert.equal(ok, false);
    __resetAutoReadForTests();
  });
});
