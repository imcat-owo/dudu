import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  __resetAutoReadForTests,
  type AutoReadDeps,
  maybeAutoReadAssistantMessage,
} from "../src/voice/auto-read.js";
import { buildSsml, type EdgeProsody } from "../src/voice/edge-tts.js";
import {
  classifyEmotion,
  emotionProsody,
  isVoiceEmotion,
  resolveSpeakEmotion,
  VOICE_EMOTIONS,
  type VoiceEmotion,
} from "../src/voice/emotion.js";
import {
  createVoiceMessageTools,
  makeVoiceMessage,
  type VoiceMessageToolDeps,
} from "../src/voice/tools.js";
import { resolveEmotionParams, type SynthesizeOptions } from "../src/voice/tts.js";
import { toProviderProsody } from "../src/voice/tts-providers.js";
import { defaultVoiceSettings } from "../src/voice/types.js";

describe("classifyEmotion", () => {
  const cases: Array<[string, VoiceEmotion]> = [
    ["太开心了！", "excited"],
    ["好耶！太棒了！！", "excited"],
    ["对不起……", "sad"],
    ["我今天很难过", "sad"],
    ["唉，今天好累", "sad"],
    ["哈哈太好笑了", "playful"],
    ["晚安，好好休息", "gentle"],
    ["别怕，我在呢", "gentle"],
    ["说真的，这件事很重要", "serious"],
    ["今天天气不错。", "calm"],
    ["你好！", "calm"], // single ！ on a neutral sentence is not enough signal
    ["嗯。", "calm"],
    ["", "calm"],
  ];
  for (const [text, expected] of cases) {
    it(`classifies ${JSON.stringify(text)} as ${expected}`, () => {
      assert.equal(classifyEmotion(text), expected);
    });
  }

  it("never invents happy for neutral text", () => {
    assert.equal(classifyEmotion("明天记得带伞。"), "calm");
    assert.equal(classifyEmotion("好的，知道了"), "calm");
  });
});

describe("emotionProsody mapping", () => {
  it("sad is slower, lower, softer than excited — the mapping is real", () => {
    const sad = emotionProsody("sad");
    const excited = emotionProsody("excited");
    assert.ok(sad.rate < 1.0, "sad slows down");
    assert.ok(sad.pitchHz < 0, "sad drops pitch");
    assert.ok(sad.volumePct < 0, "sad softens");
    assert.ok(excited.rate > 1.0, "excited speeds up");
    assert.ok(excited.pitchHz > 0, "excited lifts pitch");
    assert.ok(excited.volumePct > 0, "excited gets louder");
  });

  it("calm is exactly flat", () => {
    assert.deepEqual(emotionProsody("calm"), { rate: 1.0, pitchHz: 0, volumePct: 0 });
  });

  it("every emotion has distinct parameters", () => {
    const seen = new Set(VOICE_EMOTIONS.map((e) => JSON.stringify(emotionProsody(e))));
    assert.equal(seen.size, VOICE_EMOTIONS.length);
  });
});

describe("isVoiceEmotion / VOICE_EMOTIONS", () => {
  it("accepts the 7 known emotions, rejects garbage", () => {
    for (const e of VOICE_EMOTIONS) assert.ok(isVoiceEmotion(e));
    assert.ok(!isVoiceEmotion("angry"));
    assert.ok(!isVoiceEmotion(""));
    assert.ok(!isVoiceEmotion(null));
    assert.ok(!isVoiceEmotion(42));
  });
});

describe("resolveSpeakEmotion precedence", () => {
  const on = { emotionalTts: true, emotionPin: null };
  it("switch off → null (flat, old behavior)", () => {
    assert.equal(
      resolveSpeakEmotion("太开心了！", { emotionalTts: false, emotionPin: null }, null),
      null,
    );
  });
  it("explicit AI choice wins", () => {
    assert.equal(resolveSpeakEmotion("太开心了！", on, "sad"), "sad");
  });
  it("invalid explicit falls back to auto (never crashes)", () => {
    assert.equal(resolveSpeakEmotion("太开心了！", on, "angry"), "excited");
  });
  it("her pin beats auto-classification", () => {
    assert.equal(
      resolveSpeakEmotion("太开心了！", { emotionalTts: true, emotionPin: "gentle" }, null),
      "gentle",
    );
  });
  it("explicit beats her pin", () => {
    assert.equal(
      resolveSpeakEmotion("你好", { emotionalTts: true, emotionPin: "gentle" }, "sad"),
      "sad",
    );
  });
  it("no explicit, no pin → auto-classify", () => {
    assert.equal(resolveSpeakEmotion("对不起……", on, null), "sad");
    assert.equal(resolveSpeakEmotion("今天天气不错。", on, undefined), "calm");
  });
});

