/**
 * AI photo share （主动发照片） — decision parser tests (PURE).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCharacterRef,
  buildPhotoshareSystemPrompt,
  parsePhotoshareDecision,
} from "../src/photoshare/decide.js";

describe("photoshare decision parser", () => {
  it("parses a SHARE decision", () => {
    const d = parsePhotoshareDecision(
      `SHARE
PROMPT: a cozy selfie of a young man in a white shirt, warm evening light
CAPTION: 看，我刚到家，想你了`,
    );
    assert.ok(d);
    assert.ok(d.imagePrompt.includes("selfie"));
    assert.equal(d.caption, "看，我刚到家，想你了");
  });

  it("returns null for SKIP", () => {
    assert.equal(parsePhotoshareDecision("SKIP"), null);
    assert.equal(parsePhotoshareDecision("skip"), null);
  });

  it("returns null on ambiguity (silence wins)", () => {
    assert.equal(parsePhotoshareDecision(""), null);
    assert.equal(parsePhotoshareDecision("maybe later"), null);
    // SHARE without PROMPT/CAPTION is unusable — never share on ambiguity.
    assert.equal(parsePhotoshareDecision("SHARE"), null);
    assert.equal(parsePhotoshareDecision("SHARE\nPROMPT: only a prompt"), null);
  });

  it("system prompt forbids camera claims", () => {
    const sp = buildPhotoshareSystemPrompt("嘟嘟");
    assert.ok(sp.includes("NEVER claim the photo was taken with a camera"));
    assert.ok(sp.includes("SHARE or SKIP"));
  });

  it("builds a character reference from the persona card", () => {
    const ref = buildCharacterRef({
      description: "十八岁少年，黑色短发",
      personality: "温柔\n有点懒",
      background: "",
    } as never);
    assert.ok(ref.includes("十八岁少年"));
    assert.ok(ref.includes("温柔"));
  });

  it("character reference is empty-safe", () => {
    assert.equal(buildCharacterRef({} as never), "");
  });
});
