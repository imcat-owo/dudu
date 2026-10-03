import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitPodcastText } from "../src/voice/podcast.js";
import { createPodcastTools } from "../src/voice/tools.js";

describe("splitPodcastText", () => {
  it("returns empty array for empty/blank text", () => {
    assert.deepEqual(splitPodcastText(""), []);
    assert.deepEqual(splitPodcastText("   "), []);
  });

  it("splits Chinese text at sentence boundaries", () => {
    const result = splitPodcastText("你好。这是测试！真的吗？");
    assert.deepEqual(result, ["你好。", "这是测试！", "真的吗？"]);
  });

  it("splits English text at sentence boundaries", () => {
    const result = splitPodcastText("Hello world. How are you? Fine!");
    assert.deepEqual(result, ["Hello world.", "How are you?", "Fine!"]);
  });

  it("splits on newlines", () => {
    const result = splitPodcastText("第一段\n第二段\n第三段");
    assert.deepEqual(result, ["第一段", "第二段", "第三段"]);
  });

  it("handles text without boundaries as single segment", () => {
    const result = splitPodcastText("没有标点的一段话");
    assert.deepEqual(result, ["没有标点的一段话"]);
  });

  it("hard-splits over-long single sentences", () => {
    const long = "啊".repeat(600);
    const result = splitPodcastText(long, 500);
    assert.ok(result.length >= 2);
    assert.ok(result.every((s) => s.length <= 500));
  });

  it("respects maxChars for segments", () => {
    const text = "短句。再来一句短句。又来一句。";
    const result = splitPodcastText(text, 10);
    // Each piece should be at most maxChars (or hard-split)
    assert.ok(result.every((s) => s.length <= 10));
  });
});

describe("createPodcastTools", () => {
  it("creates generate_podcast tool with correct shape", () => {
    const fakeVoiceStore = {
      getSnapshot: () => ({ tts: { voice: "test-voice" } }),
    };
    const fakeTaskStore = {
      upsert: async () => {},
      remove: async () => {},
      saveIndex: async () => {},
    };
    const tools = createPodcastTools(fakeVoiceStore as never, fakeTaskStore as never);
    assert.equal(tools.length, 1);
    const tool = tools[0];
    assert.equal(tool.name, "generate_podcast");
    assert.equal(tool.manualId, "voice");
    assert.ok(tool.description.includes("voice bubble"));
    assert.ok(tool.parameters.required?.includes("text"));
  });

  it("throws ToolError for empty text", async () => {
    const fakeVoiceStore = {
      getSnapshot: () => ({ tts: { voice: "test-voice" } }),
    };
    const fakeTaskStore = {
      upsert: async () => {},
      remove: async () => {},
      saveIndex: async () => {},
    };
    const tools = createPodcastTools(fakeVoiceStore as never, fakeTaskStore as never);
    await assert.rejects(() => tools[0].run({ text: "   " }, {} as never), /text is required/);
  });

  it("uses English stage text when locale is en", async () => {
    const stages: string[] = [];
    const fakeVoiceStore = {
      getSnapshot: () => ({ tts: { voice: "test-voice" } }),
    };
    const fakeTaskStore = {
      upsert: async (t: { stage?: string }) => {
        if (t.stage) stages.push(t.stage);
      },
      remove: async () => {},
      saveIndex: async () => {},
    };
    // generatePodcastAudio is not mocked — run() will fail at synthesis,
    // but the initial upsert with stage text happens first.
    const tools = createPodcastTools(fakeVoiceStore as never, fakeTaskStore as never, "en");
    await assert.rejects(() => tools[0].run({ text: "Hello." }, {} as never));
    assert.ok(stages.length > 0, "should have recorded stage text");
    assert.ok(
      stages[0].includes("Synthesizing"),
      `expected English stage, got: ${stages[0]}`,
    );
  });

  it("uses Chinese stage text by default", async () => {
    const stages: string[] = [];
    const fakeVoiceStore = {
      getSnapshot: () => ({ tts: { voice: "test-voice" } }),
    };
    const fakeTaskStore = {
      upsert: async (t: { stage?: string }) => {
        if (t.stage) stages.push(t.stage);
      },
      remove: async () => {},
      saveIndex: async () => {},
    };
    const tools = createPodcastTools(fakeVoiceStore as never, fakeTaskStore as never);
    await assert.rejects(() => tools[0].run({ text: "你好。" }, {} as never));
    assert.ok(stages.length > 0, "should have recorded stage text");
    assert.ok(stages[0].includes("正在合成"), `expected Chinese stage, got: ${stages[0]}`);
  });
});
