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
  const tools = createImageTools();
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
  const tools = createImageTools();
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
  const tools = createImageTools();
  const result = await tools[0].run({ prompt: "a cat" }, ctx);
  assert.ok(result.includes("FULL refined prompt"), "result should instruct the AI how to iterate");
});
