/**
 * Batch 7 I3 — usage stats aggregation (pure, unit-tested).
 *
 * Aggregates the real usage ledger (api-groups/pricing.ts UsageRecord)
 * into range summaries, model/group rankings and per-day buckets.
 */

import type { UsageRecord } from "../api-groups/pricing";

export type StatsRange = "30d" | "month" | "all";

export function rangeStartMs(range: StatsRange, now: number): number {
  if (range === "all") return 0;
  if (range === "30d") return now - 29 * 86_400_000;
  // Previous full month, local-time boundaries.
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
}

export function rangeEndMs(range: StatsRange, now: number): number {
  if (range === "month") {
    const d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  }
  return now;
}

export interface StatsSummary {
  totalUsd: number;
  totalTokens: number;
  requests: number;
  activeDays: number;
  byModel: Array<{ model: string; usd: number; requests: number; tokens: number }>;
  byGroup: Array<{ groupId: string; groupName: string; usd: number }>;
  /** dayKey (yyyy-mm-dd) → { requests, usd }. */
  byDay: Map<string, { requests: number; usd: number }>;
}

export function dayKeyOf(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function summarizeUsage(
  records: UsageRecord[],
  startMs: number,
  endMs: number,
): StatsSummary {
  const byModel = new Map<string, { usd: number; requests: number; tokens: number }>();
  const byGroup = new Map<string, { groupName: string; usd: number }>();
  const byDay = new Map<string, { requests: number; usd: number }>();
  let totalUsd = 0;
  let totalTokens = 0;
  let requests = 0;
  for (const r of records) {
    if (r.at < startMs || r.at >= endMs) continue;
    requests += 1;
    totalUsd += r.costUsd;
    totalTokens += r.inputTokens + r.outputTokens;
    const m = byModel.get(r.model) ?? { usd: 0, requests: 0, tokens: 0 };
    m.usd += r.costUsd;
    m.requests += 1;
    m.tokens += r.inputTokens + r.outputTokens;
    byModel.set(r.model, m);
    const g = byGroup.get(r.groupId) ?? { groupName: r.groupName, usd: 0 };
    g.usd += r.costUsd;
    byGroup.set(r.groupId, g);
    const key = dayKeyOf(r.at);
    const day = byDay.get(key) ?? { requests: 0, usd: 0 };
    day.requests += 1;
    day.usd += r.costUsd;
    byDay.set(key, day);
  }
  return {
    totalUsd,
    totalTokens,
    requests,
    activeDays: byDay.size,
    byModel: [...byModel.entries()]
      .map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.usd - a.usd),
    byGroup: [...byGroup.entries()]
      .map(([groupId, v]) => ({ groupId, ...v }))
      .sort((a, b) => b.usd - a.usd),
    byDay,
  };
}

export function formatUsd(v: number): string {
  if (v < 0.01 && v > 0) return "<$0.01";
  return `$${v.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
