/**
 * Memory reinforcement (P2-5, design doc §8) — regression tests.
 *
 * - reinforcedCount defaults to 0 (new records) and backfills to 0 for
 *   records written before the field existed.
 * - memory_confirm +1; memory_reinforce +1.
 * - Retrieval weights reinforcement gently (capped), never as a veto.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MemoryStore } from "../src/memory/store.js";
import { searchMemories } from "../src/memory/search.js";
import type { MemoryRecord } from "../src/memory/types.js";

function memStorage() {
  const map = new Map<string, string>();
  return {
    getItem: async (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: async (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

function rec(over: Partial<MemoryRecord> = {}): MemoryRecord {
  const now = Date.now();
  return {
    id: "mem_test",
    content: "她喜欢抹茶味的蛋糕",
    category: "preference",
    confidence: "confident",
    validFrom: now,
    validTo: null,
    supersededBy: null,
    reinforcedCount: 0,
    source: "test",
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

describe("reinforcedCount", () => {
  it("new records start at 0", async () => {
    const store = new MemoryStore(memStorage());
    const r = await store.addMemory("她喜欢抹茶味的蛋糕");
    assert.equal(r.reinforcedCount, 0);
  });

  it("old records without the field backfill to 0 on load", async () => {
    const storage = memStorage();
    const store = new MemoryStore(storage);
    const r = await store.addMemory("她喜欢抹茶味的蛋糕");
    // Simulate a pre-field record: strip reinforcedCount from storage.
    const raw = await storage.getItem("dudu.memory.v1.memories");
    assert.ok(raw);
    const parsed = JSON.parse(raw) as Record<string, unknown>[];
    delete parsed[0].reinforcedCount;
    await storage.setItem("dudu.memory.v1.memories", JSON.stringify(parsed));
    const loaded = await store.listMemories();
    assert.equal(loaded.find((m) => m.id === r.id)?.reinforcedCount, 0);
  });

  it("confirmMemory +1 and reinforceMemory +1", async () => {
    const store = new MemoryStore(memStorage());
    const r = await store.addMemory("她喜欢抹茶味的蛋糕", { confidence: "unsure" });
    const confirmed = await store.confirmMemory(r.id, "user");
    assert.equal(confirmed.reinforcedCount, 1);
    const reinforced = await store.reinforceMemory(r.id, "ai");
    assert.equal(reinforced.reinforcedCount, 2);
  });

  it("supersede carries reinforcement forward", async () => {
    const store = new MemoryStore(memStorage());
    const r = await store.addMemory("她喜欢抹茶味的蛋糕");
    await store.reinforceMemory(r.id, "ai");
    await store.reinforceMemory(r.id, "ai");
    const next = await store.supersedeMemory(r.id, "她喜欢抹茶和巧克力味的蛋糕");
    assert.equal(next.reinforcedCount, 2);
  });

  it("reinforced memories rank higher, capped and never a veto", () => {
    const a = rec({ id: "a", content: "抹茶蛋糕是她最喜欢的甜点抹茶", reinforcedCount: 10 });
    const b = rec({ id: "b", content: "抹茶蛋糕店在街角新开了一家抹茶", reinforcedCount: 0 });
    const ranked = searchMemories([b, a], "抹茶蛋糕");
    assert.ok(ranked.length >= 2);
    assert.equal(ranked[0].record.id, "a");
    // Cap: 12 max → multiplier ≤ 1.6. Even 1000 reinforcements cannot exceed it.
    const c = rec({ id: "c", content: "抹茶蛋糕是她最喜欢的甜点抹茶", reinforcedCount: 1000 });
    const ranked2 = searchMemories([a, c], "抹茶蛋糕");
    assert.ok(
      ranked2[0].score / ranked2[1].score < 1.61,
      `cap violated: ${ranked2[0].score} / ${ranked2[1].score}`,
    );
    // Veto check: an unreinforced exact hit still outranks a reinforced weak hit.
    const weak = rec({ id: "w", content: "抹茶", reinforcedCount: 12 });
    const strong = rec({ id: "s", content: "抹茶蛋糕是她最喜欢的甜点抹茶蛋糕", reinforcedCount: 0 });
    const ranked3 = searchMemories([weak, strong], "抹茶蛋糕");
    assert.equal(ranked3[0].record.id, "s");
  });
});
