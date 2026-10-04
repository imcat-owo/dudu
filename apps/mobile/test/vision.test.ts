import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { newVisionCache, toWireUserMessage } from "../src/api-groups/local-agent.js";
import {
  buildVisionPrompt,
  encodeUserMessageWithImages,
  formatDescriptionBlock,
} from "../src/vision/describe.js";

describe("buildVisionPrompt", () => {
  it("has the 4-part structure", () => {
    const p = buildVisionPrompt("");
    assert.ok(p.includes("逐字抄录"), "文字抄录");
    assert.ok(p.includes("视觉元素"), "物体");
    assert.ok(p.includes("整体布局"), "布局");
    assert.ok(p.includes("颜色基调"), "风格");
  });

  it("embeds the user question", () => {
    const p = buildVisionPrompt("这张图里有几个人？");
    assert.ok(p.includes("这张图里有几个人？"));
    assert.ok(p.includes("先直接回答问题"));
  });

  it("handles empty question", () => {
    const p = buildVisionPrompt("   ");
    assert.ok(p.includes("没有提具体问题"));
  });

  it("carries the injection guard", () => {
    const p = buildVisionPrompt("");
    assert.ok(p.includes("疑似注入"));
    assert.ok(p.includes("不许脑补"));
  });
});

describe("formatDescriptionBlock", () => {
  it("is identifiable and traceable", () => {
    const b = formatDescriptionBlock("shot.png", "一张猫的照片");
    assert.ok(b.startsWith("[图片描述 | shot.png]"));
    assert.ok(b.includes("一张猫的照片"));
  });
});

describe("toWireUserMessage vision cache", () => {
  const group = {
    id: "g1",
    name: "test",
    vendor: "openai",
    baseUrl: "https://api.example.com/v1",
    model: "m",
    headers: {},
    createdAt: 0,
    vision: { native: false },
  } as Parameters<typeof toWireUserMessage>[0];

  it("reuses cached describe results instead of re-calling the vision model", async () => {
    const cache = newVisionCache();
    cache.describe.set("file:///img1.jpg", "CACHED DESCRIPTION");
    const content = encodeUserMessageWithImages("看这张图", [
      { uri: "file:///img1.jpg", name: "img1.jpg" },
    ]);
    // If the cache were ignored, describeImage would attempt a real network
    // call to api.example.com and throw — the test would fail.
    const wire = await toWireUserMessage(group, content, cache);
    assert.ok(typeof wire.content === "string" && wire.content.includes("CACHED DESCRIPTION"));
    assert.equal(cache.describe.size, 1, "no new describe call recorded");
  });

  it("reuses cached data URIs in native mode without re-reading files", async () => {
    const cache = newVisionCache();
    cache.dataUri.set("file:///img2.jpg", "data:image/jpeg;base64,CACHED");
    const nativeGroup = {
      ...group,
      vision: { native: true },
    } as Parameters<typeof toWireUserMessage>[0];
    const content = encodeUserMessageWithImages("", [
      { uri: "file:///img2.jpg", name: "img2.jpg" },
    ]);
    const wire = await toWireUserMessage(nativeGroup, content, cache);
    assert.ok(Array.isArray(wire.content));
    const imgBlock = (wire.content as unknown[]).find(
      (b): b is { type: string; image_url: { url: string } } =>
        typeof b === "object" && b !== null && (b as { type: string }).type === "image_url",
    );
    assert.ok(imgBlock, "image block present");
    assert.equal(imgBlock.image_url.url, "data:image/jpeg;base64,CACHED");
  });
});

describe("file attachments in messages", () => {
  it("encodes files alongside images", async () => {
    const { parseUserMessageWithImages } = await import("../src/vision/describe.js");
    const content = encodeUserMessageWithImages(
      "存进知识库",
      [{ uri: "file:///a.jpg", name: "a.jpg" }],
      [{ uri: "file:///doc.pdf", name: "doc.pdf" }],
    );
    const parsed = parseUserMessageWithImages(content);
    assert.ok(parsed);
    assert.equal(parsed.text, "存进知识库");
    assert.equal(parsed.images.length, 1);
    assert.equal(parsed.files?.length, 1);
    assert.equal(parsed.files?.[0].uri, "file:///doc.pdf");
  });

  it("encodes files without images", async () => {
    const { parseUserMessageWithImages } = await import("../src/vision/describe.js");
    const content = encodeUserMessageWithImages(
      "存这个",
      [],
      [{ uri: "file:///notes.md", name: "notes.md" }],
    );
    const parsed = parseUserMessageWithImages(content);
    assert.ok(parsed);
    assert.equal(parsed.images.length, 0);
    assert.equal(parsed.files?.length, 1);
  });

  it("omits files key when empty (backwards compatible)", async () => {
    const { parseUserMessageWithImages } = await import("../src/vision/describe.js");
    const content = encodeUserMessageWithImages("hi", [{ uri: "u", name: "n" }]);
    assert.ok(!content.includes('"files"'));
    const parsed = parseUserMessageWithImages(content);
    assert.ok(parsed);
    assert.equal(parsed.files, undefined);
  });
});
