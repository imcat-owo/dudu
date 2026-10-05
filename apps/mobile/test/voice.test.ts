import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chunkText } from "../src/voice/edge-tts.js";
import { createVoiceStore, type KeyValueBackend, type SecureBackend } from "../src/voice/store.js";
import { friendlyPodcastError } from "../src/voice/tools.js";
import {
  blankSttConfig,
  blankTtsConfig,
  defaultVoiceSettings,
  EDGE_TTS_DEFAULT_VOICE,
  validateSttConfig,
  validateTtsConfig,
} from "../src/voice/types.js";
import { rewriteVoiceMessageUris } from "../src/voice/voice-message-files.js";

function fakeSecure(): SecureBackend & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => {
      data.set(k, v);
    },
    deleteItem: async (k) => {
      data.delete(k);
    },
  };
}

function fakeKv(): KeyValueBackend & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => {
      data.set(k, v);
    },
    removeItem: async (k) => {
      data.delete(k);
    },
  };
}

describe("tts config validation", () => {
  it("edge-tts default is valid", () => {
    assert.equal(validateTtsConfig(blankTtsConfig()), null);
    assert.equal(blankTtsConfig().voice, EDGE_TTS_DEFAULT_VOICE);
  });

  it("edge-tts requires a voice", () => {
    assert.equal(validateTtsConfig({ provider: "edge-tts", voice: "  " }), "voiceRequired");
  });

  it("custom requires url, model, voice", () => {
    assert.equal(validateTtsConfig({ provider: "custom", voice: "v" }), "ttsUrlRequired");
    assert.equal(
      validateTtsConfig({ provider: "custom", voice: "v", customUrl: "not-a-url" }),
      "ttsUrlInvalid",
    );
    assert.equal(
      validateTtsConfig({ provider: "custom", voice: "v", customUrl: "https://x.com/v1" }),
      "ttsModelRequired",
    );
    assert.equal(
      validateTtsConfig({
        provider: "custom",
        voice: "v",
        customUrl: "https://x.com/v1",
        customModel: "tts-1",
      }),
      null,
    );
  });
});

describe("stt config validation", () => {
  it("group provider needs nothing", () => {
    assert.equal(validateSttConfig(blankSttConfig()), null);
  });

  it("custom requires url and model", () => {
    assert.equal(validateSttConfig({ provider: "custom" }), "sttUrlRequired");
    assert.equal(
      validateSttConfig({ provider: "custom", customUrl: "https://x.com/v1" }),
      "sttModelRequired",
    );
    assert.equal(
      validateSttConfig({
        provider: "custom",
        customUrl: "https://x.com/v1",
        customModel: "whisper-1",
      }),
      null,
    );
  });
});

describe("voice settings defaults", () => {
  it("mic defaults to transcribe (recording must not be decorative)", () => {
    assert.equal(defaultVoiceSettings().micMode, "transcribe");
  });
});

describe("edge-tts chunkText", () => {
  it("short text stays whole", () => {
    assert.deepEqual(chunkText("你好"), ["你好"]);
  });

  it("splits long text at sentence boundaries", () => {
    const long = "这是第一句。这是第二句！这是第三句？这是第四句。".repeat(30);
    const chunks = chunkText(long, 100);
    assert.ok(chunks.length > 1);
    for (const c of chunks) assert.ok(c.length <= 120, `chunk too long: ${c.length}`);
    // No text lost.
    assert.equal(chunks.join(""), long);
  });

  it("empty text gives one empty chunk (caller rejects empty)", () => {
    assert.deepEqual(chunkText("   "), ["   "]);
  });

  it("hard-splits an over-long run with no sentence boundary", () => {
    const long = "啊".repeat(250);
    const chunks = chunkText(long, 100);
    assert.ok(chunks.length > 1);
    for (const c of chunks) assert.ok(c.length <= 100, `chunk too long: ${c.length}`);
    assert.equal(chunks.join(""), long, "no text lost");
  });
});

describe("voice store", () => {
  it("round-trips tts config through the secure backend", async () => {
    const secure = fakeSecure();
    const store = createVoiceStore(secure);
    await store.setTts({
      provider: "custom",
      voice: "alloy",
      customUrl: "https://api.example.com/v1",
      customKey: "sk-secret",
      customModel: "tts-1",
    });
    const snap = store.getSnapshot();
    assert.equal(snap.tts.customKey, "sk-secret");
    // Key went to SecureStore, not AsyncStorage (which the fake doesn't model).
    assert.equal(secure.data.get("dudu.tts.v1")?.includes("sk-secret"), true);
  });

  it("settings persist mic mode", async () => {
    const kv = fakeKv();
    const store = createVoiceStore(fakeSecure(), kv);
    const ok = await store.setSettings({ micMode: "voice-message", autoRead: false });
    assert.equal(ok, true);
    assert.equal(store.getSnapshot().settings.micMode, "voice-message");
    assert.ok(kv.data.get("dudu.voice-settings.v1")?.includes("voice-message"));
  });

  it("corrupted stored json falls back to defaults", async () => {
    const secure = fakeSecure();
    secure.data.set("dudu.tts.v1", "not-json{{{");
    const store = createVoiceStore(secure);
    // Wait a tick for the kick-off load.
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(store.getSnapshot().tts.provider, "edge-tts");
  });

  it("refresh() picks up externally changed storage (backup restore)", async () => {
    const secure = fakeSecure();
    const store = createVoiceStore(secure);
    await store.setTts({
      provider: "custom",
      voice: "old",
      customUrl: "https://old.example.com",
      customKey: "",
      customModel: "m",
    });
    assert.equal(store.getSnapshot().tts.voice, "old");
    // Simulate applyBackup writing directly to SecureStore behind the store's back.
    secure.data.set(
      "dudu.tts.v1",
      JSON.stringify({
        provider: "custom",
        voice: "restored",
        customUrl: "https://new.example.com",
        customModel: "m",
      }),
    );
    assert.equal(store.getSnapshot().tts.voice, "old", "stale mirror before refresh");
    await store.refresh();
    assert.equal(store.getSnapshot().tts.voice, "restored");
    assert.equal(store.getSnapshot().tts.customUrl, "https://new.example.com");
  });
});

