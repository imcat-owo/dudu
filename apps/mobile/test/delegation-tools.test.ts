/**
 * 7 new AI delegation tool tests — PURE modules, no React Native needed.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createThemeTools } from "../src/theme/tools.js";
import { createFontSizeTools } from "../src/settings/tools.js";
import { createPetSkinTools } from "../src/pet/tools.js";
import { createTtsVoiceTools } from "../src/voice/tools.js";
import { createDialogTools } from "../src/chat/dialog-tools.js";
import { createKnowledgeAddTools } from "../src/knowledge/tools.js";

function memStorage() {
  const map = new Map<string, string>();
  return {
    getItem: async (k: string) => map.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      map.set(k, v);
    },
    _map: map,
  };
}

test("set_theme switches mode", async () => {
  const s = memStorage();
  const [tool] = createThemeTools(s);
  assert.equal(tool.name, "set_theme");
  const res = await tool.run({ mode: "dark" }, {});
  assert.match(res as string, /dark/);
  const bundle = JSON.parse(s._map.get("dudu.theme.bundle.v1")!);
  assert.equal(bundle.mode, "dark");
});

test("set_theme rejects bad mode", async () => {
  const s = memStorage();
  const [tool] = createThemeTools(s);
  await assert.rejects(() => tool.run({ mode: "neon" }, {}));
});

test("set_ai_avatar sets and resets", async () => {
  const s = memStorage();
  const tools = createThemeTools(s);
  const tool = tools.find((t) => t.name === "set_ai_avatar")!;
  await tool.run({ uri: "https://example.com/a.png" }, {});
  let bundle = JSON.parse(s._map.get("dudu.theme.bundle.v1")!);
  assert.equal(bundle.avatar.assistant, "https://example.com/a.png");
  await tool.run({ uri: "" }, {});
  bundle = JSON.parse(s._map.get("dudu.theme.bundle.v1")!);
  assert.ok(!bundle.avatar.assistant);
});

test("set_font_size writes option", async () => {
  const s = memStorage();
  const [tool] = createFontSizeTools(s);
  assert.equal(tool.name, "set_font_size");
  await tool.run({ option: "large" }, {});
  assert.equal(s._map.get("dudu.settings.fontSize.v1"), "large");
});

test("set_font_size rejects bad option", async () => {
  const s = memStorage();
  const [tool] = createFontSizeTools(s);
  await assert.rejects(() => tool.run({ option: "huge" }, {}));
});

test("set_pet_skin handles sora/devil/custom", async () => {
  const s = memStorage();
  const [tool] = createPetSkinTools(s);
  assert.equal(tool.name, "set_pet_skin");
  await tool.run({ skin: "devil:3" }, {});
  let state = JSON.parse(s._map.get("dudu.pet.v1.state")!);
  assert.deepEqual(state.skin, { kind: "devil", index: 3 });
  await tool.run({ skin: "sora" }, {});
  state = JSON.parse(s._map.get("dudu.pet.v1.state")!);
  assert.deepEqual(state.skin, { kind: "sora" });
});

test("set_pet_skin rejects bad index", async () => {
  const s = memStorage();
  const [tool] = createPetSkinTools(s);
  await assert.rejects(() => tool.run({ skin: "devil:99" }, {}));
  await assert.rejects(() => tool.run({ skin: "dragon" }, {}));
});

test("set_tts_voice updates voice and speed", async () => {
  let saved: unknown = null;
  const fakeStore = {
    getSnapshot: () => ({ tts: { provider: "edge", voice: "old" } }),
    setTts: async (cfg: unknown) => {
      saved = cfg;
    },
  } as never;
  const [tool] = createTtsVoiceTools(fakeStore);
  assert.equal(tool.name, "set_tts_voice");
  await tool.run({ voice: "zh-CN-XiaoxiaoNeural", speed: 1.2 }, {});
  assert.equal((saved as { voice: string }).voice, "zh-CN-XiaoxiaoNeural");
  assert.equal((saved as { speed: number }).speed, 1.2);
});

test("set_tts_voice requires something to change", async () => {
  const fakeStore = {
    getSnapshot: () => ({ tts: {} }),
    setTts: async () => {},
  } as never;
  const [tool] = createTtsVoiceTools(fakeStore);
  await assert.rejects(() => tool.run({}, {}));
});

test("new_dialog is registered", () => {
  const [tool] = createDialogTools();
  assert.equal(tool.name, "new_dialog");
});

test("knowledge_add_doc validates inputs", async () => {
  const fakeStore = {
    addDoc: async () => ({ id: "d1" }),
    updateDoc: async () => {},
  } as never;
  const [tool] = createKnowledgeAddTools(fakeStore, {
    getGroup: () => null,
  });
  assert.equal(tool.name, "knowledge_add_doc");
  await assert.rejects(() => tool.run({ name: "", text: "hi" }, {}));
  await assert.rejects(() => tool.run({ name: "x", text: "  " }, {}));
  // No API group → honest error, not silent
  await assert.rejects(() => tool.run({ name: "x", text: "hello" }, {}));
});
