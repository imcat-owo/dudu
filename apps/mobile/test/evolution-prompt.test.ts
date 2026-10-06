import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEvolutionSection,
  DISTILL_HINT_INTERVAL_MS,
  shouldDistillHint,
} from "../src/evolution/prompt.js";
import { createEvolutionStore } from "../src/evolution/store.js";
import type { EvolutionNote } from "../src/evolution/types.js";

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      m.set(k, v);
    },
  };
}

const NOTE: EvolutionNote = {
  id: "ev_1",
  personaId: "p1",
  content: "她被逗的时候会开心",
  source: { kind: "chat", dateMs: 1_700_000_000_000, ref: "主对话框 10/5" },
  createdAt: 1,
  updatedAt: 1,
};

describe("evolution prompt section", () => {
  it("injects the note with its source citation", () => {
    const sec = buildEvolutionSection([NOTE], {
      personaName: "小梦",
      enabled: true,
      lastDistilledAt: Date.now(),
      nowMs: Date.now(),
    });
    assert.ok(sec.includes("她被逗的时候会开心"), "content must ride the prompt");
    assert.ok(sec.includes("主对话框 10/5"), "source citation must ride the prompt");
    assert.ok(sec.toLowerCase().includes("what you have learned"), "section header present");
  });

  it("returns empty when disabled — nothing leaks into the prompt", () => {
    const sec = buildEvolutionSection([NOTE], {
      personaName: "小梦",
      enabled: false,
      lastDistilledAt: 0,
      nowMs: Date.now(),
    });
    assert.equal(sec, "");
  });

  it("returns empty when there are no notes and no hint due", () => {
    const sec = buildEvolutionSection([], {
      personaName: "小梦",
      enabled: true,
      lastDistilledAt: Date.now(),
      nowMs: Date.now(),
    });
    assert.equal(sec, "");
  });

  it("nudges a weekly review when distillation is overdue", () => {
    assert.equal(DISTILL_HINT_INTERVAL_MS, 7 * 24 * 3_600_000);
    const now = Date.now();
    assert.equal(shouldDistillHint(0, now), true);
    assert.equal(shouldDistillHint(now - 1000, now), false);
    assert.equal(shouldDistillHint(now - DISTILL_HINT_INTERVAL_MS - 1, now), true);
    const sec = buildEvolutionSection([], {
      personaName: "小梦",
      enabled: true,
      lastDistilledAt: 0,
      nowMs: now,
    });
    assert.ok(sec.includes("evolution_note_add"), "overdue hint names the tool");
  });

  it("caps note count and budget", () => {
    const notes: EvolutionNote[] = Array.from({ length: 20 }, (_, i) => ({
      ...NOTE,
      id: `ev_${i}`,
      content: `pattern ${i} `.repeat(20),
    }));
    const sec = buildEvolutionSection(notes, {
      personaName: "小梦",
      enabled: true,
      lastDistilledAt: Date.now(),
      nowMs: Date.now(),
    });
    assert.ok(sec.length <= 810, `section must be budgeted, got ${sec.length}`);
    assert.ok(!sec.includes("pattern 19"), "only the newest 5 ride");
  });
});

describe("evolution honest simulation", () => {
  it("a week of chats -> note -> prompt contains it -> she deletes -> prompt no longer contains it", async () => {
    const store = createEvolutionStore(memStorage());
    const now = Date.now();
    // Week of chats: the AI distills a repeated pattern.
    const note = await store.add({
      personaId: "p1",
      content: "她被逗的时候会开心，多逗她",
      source: { kind: "chat", dateMs: now - 3 * 24 * 3_600_000, ref: "主对话框 10/3" },
      nowMs: now,
    });
    const before = buildEvolutionSection(await store.list("p1"), {
      personaName: "小梦",
      enabled: await store.isEnabled(),
      lastDistilledAt: await store.lastDistilledAt(),
      nowMs: now,
    });
    assert.ok(before.includes(note.content), "note rides the next conversation's prompt");

    // She deletes it in Our Space → 成长记录.
    await store.remove(note.id);
    const after = buildEvolutionSection(await store.list("p1"), {
      personaName: "小梦",
      enabled: await store.isEnabled(),
      lastDistilledAt: await store.lastDistilledAt(),
      nowMs: now,
    });
    assert.ok(!after.includes(note.content), "deleted note is off the prompt immediately");
  });
});
