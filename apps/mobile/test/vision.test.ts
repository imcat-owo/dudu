import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildVisionPrompt,
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
