/**
 * P1 regression guard (P2-27 follow-up): an AI message that is a PURE JSON
 * envelope (no prose) must not render its raw JSON as a text bubble stacked
 * above the voice/image bubble.
 *
 * chat.tsx can't be imported in node tests (React Native), so the render
 * decision lives in the pure `resolveAssistantText` helper and is covered
 * here at the render-decision level: given the same envelope hits chat.tsx
 * computes, the resolved text bubble content must never contain the envelope.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractImageMessage } from "../src/image/protocol.js";
import { extractVoiceMessage } from "../src/message-envelope.js";
import { resolveAssistantText } from "../src/message-text.js";

const VOICE_JSON = JSON.stringify({ type: "voice_message", uri: "file:///a.mp3", duration: 12 });
const IMAGE_JSON = JSON.stringify({
  type: "image_message",
  uri: "file:///b.png",
  prompt: "a cat",
});

/** Mirror exactly how chat.tsx computes the hits before resolving text. */
function resolveChatText(content: string): string {
  const voiceHit = extractVoiceMessage(content);
  const imageHit = !voiceHit ? extractImageMessage(content) : null;
  return resolveAssistantText(content, voiceHit, imageHit);
}

describe("resolveAssistantText (pure-envelope regression)", () => {
  it("pure voice envelope resolves to empty text — raw JSON must NOT render", () => {
    const text = resolveChatText(VOICE_JSON);
    assert.equal(text, "");
    assert.ok(!text.includes("voice_message"), `raw JSON leaked into text bubble: ${text}`);
  });

  it("pure image envelope resolves to empty text — raw JSON must NOT render", () => {
    const text = resolveChatText(IMAGE_JSON);
    assert.equal(text, "");
    assert.ok(!text.includes("image_message"), `raw JSON leaked into text bubble: ${text}`);
  });

  it("prose around the envelope renders as prose only, envelope stripped", () => {
    const content = `故事来啦 ${VOICE_JSON} 点一下就能听`;
    const text = resolveChatText(content);
    assert.ok(text.includes("故事来啦"), `prose lost: ${text}`);
    assert.ok(!text.includes("voice_message"), `envelope leaked into text bubble: ${text}`);
  });

  it("plain AI prose with no envelope renders unchanged", () => {
    const content = "今天天气不错，想出去走走吗";
    assert.equal(resolveChatText(content), content);
  });

  it("non-envelope JSON-looking text renders unchanged", () => {
    const content = '{"note":"not an envelope"}';
    assert.equal(resolveChatText(content), content);
  });
});
