/**
 * P2-27: voice/image envelopes must be found even when the AI doesn't
 * output the JSON verbatim — fenced, or wrapped in prose.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractImageMessage, extractImageMessageStrict } from "../src/image/protocol.js";
import {
  extractEnvelope,
  extractVoiceMessage,
  extractVoiceMessageStrict,
} from "../src/message-envelope.js";

const VOICE = JSON.stringify({ type: "voice_message", uri: "file:///a.mp3", duration: 12 });

describe("extractEnvelope", () => {
  it("finds a verbatim whole-message envelope", () => {
    const hit = extractEnvelope(VOICE, "voice_message");
    assert.ok(hit);
    assert.equal(hit.data.uri, "file:///a.mp3");
    assert.equal(hit.rest, "");
  });

  it("finds the envelope inside a ```json fence", () => {
    const hit = extractEnvelope(`给你做好啦：\n\`\`\`json\n${VOICE}\n\`\`\``, "voice_message");
    assert.ok(hit);
    assert.equal(hit.data.duration, 12);
    assert.equal(hit.rest, "给你做好啦：");
  });

  it("finds the envelope embedded in surrounding prose", () => {
    const hit = extractEnvelope(`好嘟，这是你的晚安故事 ${VOICE} 点一下就能听`, "voice_message");
    assert.ok(hit);
    assert.equal(hit.data.uri, "file:///a.mp3");
    assert.ok(hit.rest.includes("晚安故事"), `rest was: ${hit.rest}`);
    assert.ok(!hit.rest.includes("voice_message"), `envelope leaked into rest: ${hit.rest}`);
  });

  it("ignores braces in prose and nested objects inside the envelope", () => {
    const nested = JSON.stringify({
      type: "voice_message",
      uri: "file:///a.mp3",
      duration: 3,
      meta: { a: "{not json}", b: 1 },
    });
    const hit = extractEnvelope(`嗯 {只是文字} 好了 ${nested} 听吧`, "voice_message");
    assert.ok(hit);
    assert.deepEqual((hit.data.meta as Record<string, unknown>).b, 1);
  });

  it("returns null when the type doesn't match", () => {
    assert.equal(extractEnvelope(VOICE, "image_message"), null);
  });

  it("returns null for plain prose", () => {
    assert.equal(extractEnvelope("今天天气不错", "voice_message"), null);
  });

  it("returns null for unbalanced braces", () => {
    assert.equal(extractEnvelope('{"type":"voice_message", broken', "voice_message"), null);
  });

  it("handles non-string input", () => {
    assert.equal(extractEnvelope(undefined as unknown as string, "voice_message"), null);
  });
});

describe("extractVoiceMessage (P2-27)", () => {
  it("parses verbatim JSON (old behavior kept)", () => {
    const hit = extractVoiceMessage(VOICE);
    assert.ok(hit);
    assert.deepEqual(hit.voice, { uri: "file:///a.mp3", duration: 12 });
    assert.equal(hit.rest, "");
  });

  it("parses prose-wrapped JSON and strips it from rest", () => {
    const hit = extractVoiceMessage(`故事来啦 ${VOICE}`);
    assert.ok(hit);
    assert.equal(hit.voice.duration, 12);
    assert.equal(hit.rest, "故事来啦");
  });

  it("rejects envelopes with bad fields", () => {
    assert.equal(
      extractVoiceMessage(JSON.stringify({ type: "voice_message", uri: "", duration: 1 })),
      null,
    );
    assert.equal(
      extractVoiceMessage(JSON.stringify({ type: "voice_message", uri: "x", duration: -1 })),
      null,
    );
  });
});

describe("extractImageMessage (P2-27)", () => {
  it("parses fenced image JSON", () => {
    const img = JSON.stringify({ type: "image_message", uri: "file:///b.png", prompt: "a cat" });
    const hit = extractImageMessage(`画好了\n\`\`\`json\n${img}\n\`\`\`\n看看`);
    assert.ok(hit);
    assert.equal(hit.image.uri, "file:///b.png");
    assert.ok(hit.rest.includes("画好了") && hit.rest.includes("看看"));
  });
});

describe("strict envelope variants (P3-14, user path)", () => {
  const IMG = JSON.stringify({ type: "image_message", uri: "file:///b.png", prompt: "a cat" });

  it("accepts a real whole-message voice envelope", () => {
    const hit = extractVoiceMessageStrict(VOICE);
    assert.ok(hit);
    assert.equal(hit.voice.uri, "file:///a.mp3");
  });

  it("accepts a real whole-message image envelope", () => {
    const hit = extractImageMessageStrict(IMG);
    assert.ok(hit);
    assert.equal(hit.image.uri, "file:///b.png");
  });

  it("rejects envelope-shaped JSON pasted inside her prose", () => {
    const pasted = `看这个例子 ${VOICE} 是不是很好玩`;
    assert.equal(extractVoiceMessageStrict(pasted), null);
    // ...while the tolerant AI-side scan still finds it (unchanged behavior).
    assert.ok(extractVoiceMessage(pasted));
  });

  it("rejects fenced envelopes on the user path", () => {
    assert.equal(extractVoiceMessageStrict(`\`\`\`json\n${VOICE}\n\`\`\``), null);
    assert.equal(extractImageMessageStrict(`\`\`\`json\n${IMG}\n\`\`\``), null);
  });

  it("tolerates surrounding whitespace only", () => {
    assert.ok(extractVoiceMessageStrict(`  \n${VOICE}\n `));
  });
});