describe("buildSsml wire format", () => {
  it("emits real pitch/volume/rate attributes edge-tts honors", () => {
    const ssml = buildSsml("你好", "zh-CN-XiaoxiaoNeural", {
      rate: 0.85,
      pitchHz: -16,
      volumePct: -15,
    });
    assert.ok(ssml.includes(`pitch='-16Hz'`), `pitch missing: ${ssml}`);
    assert.ok(ssml.includes(`volume='-15%'`), `volume missing: ${ssml}`);
    assert.ok(ssml.includes(`rate='-15%'`), `rate missing: ${ssml}`);
    assert.ok(ssml.includes("你好"));
  });

  it("flat emotion produces the exact old SSML", () => {
    const ssml = buildSsml("你好", "v", { rate: 1.0, pitchHz: 0, volumePct: 0 });
    assert.ok(ssml.includes(`pitch='+0Hz'`));
    assert.ok(ssml.includes(`volume='+0%'`));
    assert.ok(ssml.includes(`rate='+0%'`));
  });

  it("clamps runaway pitch/volume so a mapping bug can't chipmunk", () => {
    const extra: EdgeProsody = { pitchHz: 999, volumePct: -999 };
    const ssml = buildSsml("x", "v", { rate: 1, ...extra });
    assert.ok(ssml.includes(`pitch='+50Hz'`));
    assert.ok(ssml.includes(`volume='-50%'`));
  });
});

describe("resolveEmotionParams", () => {
  it("null emotion = flat: her rate untouched, zero deltas", () => {
    const p = resolveEmotionParams({ provider: "edge-tts", voice: "v", rate: 1.2 }, null);
    assert.deepEqual(p, { rate: 1.2, pitchHz: 0, volumePct: 0 });
  });
  it("sad multiplies her base rate (respects her speed setting)", () => {
    const p = resolveEmotionParams({ provider: "edge-tts", voice: "v", rate: 1.2 }, "sad");
    assert.ok(Math.abs(p.rate - 1.2 * 0.85) < 1e-9);
    assert.equal(p.pitchHz, -16);
    assert.equal(p.volumePct, -15);
  });
  it("clamps the effective rate to 0.5–2.0", () => {
    const p = resolveEmotionParams({ provider: "edge-tts", voice: "v", rate: 2.0 }, "excited");
    assert.equal(p.rate, 2.0);
  });
});

describe("toProviderProsody (MiniMax units)", () => {
  it("converts Hz/percent to semitones/vol multiplier", () => {
    const p = toProviderProsody({ rate: 1.18, pitchHz: 16, volumePct: 8 });
    assert.equal(p.rate, 1.18);
    assert.equal(p.pitchSt, 2); // 16/8
    assert.ok(Math.abs(p.vol - 1.08) < 1e-9);
  });
  it("flat stays flat", () => {
    assert.deepEqual(toProviderProsody({ rate: 1, pitchHz: 0, volumePct: 0 }), {
      rate: 1,
      pitchSt: 0,
      vol: 1,
    });
  });
});

function captureDeps(): VoiceMessageToolDeps & { seen: SynthesizeOptions[] } {
  const seen: SynthesizeOptions[] = [];
  const deps: VoiceMessageToolDeps = {
    synthesize: async (_t, _c, opts) => {
      seen.push(opts ?? {});
      return "file:///cache/synth.mp3";
    },
    persist: async (u) => u,
    estimateDuration: () => 5,
  };
  return Object.assign(deps, { seen });
}

