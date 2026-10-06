/**
 * 记忆可视化 Mind Map — PURE layout module, no React Native imports.
 *
 * The memory garden is a list; this builds the graph behind the 图谱
 * (mind map) view: memories as nodes, edges from REAL metadata only —
 * never invented connections.
 *
 * Edge sources (all real record metadata):
 * - "supersedes": a.supersededBy === b.id — a memory replaced by a newer
 *   one (both ends must be in the input set).
 * - "together": same category AND validFrom within 7 days of each other.
 *   Time-proximate, same-kind memories tend to belong to one episode.
 *
 * Layout: deterministic golden-angle spiral, newest outermost, node size
 * by reinforcedCount. No randomness, no heavy deps — stable across
 * renders. Coordinates are 0..100 viewBox units.
 */

import { type GardenState, gardenStateOf, type MemoryRecord } from "../memory/types";

/** Two memories count as time-proximate within this window. */
export const TOGETHER_WINDOW_MS = 7 * 24 * 3600 * 1000;
/** Max "together" edges kept per node (nearest first) — no hairballs. */
const MAX_TOGETHER_PER_NODE = 3;

export interface MindNode {
  id: string;
  x: number;
  y: number;
  /** Radius in viewBox units, scaled by reinforcedCount. */
  r: number;
  /** Short label (truncated content). */
  label: string;
  state: GardenState;
  category: string;
  /** Unix ms, for the detail card. */
  validFrom: number;
  reinforcedCount: number;
}

export interface MindEdge {
  from: string;
  to: string;
  kind: "supersedes" | "together";
}

export interface MindMap {
  nodes: MindNode[];
  edges: MindEdge[];
}

/** Deterministic golden-angle spiral position for rank i of n. */
export function spiralPos(i: number, n: number): { x: number; y: number } {
  if (n <= 1) return { x: 50, y: 50 };
  const golden = Math.PI * (3 - Math.sqrt(5));
  const angle = i * golden;
  // Radius grows with sqrt so density stays even; fits 0..100.
  const radius = 6 + 40 * Math.sqrt(i / (n - 1));
  return {
    x: 50 + radius * Math.cos(angle),
    y: 50 + radius * Math.sin(angle),
  };
}

const f1 = (n: number) => Number(n.toFixed(1));

export function buildMindMap(records: MemoryRecord[]): MindMap {
  // Oldest first → newest outermost on the spiral.
  const sorted = [...records].sort((a, b) => a.validFrom - b.validFrom);
  const n = sorted.length;
  const byId = new Map(sorted.map((r) => [r.id, r]));

  const nodes: MindNode[] = sorted.map((r, i) => {
    const p = spiralPos(i, n);
    return {
      id: r.id,
      x: f1(Math.min(96, Math.max(4, p.x))),
      y: f1(Math.min(96, Math.max(4, p.y))),
      r: f1(2.2 + Math.min(2.4, (r.reinforcedCount || 0) * 0.4)),
      label: r.content.length > 14 ? `${r.content.slice(0, 14)}…` : r.content,
      state: gardenStateOf(r),
      category: r.category,
      validFrom: r.validFrom,
      reinforcedCount: r.reinforcedCount || 0,
    };
  });

  const edges: MindEdge[] = [];
  const seen = new Set<string>();
  const addEdge = (a: string, b: string, kind: MindEdge["kind"]) => {
    if (a === b) return;
    const key = a < b ? `${a}|${b}|${kind}` : `${b}|${a}|${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from: a, to: b, kind });
  };

  // 1. Supersedes chains — real replacement links.
  for (const r of sorted) {
    if (r.supersededBy && byId.has(r.supersededBy)) {
      addEdge(r.id, r.supersededBy, "supersedes");
    }
  }

  // 2. Together edges — same category + time proximity, nearest first.
  const togetherCount = new Map<string, number>();
  const candidates: { a: string; b: string; gap: number }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      if (a.category !== b.category) continue;
      const gap = Math.abs(a.validFrom - b.validFrom);
      if (gap <= TOGETHER_WINDOW_MS) candidates.push({ a: a.id, b: b.id, gap });
    }
  }
  candidates.sort((x, y) => x.gap - y.gap);
  for (const c of candidates) {
    const ca = togetherCount.get(c.a) ?? 0;
    const cb = togetherCount.get(c.b) ?? 0;
    if (ca >= MAX_TOGETHER_PER_NODE || cb >= MAX_TOGETHER_PER_NODE) continue;
    addEdge(c.a, c.b, "together");
    togetherCount.set(c.a, ca + 1);
    togetherCount.set(c.b, cb + 1);
  }

  return { nodes, edges };
}
