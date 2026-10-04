import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeCanSend } from "../src/chat-send-gate.js";

function base() {
  return { text: "", imageCount: 0, fileCount: 0, loaded: true, isReady: true, replying: false };
}

describe("P1-6: send gate matches send()'s gate", () => {
  it("empty draft with no attachments cannot send", () => {
    assert.equal(computeCanSend(base()), false);
    assert.equal(computeCanSend({ ...base(), text: "   " }), false);
  });

  it("text alone can send", () => {
    assert.equal(computeCanSend({ ...base(), text: "hi" }), true);
  });

  it("P1-6 regression: image-only attachments can send", () => {
    assert.equal(computeCanSend({ ...base(), imageCount: 1 }), true);
  });

  it("P1-6 regression: file-only attachments can send", () => {
    assert.equal(computeCanSend({ ...base(), fileCount: 2 }), true);
  });

  it("blocked while not loaded or not ready", () => {
    assert.equal(computeCanSend({ ...base(), text: "hi", loaded: false }), false);
    assert.equal(computeCanSend({ ...base(), text: "hi", isReady: false }), false);
    assert.equal(computeCanSend({ ...base(), imageCount: 1, loaded: false }), false);
  });

  it("replying (stop mode) is always enabled", () => {
    assert.equal(computeCanSend({ ...base(), replying: true }), true);
    assert.equal(
      computeCanSend({ ...base(), replying: true, loaded: false, isReady: false }),
      true,
    );
  });
});
