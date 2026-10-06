/**
 * Batch 3 (voice C) tests: TTS providers, STT presets, auto-read,
 * correction learning, alarms.
 *
 * Run with: npx tsx --test test/voice-batch3.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAlarmStore, validateAlarmTime } from "../src/voice/alarms.js";
import {
  __resetAutoReadForTests,
  maybeAutoReadAssistantMessage,
  stopAutoRead,
} from "../src/voice/auto-read.js";
import {
  CORRECTION_CONFIRM_THRESHOLD,
  createCorrectionStore,
  diffSegments,
} from "../src/voice/corrections.js";
import {
  base64ToBytes,
  hexToBytes,
  type ProviderCredentials,
  parseSseData,
  pcmToWav,
  resolveProviderCredentials,
  synthesizeFishAudio,
  synthesizeMiniMax,
  synthesizeQwen,
  synthesizeStepFun,
} from "../src/voice/tts-providers.js";
import { STT_PRESET_DEFAULTS, validateSttConfig, validateTtsConfig } from "../src/voice/types.js";

// ---------------------------------------------------------------------------
// TTS providers
// ---------------------------------------------------------------------------

describe("tts-providers: pure helpers", () => {
  it("parseSseData extracts data payloads", () => {
    const sse = `data: {"a":1}\n\ndata: {"b":2}\n\ndata: [DONE]\n\n`;
    assert.deepEqual(parseSseData(sse), ['{"a":1}', '{"b":2}', "[DONE]"]);
  });

  it("parseSseData ignores comments and event lines", () => {
    const sse = `: comment\nevent: message\ndata: hello\n\n`;
    assert.deepEqual(parseSseData(sse), ["hello"]);
  });

  it("hexToBytes decodes hex", () => {
    assert.deepEqual(hexToBytes("4869"), new Uint8Array([0x48, 0x69]));
  });

  it("hexToBytes rejects malformed input", () => {
    assert.throws(() => hexToBytes("xyz"), /invalid hex/);
    assert.throws(() => hexToBytes("abc"), /invalid hex/); // odd length
  });

  it("base64ToBytes decodes base64", () => {
    assert.deepEqual(base64ToBytes("SGk="), new Uint8Array([0x48, 0x69]));
  });

  it("pcmToWav wraps PCM with a valid header", () => {
    const pcm = new Uint8Array([1, 2, 3, 4]);
    const wav = pcmToWav(pcm, 24000);
    assert.equal(wav.length, 44 + 4);
    // "RIFF" magic
    assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
    assert.equal(String.fromCharCode(...wav.slice(8, 12)), "WAVE");
    // sample rate at byte 24 (little-endian)
    const rate = wav[24] | (wav[25] << 8) | (wav[26] << 16) | (wav[27] << 24);
    assert.equal(rate, 24000);
    // PCM data preserved
    assert.deepEqual(wav.slice(44), pcm);
  });

  it("resolveProviderCredentials uses defaults when unset", () => {
    const cred = resolveProviderCredentials({
      provider: "minimax",
      voice: "v1",
      providerKey: "k",
    });
    assert.equal(cred.baseUrl, "https://api.minimaxi.com/v1");
    assert.equal(cred.model, "speech-2.8-turbo");
    assert.equal(cred.apiKey, "k");
  });

  it("resolveProviderCredentials honors overrides", () => {
    const cred = resolveProviderCredentials({
      provider: "qwen",
      voice: "v",
      providerKey: "k",
      providerUrl: "https://example.com/",
      providerModel: "my-model",
      rate: 1.5,
    });
    assert.equal(cred.baseUrl, "https://example.com/");
    assert.equal(cred.model, "my-model");
    assert.equal(cred.rate, 1.5);
  });
});

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    return handler(String(url), init ?? {});
  }) as typeof fetch;
}

const CRED: ProviderCredentials = {
  apiKey: "test-key",
  baseUrl: "https://example.com/v1",
  model: "test-model",
  voice: "test-voice",
  rate: 1.0,
};

describe("tts-providers: MiniMax", () => {
  it("POSTs to /t2a_v2 and decodes hex SSE audio", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchFn = mockFetch((url, init) => {
      seen.push({ url, init });
      const body = `data: {"data":{"audio":"4869"},"base_resp":{"status_code":0}}\n\ndata: [DONE]\n\n`;
      return new Response(body, { status: 200 });
    });
    const out = await synthesizeMiniMax("hello", CRED, fetchFn);
    assert.ok(seen[0].url.endsWith("/t2a_v2"), `url was ${seen[0].url}`);
    const headers = seen[0].init.headers as Record<string, string>;
    assert.equal(headers["Authorization"], "Bearer test-key");
    const reqBody = JSON.parse(seen[0].init.body as string) as { model: string; text: string };
    assert.equal(reqBody.model, "test-model");
    assert.equal(reqBody.text, "hello");
    assert.deepEqual(out.bytes, new Uint8Array([0x48, 0x69]));
    assert.equal(out.ext, "mp3");
  });

  it("throws on business error status_code", async () => {
    const fetchFn = mockFetch(() => {
      const body = `data: {"base_resp":{"status_code":1004,"status_msg":"auth failed"}}\n\n`;
      return new Response(body, { status: 200 });
    });
    await assert.rejects(() => synthesizeMiniMax("hi", CRED, fetchFn), /auth failed/);
  });

  it("throws on HTTP error", async () => {
    const fetchFn = mockFetch(() => new Response("nope", { status: 401 }));
    await assert.rejects(() => synthesizeMiniMax("hi", CRED, fetchFn), /HTTP 401/);
  });
});

describe("tts-providers: Fish Audio", () => {
  it("POSTs to /v1/tts with model header", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchFn = mockFetch((url, init) => {
      seen.push({ url, init });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    });
    const out = await synthesizeFishAudio("hello", CRED, fetchFn);
    assert.ok(seen[0].url.endsWith("/v1/tts"));
    const headers = seen[0].init.headers as Record<string, string>;
    assert.equal(headers["Authorization"], "Bearer test-key");
    assert.equal(headers["model"], "test-model");
    assert.equal(out.bytes.length, 3);
    assert.equal(out.ext, "mp3");
  });
});

describe("tts-providers: StepFun", () => {
  it("POSTs OpenAI-compatible /audio/speech", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchFn = mockFetch((url, init) => {
      seen.push({ url, init });
      return new Response(new Uint8Array([9, 9]), { status: 200 });
    });
    const out = await synthesizeStepFun("hello", CRED, fetchFn);
    assert.ok(seen[0].url.endsWith("/audio/speech"));
    const reqBody = JSON.parse(seen[0].init.body as string) as {
      model: string;
      input: string;
      voice: string;
    };
    assert.equal(reqBody.model, "test-model");
    assert.equal(reqBody.input, "hello");
    assert.equal(reqBody.voice, "test-voice");
    assert.equal(out.bytes.length, 2);
  });
});

describe("tts-providers: Qwen", () => {
  it("POSTs to DashScope and wraps PCM as WAV", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    // "AQID" base64 = bytes [1,2,3]
    const fetchFn = mockFetch((url, init) => {
      seen.push({ url, init });
      const body = `data: {"output":{"audio":{"data":"AQID"}}}\n\ndata: [DONE]\n\n`;
      return new Response(body, { status: 200 });
    });
    const out = await synthesizeQwen("hello", CRED, fetchFn);
    assert.ok(seen[0].url.includes("/services/aigc/multimodal-generation/generation"));
    const headers = seen[0].init.headers as Record<string, string>;
    assert.equal(headers["X-DashScope-SSE"], "enable");
    assert.equal(out.ext, "wav");
    // WAV header + 3 PCM bytes
    assert.equal(out.bytes.length, 44 + 3);
    assert.deepEqual(out.bytes.slice(44), new Uint8Array([1, 2, 3]));
  });
});

describe("tts types: validation", () => {
  it("new providers require a key", () => {
    assert.equal(validateTtsConfig({ provider: "minimax", voice: "v" }), "ttsKeyRequired");
    assert.equal(validateTtsConfig({ provider: "minimax", voice: "v", providerKey: "k" }), null);
  });

  it("rejects malformed override URL", () => {
    assert.equal(
      validateTtsConfig({
        provider: "qwen",
        voice: "v",
        providerKey: "k",
        providerUrl: "not-a-url",
      }),
      "ttsUrlInvalid",
    );
  });

  it("edge-tts and custom validation unchanged", () => {
    assert.equal(validateTtsConfig({ provider: "edge-tts", voice: "" }), "voiceRequired");
    assert.equal(validateTtsConfig({ provider: "edge-tts", voice: "zh-CN-XiaoxiaoNeural" }), null);
  });
});

// ---------------------------------------------------------------------------
// STT presets
// ---------------------------------------------------------------------------

describe("stt types", () => {
  it("preset defaults exist", () => {
    assert.ok(STT_PRESET_DEFAULTS.dashscope.baseUrl.includes("dashscope"));
    assert.ok(STT_PRESET_DEFAULTS.stepfun.baseUrl.includes("stepfun"));
  });

  it("presets require a key", () => {
    assert.equal(validateSttConfig({ provider: "dashscope" }), "sttKeyRequired");
    assert.equal(validateSttConfig({ provider: "dashscope", presetKey: "k" }), null);
  });

  it("group and custom unchanged", () => {
    assert.equal(validateSttConfig({ provider: "group" }), null);
    assert.equal(validateSttConfig({ provider: "custom" }), "sttUrlRequired");
  });
});

// ---------------------------------------------------------------------------
// Auto-read
// ---------------------------------------------------------------------------

describe("auto-read", () => {
  function makeDeps(overrides?: Partial<Parameters<typeof maybeAutoReadAssistantMessage>[1]>) {
    const played: string[] = [];
    let playerReleased = false;
    const deps = {
      getSettings: () => ({
        micMode: "transcribe" as const,
        autoRead: true,
        emotionalTts: true,
        emotionPin: null,
      }),
      getTtsConfig: () => ({ provider: "edge-tts" as const, voice: "v" }),
      synthesize: async (text: string) => {
        played.push(text);
        return "file:///tmp/test.mp3";
      },
      createPlayer: () => ({
        play: () => {},
        pause: () => {},
        remove: () => {
          playerReleased = true;
        },
        addListener: (_e: string, _cb: (s: { isLoaded: boolean }) => void) => ({
          remove: () => {},
        }),
      }),
      setAudioMode: async () => {},
      ...overrides,
    };
    return { deps, played, wasReleased: () => playerReleased };
  }

  it("no-op when autoRead is off", async () => {
    __resetAutoReadForTests();
    const { deps, played } = makeDeps({
      getSettings: () => ({
        micMode: "transcribe" as const,
        autoRead: false,
        emotionalTts: true,
        emotionPin: null,
      }),
    });
    const ok = await maybeAutoReadAssistantMessage("hello", deps);
    assert.equal(ok, false);
    assert.equal(played.length, 0);
  });

  it("no-op on empty text", async () => {
    __resetAutoReadForTests();
    const { deps, played } = makeDeps();
    const ok = await maybeAutoReadAssistantMessage("   ", deps);
    assert.equal(ok, false);
    assert.equal(played.length, 0);
  });

  it("plays when enabled", async () => {
    __resetAutoReadForTests();
    const { deps, played } = makeDeps();
    const ok = await maybeAutoReadAssistantMessage("hello world", deps);
    assert.equal(ok, true);
    assert.deepEqual(played, ["hello world"]);
    stopAutoRead();
  });

  it("stopAutoRead prevents stale playback", async () => {
    __resetAutoReadForTests();
    let resolveSynth!: (uri: string) => void;
    const { deps, played } = makeDeps({
      synthesize: (text: string) =>
        new Promise<string>((res) => {
          played.push(text);
          resolveSynth = res;
        }),
    });
    const p = maybeAutoReadAssistantMessage("slow", deps);
    stopAutoRead(); // user sent a new message while synthesizing
    resolveSynth("file:///tmp/late.mp3");
    const ok = await p;
    assert.equal(ok, false, "stale synthesis must not play");
  });
});

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------

describe("corrections: diffSegments", () => {
  it("finds the changed span", () => {
    assert.deepEqual(diffSegments("把石碑给我", "把识别给我"), [["石碑", "识别"]]);
  });

  it("returns empty for identical text", () => {
    assert.deepEqual(diffSegments("same", "same"), []);
  });

  it("ignores full rewrites", () => {
    assert.deepEqual(diffSegments("a".repeat(20), "b".repeat(20)), []);
  });
});

describe("corrections: learn and apply", () => {
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
    };
  }

  it("learns after threshold, applies to new transcripts", async () => {
    const store = createCorrectionStore(memBackend());
    // First correction: learned but not yet applied.
    await store.learnCorrection("把石碑给我", "把识别给我");
    let r = await store.applyCorrections("石碑在哪里");
    assert.equal(r.text, "石碑在哪里", "single correction must not auto-apply");
    assert.equal(r.applied, 0);
    // Second correction: confirmed.
    await store.learnCorrection("石碑很好", "识别很好");
    r = await store.applyCorrections("石碑在哪里");
    assert.equal(r.text, "识别在哪里");
    assert.equal(r.applied, 1);
  });

  it("threshold constant is 2", () => {
    assert.equal(CORRECTION_CONFIRM_THRESHOLD, 2);
  });

  it("clear wipes the map", async () => {
    const store = createCorrectionStore(memBackend());
    await store.learnCorrection("把石碑给我", "把识别给我");
    await store.learnCorrection("把石碑给我", "把识别给我");
    await store.clear();
    const r = await store.applyCorrections("石碑");
    assert.equal(r.applied, 0);
  });
});

// ---------------------------------------------------------------------------
// Alarms
// ---------------------------------------------------------------------------

describe("alarms: validation", () => {
  const now = Date.now();
  it("rejects past times", () => {
    assert.equal(validateAlarmTime(now - 1000, now), "alarmPast");
    assert.equal(validateAlarmTime(now + 30_000, now), "alarmPast");
  });

  it("rejects times too far out", () => {
    assert.equal(validateAlarmTime(now + 400 * 24 * 3600_1000, now), "alarmTooFar");
  });

  it("accepts sane future times", () => {
    assert.equal(validateAlarmTime(now + 3600_000, now), null);
  });
});

describe("alarms: scheduling", () => {
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
    };
  }

  it("falls back to notifications when AlarmKit is absent", async () => {
    const scheduled: string[] = [];
    const store = createAlarmStore({
      backend: memBackend(),
      alarmKit: async () => null,
      notifications: async () => ({
        requestPermissionsAsync: async () => ({ granted: true }),
        scheduleNotificationAsync: async (opts) => {
          scheduled.push(opts.content.title);
          return "notif-1";
        },
        cancelScheduledNotificationAsync: async () => {},
      }),
    });
    const alarm = await store.schedule(Date.now() + 3600_000, "起床");
    assert.equal(alarm.viaAlarmKit, false);
    assert.deepEqual(scheduled, ["起床"]);
    const list = await store.list();
    assert.equal(list.length, 1);
    await store.cancel(alarm.id);
    assert.equal((await store.list()).length, 0);
  });

  it("prefers AlarmKit when available", async () => {
    const store = createAlarmStore({
      backend: memBackend(),
      alarmKit: async () => ({
        isAvailable: () => true,
        requestAuthorization: async () => true,
        scheduleAlarm: async () => "kit-1",
        cancelAlarm: async () => {},
        listAlarms: async () => [],
      }),
      notifications: async () => null,
    });
    const alarm = await store.schedule(Date.now() + 3600_000, "吃药");
    assert.equal(alarm.viaAlarmKit, true);
    assert.equal(alarm.id, "kit-1");
  });

  it("throws loudly when nothing can schedule", async () => {
    const store = createAlarmStore({
      backend: memBackend(),
      alarmKit: async () => null,
      notifications: async () => null,
    });
    await assert.rejects(() => store.schedule(Date.now() + 3600_000, "x"), /不可用/);
  });

  it("throws loudly for past times", async () => {
    const store = createAlarmStore({
      backend: memBackend(),
      alarmKit: async () => null,
      notifications: async () => null,
    });
    await assert.rejects(() => store.schedule(Date.now() - 1000, "x"), /未来/);
  });
});
