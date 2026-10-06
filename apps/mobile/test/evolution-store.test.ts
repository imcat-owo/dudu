import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEvolutionStore, EVOLUTION_KEYS } from "../src/evolution/store.js";

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      m.set(k, v);
    },
  };
}

const SRC = { kind: "chat" as const, dateMs: 1_700_000_000_000, ref: "主对话框 10/5" };

describe("evolution store", () => {
  it("adds a note with source citation, newest first", async () => {
    const s = createEvolutionStore(memStorage());
    const a = await s.add({
      personaId: "p1",
      content: "她被逗的时候会开心",
      source: SRC,
      nowMs: 1000,
    });
    assert.ok(a.id.startsWith("ev_"));
    assert.equal(a.personaId, "p1");
    assert.equal(a.source.ref, "主对话框 10/5");
    const b = await s.add({ personaId: "p1", content: "太黏她会安静", source: SRC, nowMs: 2000 });
    const list = await s.list("p1");
    assert.equal(list.length, 2);
    assert.equal(list[0].id, b.id); // newest first
    assert.equal(list[1].id, a.id);
  });

  it("isolates notes per persona", async () => {
    const s = createEvolutionStore(memStorage());
    await s.add({ personaId: "p1", content: "note one", source: SRC });
    await s.add({ personaId: "p2", content: "note two", source: SRC });
    assert.equal((await s.list("p1")).length, 1);
    assert.equal((await s.list("p2"))[0].content, "note two");
  });

  it("refuses notes without a source citation", async () => {
    const s = createEvolutionStore(memStorage());
    await assert.rejects(
      () =>
        s.add({
          personaId: "p1",
          content: "no source",
          source: { kind: "chat", dateMs: 0, ref: "" } as never,
        }),
      /source/i,
    );
  });

  it("refuses to write notes when evolution is off", async () => {
    const s = createEvolutionStore(memStorage());
    await s.setEnabled(false);
    await assert.rejects(
      () => s.add({ personaId: "p1", content: "x", source: SRC }),
      /evolution is off/,
    );
    assert.equal(await s.isEnabled(), false);
  });

  it("edits content, keeps source honest", async () => {
    const s = createEvolutionStore(memStorage());
    const n = await s.add({ personaId: "p1", content: "old", source: SRC });
    const next = await s.edit(n.id, { content: "new" });
    assert.equal(next.content, "new");
    assert.equal(next.source.ref, SRC.ref); // citation survives
    await assert.rejects(() => s.edit(n.id, { content: "" }), /non-empty/);
  });

  it("deletes a single note", async () => {
    const s = createEvolutionStore(memStorage());
    const a = await s.add({ personaId: "p1", content: "a", source: SRC });
    await s.add({ personaId: "p1", content: "b", source: SRC });
    await s.remove(a.id);
    const list = await s.list("p1");
    assert.equal(list.length, 1);
    assert.equal(list[0].content, "b");
  });

  it("reset wipes only that persona's notes", async () => {
    const s = createEvolutionStore(memStorage());
    await s.add({ personaId: "p1", content: "a", source: SRC });
    await s.add({ personaId: "p1", content: "b", source: SRC });
    await s.add({ personaId: "p2", content: "c", source: SRC });
    const dropped = await s.reset("p1");
    assert.equal(dropped, 2);
    assert.equal((await s.list("p1")).length, 0);
    assert.equal((await s.list("p2")).length, 1);
  });

  it("tracks the last-distilled timestamp", async () => {
    const s = createEvolutionStore(memStorage());
    assert.equal(await s.lastDistilledAt(), 0);
    await s.add({ personaId: "p1", content: "a", source: SRC, nowMs: 4242 });
    assert.equal(await s.lastDistilledAt(), 4242);
  });

  it("uses the documented storage keys", () => {
    assert.equal(EVOLUTION_KEYS.notes, "dudu.evolution.v1.notes");
    assert.equal(EVOLUTION_KEYS.enabled, "dudu.evolution.v1.enabled");
    assert.equal(EVOLUTION_KEYS.lastDistilled, "dudu.evolution.v1.lastDistilled");
  });
});
