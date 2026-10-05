/**
 * B9: per-model pricing + spend statistics.
 *
 * Learned from Kelivo's pricing: each model carries input/output USD
 * prices per 1M tokens; a stats page shows total spend + per-model
 * ranking; each message can show its own cost. "这个月烧了多少"
 * at a glance.
 *
 * Prices are editable (vendors change them); a small built-in table
 * seeds common models. Usage records are appended per completed
 * request; stats aggregate by day/model/group.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const PRICES_KEY = "dudu.pricing.v1";
const USAGE_KEY = "dudu.usage.v1";
const MAX_USAGE_RECORDS = 5000;

/** USD per 1M tokens. */
export interface ModelPrice {
  input: number;
  output: number;
  /** Cache-read price per 1M (optional, e.g. Anthropic). */
  cacheRead?: number;
}

/** A few sane defaults; she can edit everything. */
export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "o3-mini": { input: 1.1, output: 4.4 },
  "claude-opus-4-1": { input: 15, output: 75, cacheRead: 1.5 },
  "claude-sonnet-4-5": { input: 3, output: 15, cacheRead: 0.3 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1 },
  "deepseek-chat": { input: 0.27, output: 1.1 },
  "deepseek-reasoner": { input: 0.55, output: 2.19 },
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "grok-4": { input: 3, output: 15 },
};

export interface UsageRecord {
  id: string;
  at: number;
  groupId: string;
  groupName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** USD, computed at record time from the price table. */
  costUsd: number;
}

export function costFor(
  model: string,
  inputTokens: number,
  outputTokens: number,
  prices: Record<string, ModelPrice>,
): number {
  const p = prices[model] ?? prices[model.split("/").pop() ?? ""] ?? null;
  if (!p) return 0;
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}

function parsePrices(raw: string | null): Record<string, ModelPrice> {
  if (!raw) return { ...DEFAULT_PRICES };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null)
      return { ...DEFAULT_PRICES, ...(parsed as Record<string, ModelPrice>) };
  } catch {
    // fall through
  }
  return { ...DEFAULT_PRICES };
}

function parseUsage(raw: string | null): UsageRecord[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed))
      return parsed.filter((r) => typeof r?.id === "string");
  } catch {
    // fall through
  }
  return [];
}

export async function loadPrices(): Promise<Record<string, ModelPrice>> {
  try {
    return parsePrices(await AsyncStorage.getItem(PRICES_KEY));
  } catch {
    return { ...DEFAULT_PRICES };
  }
}

export async function savePrices(prices: Record<string, ModelPrice>): Promise<void> {
  try {
    await AsyncStorage.setItem(PRICES_KEY, JSON.stringify(prices));
  } catch {
    // ignore
  }
}

export async function recordUsage(rec: Omit<UsageRecord, "id" | "costUsd"> & { costUsd?: number }): Promise<void> {
  try {
    const prices = await loadPrices();
    const full: UsageRecord = {
      ...rec,
      id: `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      costUsd: rec.costUsd ?? costFor(rec.model, rec.inputTokens, rec.outputTokens, prices),
    };
    const prev = parseUsage(await AsyncStorage.getItem(USAGE_KEY));
    const next = [...prev, full].slice(-MAX_USAGE_RECORDS);
    await AsyncStorage.setItem(USAGE_KEY, JSON.stringify(next));
  } catch {
    // Usage stats must never break the app.
  }
}

export interface SpendStats {
  totalUsd: number;
  totalInput: number;
  totalOutput: number;
  byModel: Array<{ model: string; usd: number; requests: number }>;
  byGroup: Array<{ groupId: string; groupName: string; usd: number }>;
}

/** Aggregate usage since `sinceMs`. Pure over the record list. */
export function aggregateUsage(records: UsageRecord[], sinceMs: number): SpendStats {
  const inRange = records.filter((r) => r.at >= sinceMs);
  const byModel = new Map<string, { usd: number; requests: number }>();
  const byGroup = new Map<string, { groupName: string; usd: number }>();
  let totalUsd = 0;
  let totalInput = 0;
  let totalOutput = 0;
  for (const r of inRange) {
    totalUsd += r.costUsd;
    totalInput += r.inputTokens;
    totalOutput += r.outputTokens;
    const m = byModel.get(r.model) ?? { usd: 0, requests: 0 };
    m.usd += r.costUsd;
    m.requests += 1;
    byModel.set(r.model, m);
    const g = byGroup.get(r.groupId) ?? { groupName: r.groupName, usd: 0 };
    g.usd += r.costUsd;
    byGroup.set(r.groupId, g);
  }
  return {
    totalUsd,
    totalInput,
    totalOutput,
    byModel: [...byModel.entries()]
      .map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.usd - a.usd),
    byGroup: [...byGroup.entries()]
      .map(([groupId, v]) => ({ groupId, ...v }))
      .sort((a, b) => b.usd - a.usd),
  };
}

export async function loadUsageRecords(): Promise<UsageRecord[]> {
  try {
    return parseUsage(await AsyncStorage.getItem(USAGE_KEY));
  } catch {
    return [];
  }
}