function storeWithSettings(settings: Partial<ReturnType<typeof defaultVoiceSettings>>) {
  return {
    getSnapshot: () => ({
      tts: { provider: "edge-tts", voice: "v" },
      settings: { ...defaultVoiceSettings(), ...settings },
    }),
  } as never;
}

describe("speak_as_voice emotion plumbing", () => {
  it("passes an explicit emotion through to synthesis", async () => {
    const deps = captureDeps();
    const tools = createVoiceMessageTools(storeWithSettings({}), "zh-Hans", { deps });
    await tools[0].run({ text: "今天天气不错。", emotion: "sad" }, {} as never);
    assert.equal(deps.seen.length, 1);
    assert.equal(deps.seen[0].emotion, "sad");
  });

  it("auto-classifies when the AI omits emotion", async () => {
    const deps = captureDeps();
    const tools = createVoiceMessageTools(storeWithSettings({}), "zh-Hans", { deps });
    await tools[0].run({ text: "对不起……" }, {} as never);
    assert.equal(deps.seen[0].emotion, "sad");
  });

  it("invalid emotion string falls back to auto, never crashes", async () => {
    const deps = captureDeps();
    const tools = createVoiceMessageTools(storeWithSettings({}), "zh-Hans", { deps });
    await tools[0].run({ text: "太开心了！", emotion: "furious" }, {} as never);
    assert.equal(deps.seen[0].emotion, "excited");
  });

  it("switch off → null emotion (flat voice, old behavior)", async () => {
    const deps = captureDeps();
    const tools = createVoiceMessageTools(storeWithSettings({ emotionalTts: false }), "zh-Hans", {
      deps,
    });
    await tools[0].run({ text: "太开心了！", emotion: "excited" }, {} as never);
    assert.equal(deps.seen[0].emotion, null);
  });

  it("her pin overrides auto-classification", async () => {
    const deps = captureDeps();
    const tools = createVoiceMessageTools(storeWithSettings({ emotionPin: "gentle" }), "zh-Hans", {
      deps,
    });
    await tools[0].run({ text: "太开心了！" }, {} as never);
    assert.equal(deps.seen[0].emotion, "gentle");
  });

  it("tool schema advertises the emotion param", () => {
    const tools = createVoiceMessageTools(storeWithSettings({}));
    const props = tools[0].parameters.properties as Record<string, unknown>;
    assert.ok(props.emotion, "emotion param must be in the schema");
  });
});

describe("makeVoiceMessage emotion passthrough", () => {
  it("forwards opts.emotion to the synthesizer", async () => {
    const deps = captureDeps();
    await makeVoiceMessage("晚安", { provider: "edge-tts", voice: "v" }, deps, {
      emotion: "gentle",
    });
    assert.equal(deps.seen[0].emotion, "gentle");
  });
});

describe("auto-read emotion", () => {
  function autoDeps(emotionalTts: boolean): AutoReadDeps & { seen: SynthesizeOptions[] } {
    const seen: SynthesizeOptions[] = [];
    const deps: AutoReadDeps = {
      getSettings: () => ({ ...defaultVoiceSettings(), autoRead: true, emotionalTts }),
      getTtsConfig: () => ({ provider: "edge-tts", voice: "v" }) as never,
      synthesize: async (_t, _c, opts) => {
        seen.push(opts ?? {});
        return "file:///x.mp3";
      },
      createPlayer: () => ({
        play() {},
        pause() {},
        remove() {},
        addListener: () => ({ remove() {} }),
      }),
      setAudioMode: async () => {},
    };
    return Object.assign(deps, { seen });
  }

  it("classifies the reply's tone when the switch is on", async () => {
    __resetAutoReadForTests();
    const deps = autoDeps(true);
    const ok = await maybeAutoReadAssistantMessage("对不起……让你久等了", deps);
    assert.equal(ok, true);
    assert.equal(deps.seen.length, 1);
    assert.equal(deps.seen[0].emotion, "sad");
  });

  it("passes null emotion when the switch is off (flat)", async () => {
    __resetAutoReadForTests();
    const deps = autoDeps(false);
    const ok = await maybeAutoReadAssistantMessage("太开心了！", deps);
    assert.equal(ok, true);
    assert.equal(deps.seen[0].emotion, null);
  });
});
