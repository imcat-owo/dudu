/**
 * AI image generation tool tests — PURE module, no React Native needed.
 *
 * The protocol functions live in ../src/image/protocol.ts (RN-free);
 * image-generation.tsx re-exports them for the UI layer.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { parseImageMessage } from "../src/image/protocol.js";
import { createImageTools } from "../src/image/tools.js";

const ctx = {} as never;

/** The Pollinations fallback would otherwise do a real network check. */
function toolsWithStubVerifier() {
  return createImageTools({ verifyImageUrl: async () => {} });
}

function extractImageJson(result: string): { uri: string; prompt: string } {
  const jsonStart = result.indexOf('{"type":"image_message"');
  assert.ok(jsonStart >= 0, "result must contain image_message JSON");
  const parsed = parseImageMessage(result.slice(jsonStart).split("\n")[0]);
  assert.ok(parsed, "embedded JSON must parse as an image message");
  return parsed;
}

test("generate_image is registered with the right name and params", () => {
  const tools = createImageTools();
  assert.equal(tools.length, 1);
  const t = tools[0];
  assert.equal(t.name, "generate_image");
  assert.equal(t.manualId, "media");
  const props = t.parameters.properties as Record<string, unknown>;
  assert.ok(props.prompt, "prompt param missing");
  assert.ok(props.style, "style param missing");
  assert.deepEqual(t.parameters.required, ["prompt"]);
});

test("generate_image returns a showable image_message JSON", async () => {
  const tools = toolsWithStubVerifier();
  const result = await tools[0].run({ prompt: "a cute cat logo" }, ctx);
  // The result must contain an image_message JSON block the AI can echo.
  const parsed = extractImageJson(result);
  assert.ok(
    parsed.uri.startsWith("https://image.pollinations.ai/prompt/"),
    `unexpected uri: ${parsed.uri}`,
  );
  assert.ok(parsed.uri.includes(encodeURIComponent("a cute cat logo")));
  assert.equal(parsed.prompt, "a cute cat logo");
});

test("generate_image appends style to the generation prompt", async () => {
  const tools = toolsWithStubVerifier();
  const result = await tools[0].run({ prompt: "a cat", style: "cute chibi style" }, ctx);
  const parsed = extractImageJson(result);
  assert.ok(
    parsed.uri.includes(encodeURIComponent("a cat, cute chibi style")),
    `style not appended: ${parsed.uri}`,
  );
});

test("generate_image rejects empty prompt", async () => {
  const tools = createImageTools();
  await assert.rejects(() => tools[0].run({ prompt: "   " }, ctx), /prompt is required/);
  await assert.rejects(() => tools[0].run({}, ctx), /prompt is required/);
});

test("generate_image result teaches iteration", async () => {
  const tools = toolsWithStubVerifier();
  const result = await tools[0].run({ prompt: "a cat" }, ctx);
  assert.ok(result.includes("FULL refined prompt"), "result should instruct the AI how to iterate");
});

test("generate_image fails honestly when the free backend URL does not resolve (P1-3)", async () => {
  const tools = createImageTools({
    verifyImageUrl: async () => {
      throw new Error("free backend returned HTTP 502");
    },
  });
  await assert.rejects(
    () => tools[0].run({ prompt: "a cat" }, ctx),
    /didn't return a usable image.*honestly it didn't work/s,
    "must throw an honest ToolError instead of announcing a fake image",
  );
});

test("generate_image verifies the exact Pollinations URL it will show (P1-3)", async () => {
  let verifiedUrl: string | null = null;
  const tools = createImageTools({
    verifyImageUrl: async (url) => {
      verifiedUrl = url;
    },
  });
  const result = await tools[0].run({ prompt: "a cat" }, ctx);
  const parsed = extractImageJson(result);
  assert.equal(verifiedUrl, parsed.uri, "the verified URL must be the one shown to her");
});
