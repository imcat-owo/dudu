import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseVoiceMessage } from "../src/message-envelope.js";
import {
  createVoiceMessageTools,
  friendlyPodcastError,
  MAX_VOICE_MESSAGE_CHARS,
  makeVoiceMessage,
  type VoiceMessageToolDeps,
} from "../src/voice/tools.js";

const fakeCfg = { voice: "test-voice" } as never;

function fakeDeps(overrides?: Partial<VoiceMessageToolDeps>): VoiceMessageToolDeps {
  return {
    synthesize: async () => "file:///cache/synth_abc.mp3",
    persist: async (u) => u.replace("file:///cache/", "file:///docs/dudu-voice-messages/"),
    estimateDuration: () => 8,
    ...overrides,
  };
}

const fakeVoiceStore = {
  getSnapshot: () => ({ tts: { voice: "test-voice" } }),
} as never;

describe("speak_as_voice tool shape", () => {
  it("registers with the right name, manual and params", () => {
    const tools = createVoiceMessageTools(fakeVoiceStore);
    assert.equal(tools.length, 1);
    const tool = tools[0];
    assert.equal(tool.name, "speak_as_voice");
    assert.equal(tool.manualId, "voice");
    assert.ok(tool.parameters.required?.includes("text"));
    assert.ok(tool.description.includes("voice bubble"));
    assert.ok(tool.description.includes("generate_podcast"));
  });

  it("rejects empty text", async () => {
    const tools = createVoiceMessageTools(fakeVoiceStore);
    await assert.rejects(() => tools[0].run({ text: "   " }, {} as never), /text is required/);
  });

  it("rejects text over the char cap and points at generate_podcast", async () => {
    const tools = createVoiceMessageTools(fakeVoiceStore);
    const long = "啊".repeat(MAX_VOICE_MESSAGE_CHARS + 1);
    await assert.rejects(
      () => tools[0].run({ text: long }, {} as never),
      /too long for a voice message.*generate_podcast/,
    );
  });

  it("accepts text exactly at the cap", async () => {
    const tools = createVoiceMessageTools(fakeVoiceStore, "zh-Hans", {
      deps: fakeDeps(),
    });
    const out = await tools[0].run({ text: "啊".repeat(MAX_VOICE_MESSAGE_CHARS) }, {} as never);
    assert.ok(parseVoiceMessage(out as string));
  });
});

describe("makeVoiceMessage pipeline", () => {
  it("produces an envelope the chat renderer parses into a VoiceBubble", async () => {
    const out = await makeVoiceMessage("晚安宝宝", fakeCfg, fakeDeps());
    const parsed = parseVoiceMessage(out);
    assert.ok(parsed, "envelope must parse");
    assert.equal(parsed.uri, "file:///docs/dudu-voice-messages/synth_abc.mp3");
    assert.equal(parsed.duration, 8);
  });

  it("passes the trimmed text to synthesis", async () => {
    let seen = "";
    const capture: VoiceMessageToolDeps["synthesize"] = async (t) => {
      seen = t;
      return "file:///x.mp3";
    };
    await makeVoiceMessage("  你好呀  ", fakeCfg, fakeDeps({ synthesize: capture }));
    assert.equal(seen, "你好呀");
  });

  it("clamps tiny durations up to 1s", async () => {
    const out = await makeVoiceMessage("嗨", fakeCfg, fakeDeps({ estimateDuration: () => 0 }));
    assert.equal(parseVoiceMessage(out)?.duration, 1);
  });

  it("maps TTS failures to a 语音 (not 播客） error", async () => {
    await assert.rejects(
      () =>
        makeVoiceMessage(
          "你好",
          fakeCfg,
          fakeDeps({
            synthesize: async () => {
              throw new Error("TTS HTTP 401: nope");
            },
          }),
        ),
      /语音没能生成/,
    );
  });

  it("friendlyPodcastError defaults to 播客 for the podcast tool", () => {
    assert.match(friendlyPodcastError(new Error("TTS HTTP 401: nope")), /播客没能生成/);
    assert.match(friendlyPodcastError(new Error("TTS HTTP 401: nope"), "语音"), /语音没能生成/);
  });
});

describe("speak_as_voice incognito", () => {
  it("skips the durable persist in incognito (temp URI plays in-session)", async () => {
    const tools = createVoiceMessageTools(fakeVoiceStore, "zh-Hans", {
      isIncognito: () => true,
      deps: {
        synthesize: async () => "file:///cache/tmp_xyz.mp3",
        estimateDuration: () => 5,
      },
    });
    const out = (await tools[0].run({ text: "悄悄话" }, {} as never)) as string;
    const parsed = parseVoiceMessage(out);
    assert.ok(parsed);
    // persist was the identity: temp URI untouched, nothing durable written.
    assert.equal(parsed.uri, "file:///cache/tmp_xyz.mp3");
  });

  it("is blocked in incognito via the guard list", async () => {
    const { isBlockedInIncognito } = await import("../src/api-groups/incognito-guard.js");
    assert.equal(isBlockedInIncognito("speak_as_voice"), true);
  });
});
