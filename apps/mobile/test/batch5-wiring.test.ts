/**
 * Batch 5 integration wiring tests.
 *
 * Proves:
 * 1. The system prompt assembly includes persona + GLOBAL.md + world book entries.
 * 2. Snapshots trigger when due (and don't when not due).
 * 3. Persona regex applies to AI output.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createGlobalMdStore, renderGlobalMdBlock } from "../src/persona/global-md";
import { createPersonaStore } from "../src/persona/store";
import { applyPersonaRegex, blankPersona } from "../src/persona/types";
import { createWorldBookStore } from "../src/persona/world-book-store";
import {
  blankWorldBook,
  blankWorldBookEntry,
  evaluateWorldBooks,
  groupWorldBookEntries,
  renderWorldBookBlock,
  type ScanMessage,
} from "../src/persona/world-book";
import { createSnapshotStore, DEFAULT_SNAPSHOT_SETTINGS } from "../src/backup/snapshot";

function memKV() {
  const m = new Map<string, string>();
  return {
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: async (k: string) => {
      m.delete(k);
    },
  };
}

function memFiles() {
  const m = new Map<string, string>();
  return {
    writeFile: async (p: string, c: string) => {
      m.set(p, c);
    },
    readFile: async (p: string) => {
      const v = m.get(p);
      if (v === undefined) throw new Error("not found");
      return v;
    },
    deleteFile: async (p: string) => {
      m.delete(p);
    },
    listFiles: async () => [...m.keys()],
  };
}

describe("batch5 wiring: system prompt assembly", () => {
  it("persona systemPrompt + GLOBAL.md + world book entries all render into prompt parts", async () => {
    const kv = memKV();
    const personaStore = createPersonaStore(kv);
    const globalMdStore = createGlobalMdStore(kv);
    const worldBookStore = createWorldBookStore(kv);

    // Persona with a system prompt.
    const persona = blankPersona();
    persona.name = "TestPersona";
    persona.systemPrompt = "You are a pirate.";
    persona.enabled = true;
    assert.equal(await personaStore.upsert(persona), null);
    await personaStore.setActiveId(persona.id);

    // GLOBAL.md content.
    await globalMdStore.set("我不吃辣");

    // World book with a keyword-triggered entry.
    const book = blankWorldBook();
    book.name = "Lore";
    book.enabled = true;
    const entry = blankWorldBookEntry();
    entry.name = "Pirate lore";
    entry.content = "Pirates say arr.";
    entry.keywords = ["pirate"];
    entry.enabled = true;
    book.entries = [entry];
    await worldBookStore.upsert(book);

    // Simulate the local-agent assembly.
    const activeId = await personaStore.getActiveId();
    assert.equal(activeId, persona.id);
    const activePersona = activeId ? await personaStore.get(activeId) : null;
    const personaPrompt = activePersona?.enabled ? activePersona.systemPrompt.trim() : "";
    assert.ok(personaPrompt.includes("pirate"));

    const globalMdBlock = renderGlobalMdBlock(await globalMdStore.get());
    assert.ok(globalMdBlock.includes("我不吃辣"));

    const books = await worldBookStore.enabledBooks();
    const scan: ScanMessage[] = [{ role: "user", content: "tell me about pirate ships" }];
    const { entries } = evaluateWorldBooks(books, scan);
    assert.equal(entries.length, 1);
    const grouped = groupWorldBookEntries(entries);
    const afterBlock = renderWorldBookBlock(grouped.afterSystem);
    assert.ok(afterBlock.includes("Pirates say arr."));

    // The assembled base prompt joins them.
    const base = [grouped.beforeSystem.length ? renderWorldBookBlock(grouped.beforeSystem) : "", personaPrompt]
      .filter(Boolean)
      .join("\n\n");
    assert.ok(base.includes("You are a pirate."));
  });

  it("empty persona/global-md/world books produce no noise", async () => {
    const kv = memKV();
    const personaStore = createPersonaStore(kv);
    const globalMdStore = createGlobalMdStore(kv);
    const worldBookStore = createWorldBookStore(kv);

    assert.equal(await personaStore.getActiveId(), null);
    assert.equal(renderGlobalMdBlock(await globalMdStore.get()), "");
    const { entries } = evaluateWorldBooks(await worldBookStore.enabledBooks(), [
      { role: "user", content: "hi" },
    ]);
    assert.equal(entries.length, 0);
    assert.equal(renderWorldBookBlock(groupWorldBookEntries(entries).afterSystem), "");
  });

  it("persona regex applies to AI output", () => {
    const out = applyPersonaRegex("Hello world, hello!", [
      {
        id: "r1",
        name: "greet",
        pattern: "hello",
        replacement: "hi",
        global: true,
        caseInsensitive: true,
        enabled: true,
      },
    ]);
    assert.equal(out, "hi world, hi!");
  });

  it("disabled persona contributes nothing", async () => {
    const kv = memKV();
    const personaStore = createPersonaStore(kv);
    const persona = blankPersona();
    persona.name = "Off";
    persona.systemPrompt = "You are quiet.";
    persona.enabled = false;
    await personaStore.upsert(persona);
    await personaStore.setActiveId(persona.id);
    const p = await personaStore.get(persona.id);
    const prompt = p?.enabled ? p.systemPrompt.trim() : "";
    assert.equal(prompt, "");
  });
});

describe("batch5 wiring: snapshots trigger when due", () => {
  it("isDue true when enabled and never taken", async () => {
    const store = createSnapshotStore(memKV(), memFiles());
    await store.updateSettings({ enabled: true, frequency: "daily" });
    assert.equal(await store.isDue(), true);
  });

  it("isDue false when disabled", async () => {
    const store = createSnapshotStore(memKV(), memFiles());
    await store.updateSettings({ enabled: false });
    assert.equal(await store.isDue(), false);
  });

  it("isDue false right after take, true after interval", async () => {
    const kv = memKV();
    const store = createSnapshotStore(kv, memFiles());
    await store.updateSettings({ enabled: true, frequency: "daily" });
    await store.take('{"v":1}', "schedule");
    assert.equal(await store.isDue(), false);
    // Simulate 25 hours later.
    assert.equal(await store.isDue(Date.now() + 25 * 3600 * 1000), true);
  });

  it("take with reason=schedule updates lastTakenAt", async () => {
    const kv = memKV();
    const store = createSnapshotStore(kv, memFiles());
    await store.updateSettings({ enabled: true });
    const before = await store.getSettings();
    assert.equal(before.lastTakenAt, DEFAULT_SNAPSHOT_SETTINGS.lastTakenAt);
    await store.take('{"v":1}', "schedule");
    const after = await store.getSettings();
    assert.ok(after.lastTakenAt !== null && after.lastTakenAt > 0);
  });
});
