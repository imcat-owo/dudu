/**
 * 图片表情包 tools — tests (mock env, no native modules).
 *
 * Under test:
 *  1. sticker_list returns packs with stickers (AI library first).
 *  2. sticker_send with a real id -> sticker_message envelope JSON whose
 *     uri is the copyForSend result (message-scoped copy), parseable by
 *     extractStickerMessage.
 *  3. sticker_send with a bad id -> ToolError (never invents ids).
 *  4. sticker_send when the persona disabled it -> ToolError.
 *  5. Honest simulation: AI lists the library, sends devil-01.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStickerTools, type StickerToolEnv } from "../src/sticker/tools.js";
import type { Sticker, StickerPack } from "../src/sticker/types.js";
import { extractStickerMessage } from "../src/sticker/types.js";

function mockEnv(opts?: { aiEnabled?: boolean }): StickerToolEnv & { copied: string[] } {
  const copied: string[] = [];
  const aiPack: StickerPack = { id: "ai", name: "AI", owner: "ai", createdAt: 0 };
  const herPack: StickerPack = { id: "sp_1", name: "我的表情", owner: "her", createdAt: 1 };
  const stickers: Sticker[] = [
    { id: "st_devil1", packId: "ai", name: "devil-01", fileName: "devil-01.jpg", createdAt: 0 },
    { id: "st_happy", packId: "sp_1", name: "开心", fileName: "happy.png", createdAt: 1 },
  ];
  return {
    copied,
    listAll: async () => [
      { pack: aiPack, stickers: stickers.filter((s) => s.packId === "ai") },
      { pack: herPack, stickers: stickers.filter((s) => s.packId === "sp_1") },
    ],
    stickerFileUri: async (packId, fileName) => `file:///packs/${packId}/${fileName}`,
    copyForSend: async (src) => {
      const dest = src.replace("/packs/", "/sent/copy-");
      copied.push(dest);
      return dest;
    },
    isAiEnabled: async () => opts?.aiEnabled ?? true,
  };
}

function tool(tools: ReturnType<typeof createStickerTools>, name: string) {
  const t = tools.find((x) => x.name === name);
  assert.ok(t, `${name} registered`);
  return t;
}

describe("sticker_list", () => {
  it("lists the AI library first, then her packs", async () => {
    const tools = createStickerTools(mockEnv());
    const raw = await tool(tools, "sticker_list").run({}, {} as never);
    const list = JSON.parse(raw) as Array<{ packId: string; stickers: unknown[] }>;
    assert.equal(list[0].packId, "ai");
    assert.equal(list[1].packId, "sp_1");
    assert.equal(list[0].stickers.length, 1);
  });
});

describe("sticker_send", () => {
  it("sends a real sticker: envelope uri is the sent-dir copy", async () => {
    const env = mockEnv();
    const tools = createStickerTools(env);
    const raw = await tool(tools, "sticker_send").run({ stickerId: "st_happy" }, {} as never);
    const out = JSON.parse(raw) as { sticker_message: string; sent: { name: string } };
    assert.equal(env.copied.length, 1, "copyForSend called once");
    assert.ok(env.copied[0].includes("/sent/"), "message-scoped copy");
    const hit = extractStickerMessage(out.sticker_message);
    assert.ok(hit, "envelope parses");
    assert.equal(hit.sticker.uri, env.copied[0], "envelope points at the copy, not the pack file");
    assert.equal(hit.sticker.stickerId, "st_happy");
    assert.equal(out.sent.name, "开心");
  });

  it("refuses an unknown id instead of inventing", async () => {
    const tools = createStickerTools(mockEnv());
    await assert.rejects(
      tool(tools, "sticker_send").run({ stickerId: "st_nope" }, {} as never),
      /No sticker with id/,
    );
  });

  it("refuses when the persona turned sticker sending off", async () => {
    const tools = createStickerTools(mockEnv({ aiEnabled: false }));
    await assert.rejects(
      tool(tools, "sticker_send").run({ stickerId: "st_devil1" }, {} as never),
      /turned off/,
    );
  });

  it("honest simulation: AI lists the library and sends devil-01", async () => {
    const env = mockEnv();
    const tools = createStickerTools(env);
    const listRaw = await tool(tools, "sticker_list").run({}, {} as never);
    const list = JSON.parse(listRaw) as Array<{ stickers: Array<{ id: string; name: string }> }>;
    const devil = list[0].stickers.find((s) => s.name === "devil-01");
    assert.ok(devil, "devil-01 in the AI library");
    const sendRaw = await tool(tools, "sticker_send").run({ stickerId: devil.id }, {} as never);
    const out = JSON.parse(sendRaw) as { sticker_message: string };
    const hit = extractStickerMessage(out.sticker_message);
    assert.ok(hit && hit.sticker.packId === "ai", "AI-library sticker bubble ready");
  });
});
