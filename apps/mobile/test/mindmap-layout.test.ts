/**
 * 记忆 Mind Map — layout tests.
 *
 * Under test:
 *  1. Edges come ONLY from real metadata: supersededBy chains and
 *     same-category + 7-day time proximity. Unrelated memories get no
 *     edge — connections are never invented.
 *  2. Together edges are capped per node (nearest first).
 *  3. Layout is deterministic: same input → same positions.
 *  4. Node size grows with reinforcedCount; labels truncate.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MemoryRecord } from "../src/memory/types.js";
import { buildMindMap, spiralPos, TOGETHER_WINDOW_MS } from "../src/mindmap/layout.js";

const DAY = 24 * 3600 * 1000;
const T0 = Date.UTC(2026, 9, 1);

function rec(partial: Partial<MemoryRecord> & { id: string }): MemoryRecord {
  return {
    content: `memory ${partial.id}`,
    category: "fact",
    confidence: "confident",
    validFrom: T0,
    validTo: null,
    supersededBy: null,
    reinforcedCount: 0,
    source: "test",
    createdAt: T0,
    updatedAt: T0,
    ...partial,
  };
}

function hasEdge(
  edges: { from: string; to: string; kind: string }[],
  a: string,
  b: string,
  kind: string,
) {
  return edges.some(
    (e) => e.kind === kind && ((e.from === a && e.to === b) || (e.from === b && e.to === a)),
  );
}

describe("buildMindMap edges", () => {
  it("links supersededBy chains", () => {
    const old = rec({ id: "old" });
    const cur = rec({ id: "cur", validFrom: T0 + DAY });
    old.supersededBy = "cur";
    const { edges } = buildMindMap([old, cur]);
    assert.ok(hasEdge(edges, "old", "cur", "supersedes"));
  });

  it("links same-category memories within 7 days, not unrelated ones", () => {
    const a = rec({ id: "a", category: "preference", validFrom: T0 });
    const b = rec({ id: "b", category: "preference", validFrom: T0 + 2 * DAY });
    const c = rec({ id: "c", category: "preference", validFrom: T0 + 30 * DAY }); // too far
    const d = rec({ id: "d", category: "goal", validFrom: T0 + DAY }); // other category
    const { edges } = buildMindMap([a, b, c, d]);
    assert.ok(hasEdge(edges, "a", "b", "together"), "a-b should link");
    assert.ok(!hasEdge(edges, "a", "c", "together"), "a-c too far apart");
    assert.ok(!hasEdge(edges, "b", "c", "together"), "b-c too far apart");
    assert.ok(!hasEdge(edges, "a", "d", "together"), "a-d different category");
    assert.ok(!hasEdge(edges, "b", "d", "together"), "b-d different category");
  });

  it("treats the 7-day boundary honestly", () => {
    const a = rec({ id: "a", validFrom: T0 });
    const b = rec({ id: "b", validFrom: T0 + TOGETHER_WINDOW_MS });
    const { edges } = buildMindMap([a, b]);
    assert.ok(hasEdge(edges, "a", "b", "together"), "exactly 7 days counts");
  });

  it("caps together edges per node, nearest first", () => {
    const center = rec({ id: "center", validFrom: T0 });
    const near = [1, 2, 3, 4, 5].map((i) => rec({ id: `n${i}`, validFrom: T0 + i * DAY }));
    const { edges } = buildMindMap([center, ...near]);
    const centerEdges = edges.filter(
      (e) => e.kind === "together" && (e.from === "center" || e.to === "center"),
    );
    assert.ok(centerEdges.length <= 3, `got ${centerEdges.length}`);
    // Nearest-first: every center edge is within 4 days (n5 never wins).
    for (const e of centerEdges) {
      const other = e.from === "center" ? e.to : e.from;
      const idx = Number(other.slice(1));
      assert.ok(idx <= 4, `${other} is not among the nearest`);
    }
    assert.ok(!centerEdges.some((e) => e.from === "n5" || e.to === "n5"), "n5 must lose");
  });

  it("never invents edges for unrelated memories", () => {
    const a = rec({ id: "a", category: "fact", validFrom: T0 });
    const b = rec({ id: "b", category: "goal", validFrom: T0 + 100 * DAY });
    const { edges } = buildMindMap([a, b]);
    assert.equal(edges.length, 0);
  });
});

describe("buildMindMap nodes", () => {
  it("is deterministic", () => {
    const records = [1, 2, 3, 4, 5].map((i) => rec({ id: `m${i}`, validFrom: T0 + i * DAY }));
    const p1 = buildMindMap(records).nodes.map((nd) => [nd.x, nd.y]);
    const p2 = buildMindMap(records).nodes.map((nd) => [nd.x, nd.y]);
    assert.deepEqual(p1, p2);
  });

  it("sizes nodes by reinforcedCount and truncates labels", () => {
    const quiet = rec({ id: "q", content: "short" });
    const loud = rec({ id: "l", content: "x".repeat(50), reinforcedCount: 6 });
    const { nodes } = buildMindMap([quiet, loud]);
    const nq = nodes.find((nd) => nd.id === "q");
    const nl = nodes.find((nd) => nd.id === "l");
    assert.ok(nq, "quiet node exists");
    assert.ok(nl, "loud node exists");
    assert.ok(nl.r > nq.r, "reinforced node is bigger");
    assert.ok(nl.label.length <= 15, `label: ${nl.label}`);
    assert.equal(nq.label, "short");
  });

  it("stays inside the viewBox", () => {
    const records = Array.from({ length: 120 }, (_, i) =>
      rec({ id: `m${i}`, validFrom: T0 + i * 3600 * 1000 }),
    );
    const { nodes } = buildMindMap(records);
    for (const nd of nodes) {
      assert.ok(nd.x >= 0 && nd.x <= 100, `x=${nd.x}`);
      assert.ok(nd.y >= 0 && nd.y <= 100, `y=${nd.y}`);
    }
  });

  it("spiralPos centers a single node", () => {
    assert.deepEqual(spiralPos(0, 1), { x: 50, y: 50 });
  });
});