describe("friendlyPodcastError (P2-4)", () => {
  it("translates custom TTS network failure", () => {
    const msg = friendlyPodcastError(new Error("TTS request failed: fetch failed"));
    assert.ok(msg.includes("播客没能生成"), `got: ${msg}`);
    assert.ok(msg.includes("自定义"), `got: ${msg}`);
    assert.ok(!msg.includes("fetch failed") || msg.includes("自定义"), `got: ${msg}`);
  });

  it("translates 401 into a key hint", () => {
    const msg = friendlyPodcastError(new Error('TTS HTTP 401: {"error":"unauthorized"}'));
    assert.ok(msg.includes("密钥不对或过期"), `got: ${msg}`);
  });

  it("translates non-MP3 into a voice hint", () => {
    const msg = friendlyPodcastError(new Error("podcast needs MP3 segments but TTS returned .wav"));
    assert.ok(msg.includes("MP3"), `got: ${msg}`);
  });

  it("never returns raw English technical text alone", () => {
    const msg = friendlyPodcastError(new Error("TTS HTTP 500: internal error"));
    assert.ok(msg.startsWith("播客没能生成"), `got: ${msg}`);
  });
});

describe("voice message files (P2-5)", () => {
  it("rewrites absolute URIs to the new device dir", () => {
    const content = JSON.stringify({
      type: "voice_message",
      uri: "file:///var/mobile/Containers/Data/old/dudu-voice-messages/vm_abc.m4a",
      duration: 5,
    });
    const fixed = rewriteVoiceMessageUris(
      content,
      "file:///var/mobile/Containers/Data/new/dudu-voice-messages/",
    );
    assert.ok(
      fixed.includes("file:///var/mobile/Containers/Data/new/dudu-voice-messages/vm_abc.m4a"),
      `got: ${fixed}`,
    );
    assert.ok(!fixed.includes("/old/"), `got: ${fixed}`);
  });

  it("leaves non-voice content untouched", () => {
    const content = "hello world";
    assert.equal(rewriteVoiceMessageUris(content, "file:///new/dudu-voice-messages/"), content);
  });
});

describe("voice store write serialization (P1-2)", () => {
  it("a failed write returns false and keeps the old config (no silent loss)", async () => {
    const secure = fakeSecure();
    const store = createVoiceStore(secure);
    await store.setTts({
      provider: "custom",
      voice: "old",
      customUrl: "https://old.example.com",
      customKey: "",
      customModel: "m",
    });
    // Keychain locks up from here on.
    secure.setItem = async () => {
      throw new Error("keychain locked");
    };
    const ok = await store.setTts({
      provider: "custom",
      voice: "new",
      customUrl: "https://new.example.com",
      customKey: "",
      customModel: "m",
    });
    assert.equal(ok, false, "caller must see the failure");
    assert.equal(store.getSnapshot().tts.voice, "old", "mirror must not pretend the save worked");
    assert.ok(
      secure.data.get("dudu.tts.v1")?.includes('"voice":"old"'),
      "disk must still hold the old config",
    );
  });

  it("concurrent setTts calls serialize — last write wins on disk", async () => {
    const data = new Map<string, string>();
    const secure: SecureBackend = {
      getItem: async (k) => data.get(k) ?? null,
      // Slow first write, fast second: without serialization the stale
      // write would land last and resurrect old config on next launch.
      setItem: async (k, v) => {
        await new Promise((r) => setTimeout(r, v.includes('"voice":"first"') ? 30 : 5));
        data.set(k, v);
      },
      deleteItem: async (k) => {
        data.delete(k);
      },
    };
    const store = createVoiceStore(secure);
    const cfg = (voice: string) => ({
      provider: "custom" as const,
      voice,
      customUrl: `https://${voice}.example.com`,
      customKey: "",
      customModel: "m",
    });
    const [a, b] = await Promise.all([store.setTts(cfg("first")), store.setTts(cfg("second"))]);
    assert.equal(a, true);
    assert.equal(b, true);
    assert.ok(
      data.get("dudu.tts.v1")?.includes('"voice":"second"'),
      "disk must hold the newest write",
    );
    assert.equal(store.getSnapshot().tts.voice, "second");
  });

  it("setStt failure keeps the old STT config too", async () => {
    const secure = fakeSecure();
    const store = createVoiceStore(secure);
    await store.setStt({
      ...blankSttConfig(),
      provider: "custom",
      customUrl: "https://old.example.com",
    });
    secure.setItem = async () => {
      throw new Error("keychain locked");
    };
    const ok = await store.setStt({
      ...blankSttConfig(),
      provider: "custom",
      customUrl: "https://new.example.com",
    });
    assert.equal(ok, false);
    assert.equal(store.getSnapshot().stt.customUrl, "https://old.example.com");
  });

  it("setSettings failure returns false and keeps the old mic mode", async () => {
    const kv = fakeKv();
    const store = createVoiceStore(fakeSecure(), kv);
    assert.equal(await store.setSettings({ micMode: "voice-message", autoRead: false }), true);
    kv.setItem = async () => {
      throw new Error("disk full");
    };
    const ok = await store.setSettings({ micMode: "transcribe", autoRead: false });
    assert.equal(ok, false);
    assert.equal(store.getSnapshot().settings.micMode, "voice-message");
  });
});
