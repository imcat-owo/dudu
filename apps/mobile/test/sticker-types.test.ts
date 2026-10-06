/**
 * 图片表情包 types — tests.
 *
 * Under test:
 *  1. sticker_message envelope: encode -> tolerant extract (whole, fenced,
 *     embedded in prose), strict extract (whole-message only for her).
 *  2. Validation: pack/sticker name rules.
 *  3. isStickerImageFile: extension whitelist.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  encodeStickerMessage,
  extractStickerMessage,
  extractStickerMessageStrict,
  isStickerImageFile,
  newPackId,
  newStickerId,
  validatePackName,
  validateStickerName,
} from "../src/sticker/types.js";

const MSG = { uri: "file:///s.png", stickerId: "st_abc", packId: "sp_1", name: "devil-01" };

describe("sticker envelope", () => {
  it("round-trips through the tolerant extractor", () => {
    const raw = encodeStickerMessage(MSG);
    const hit = extractStickerMessage(raw);
    assert.ok(hit, "extracts");
    assert.deepEqual(hit.sticker, MSG);
    assert.equal(hit.rest, "");
  });

  it("is found inside a json fence and inside prose", () => {
    const raw = encodeStickerMessage(MSG);
    const fenced = extractStickerMessage(`\`\`\`json\n${raw}\n\`\`\``);
    assert.ok(fenced, "fenced extracts");
    const prose = extractStickerMessage(`给你 ${raw} 拿去`);
    assert.ok(prose, "embedded extracts");
    assert.ok(
      prose.rest.includes("给你") && prose.rest.includes("拿去"),
      "prose survives around the envelope",
    );
  });

  it("strict extractor only accepts the whole message", () => {
    const raw = encodeStickerMessage(MSG);
    assert.ok(extractStickerMessageStrict(raw), "whole message ok");
    assert.equal(extractStickerMessageStrict(`hi ${raw}`), null, "prose around it rejected");
    assert.equal(extractStickerMessageStrict("hello"), null, "plain text rejected");
  });

  it("rejects envelopes missing required fields", () => {
    const bad = JSON.stringify({ type: "sticker_message", uri: "file:///s.png" });
    assert.equal(extractStickerMessage(bad), null);
  });
});

describe("validation", () => {
  it("pack names: empty rejected, too-long rejected", () => {
    assert.equal(validatePackName("  "), "empty");
    assert.equal(validatePackName("a".repeat(25)), "too-long");
    assert.equal(validatePackName("我的表情"), null);
  });

  it("sticker names: empty rejected, too-long rejected", () => {
    assert.equal(validateStickerName(""), "empty");
    assert.equal(validateStickerName("a".repeat(41)), "too-long");
    assert.equal(validateStickerName("devil-01"), null);
  });

  it("ids are unique", () => {
    assert.notEqual(newStickerId(), newStickerId());
    assert.notEqual(newPackId(), newPackId());
  });

  it("image extension whitelist", () => {
    for (const ext of ["png", "jpg", "jpeg", "gif", "webp", "PNG"]) {
      assert.ok(isStickerImageFile(`a.${ext}`), ext);
    }
    assert.ok(!isStickerImageFile("a.mp4"), "video rejected");
    assert.ok(!isStickerImageFile("a.txt"), "text rejected");
    assert.ok(!isStickerImageFile("noext"), "no extension rejected");
  });
});
