import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBlockedInIncognito } from "../src/api-groups/incognito-guard.js";
import { createEvolutionStore } from "../src/evolution/store.js";
import { createEvolutionTools } from "../src/evolution/tools.js";

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      m.set(k, v);
    },
  };
}

function makeTools(store?: ReturnType<typeof createEvolutionStore>) {
  const s = store ?? createEvolutionStore(memStorage());
  const tools = createEvolutionTools({
    evolutionStore: s,
    getPersona: async (id: string) => (id === "p1" ? { id: "p1", name: "小梦" } : null),
    listPersonas: async () => [{ id: "p1", name: "小梦" }],
    nowMs: () => Date.now(),
  });
  const byName = new Map(tools.map((t) => [t.name, t]));
  const ctx = { authorize: async () => true } as never;
  const tool = (name: string) => {
    const t = byName.get(name);
    if (!t) throw new Error(`tool missing: ${name}`);
    return t;
  };
  return { s, byName, ctx, tool };
}

const SRC_ARGS = {
  sourceKind: "chat",
  sourceDateMs: 1_700_000_000_000,
  sourceRef: "主对话框 10/5",
};

describe("evolution tools", () => {
  it("add writes a note and list reads it back", async () => {
    const { tool, ctx } = makeTools();
    const out = await tool("evolution_note_add").run(
      { personaId: "p1", content: "她被逗的时候会开心", ...SRC_ARGS },
      ctx,
    );
    assert.ok(out.includes("Noted"));
    const listed = await tool("evolution_note_list").run({ personaId: "p1" }, ctx);
    assert.ok(listed.includes("她被逗的时候会开心"));
    assert.ok(listed.includes("主对话框 10/5"));
  });

  it("add rejects missing source citation — no false memories", async () => {
    const { tool, ctx } = makeTools();
    await assert.rejects(
      () => tool("evolution_note_add").run({ personaId: "p1", content: "x" }, ctx),
      /source/i,
    );
  });

  it("add rejects unknown personas", async () => {
    const { tool, ctx } = makeTools();
    await assert.rejects(
      () => tool("evolution_note_add").run({ personaId: "ghost", content: "x", ...SRC_ARGS }, ctx),
      /Persona not found/,
    );
  });

  it("edit/delete/reset work through the tools", async () => {
    const { s, tool, ctx } = makeTools();
    await tool("evolution_note_add").run({ personaId: "p1", content: "a", ...SRC_ARGS }, ctx);
    const note = (await s.list("p1"))[0];
    await tool("evolution_note_edit").run({ noteId: note.id, content: "b" }, ctx);
    assert.equal((await s.get(note.id))?.content, "b");
    await tool("evolution_note_delete").run({ noteId: note.id }, ctx);
    assert.equal((await s.list("p1")).length, 0);
    await tool("evolution_note_add").run({ personaId: "p1", content: "c", ...SRC_ARGS }, ctx);
    const out = await tool("evolution_reset").run({ personaId: "p1" }, ctx);
    assert.ok(out.includes("1 evolution note(s) removed"));
    assert.equal((await s.list("p1")).length, 0);
  });

  it("set_enabled toggles the master switch", async () => {
    const { s, tool, ctx } = makeTools();
    await tool("evolution_set_enabled").run({ enabled: false }, ctx);
    assert.equal(await s.isEnabled(), false);
    await assert.rejects(
      () => tool("evolution_note_add").run({ personaId: "p1", content: "x", ...SRC_ARGS }, ctx),
      /evolution is off/,
    );
    await tool("evolution_set_enabled").run({ enabled: true }, ctx);
    assert.equal(await s.isEnabled(), true);
  });

  it("all write tools are blocked in incognito; list stays readable", () => {
    for (const name of [
      "evolution_note_add",
      "evolution_note_edit",
      "evolution_note_delete",
      "evolution_set_enabled",
      "evolution_reset",
    ]) {
      assert.equal(isBlockedInIncognito(name), true, `${name} must be blocked in incognito`);
    }
    assert.equal(isBlockedInIncognito("evolution_note_list"), false);
  });

  it("tool names match the incognito-guard test's writes list", () => {
    const { byName } = makeTools();
    const writes = [...byName.keys()].filter((n) => n !== "evolution_note_list");
    assert.deepEqual(
      writes.sort(),
      [
        "evolution_note_add",
        "evolution_note_delete",
        "evolution_note_edit",
        "evolution_reset",
        "evolution_set_enabled",
      ].sort(),
    );
  });
});
