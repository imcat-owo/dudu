/**
 * B3: balance query — "how much money is left on this key".
 *
 * Learned from Kelivo's provider_balance_badge.dart: per-provider toggle,
 * configurable API path + JSON result path (dot notation, e.g.
 * "data.infos[0].total_balance"), cached briefly, shown as a badge.
 * Failures are silent (badge shows "—") — a balance probe must never
 * break the settings screen.
 */

import { type ApiGroup, normalizeBaseUrl } from "./types";

/** Resolve a dot/bracket path like "data.infos[0].total_balance". Pure. */
export function getPath(obj: unknown, path: string): unknown {
  if (!path.trim()) return undefined;
  const parts = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** Format a raw balance number for the badge. Pure. */
export function formatBalance(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value >= 100 ? value.toFixed(0) : value.toFixed(2);
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return formatBalance(n);
    return value.trim().slice(0, 24);
  }
  return null;
}

const BALANCE_TIMEOUT_MS = 10_000;
// In-memory cache: group id -> {value, at}. 60s TTL, Kelivo-style.
const cache = new Map<string, { value: string | null; at: number }>();
const CACHE_TTL_MS = 60_000;

export function clearBalanceCache(groupId?: string): void {
  if (groupId) {
    for (const k of [...cache.keys()]) if (k.startsWith(`${groupId}|`)) cache.delete(k);
  } else {
    cache.clear();
  }
}

/**
 * Query the balance for a group. Returns the formatted badge text, or
 * null when disabled/unavailable. Never throws.
 */
export async function queryBalance(
  group: ApiGroup,
  headers: Record<string, string>,
): Promise<string | null> {
  const cfg = group.balance;
  if (!cfg?.enabled) return null;
  const cacheKey = `${group.id}|${cfg.apiPath}|${cfg.resultPath}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  let value: string | null = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), BALANCE_TIMEOUT_MS);
    try {
      const res = await fetch(`${normalizeBaseUrl(group.baseUrl)}${cfg.apiPath}`, {
        headers,
        signal: ctrl.signal,
      });
      if (res.ok) {
        const json: unknown = await res.json();
        value = formatBalance(getPath(json, cfg.resultPath));
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Silent — the badge shows "—".
  }
  cache.set(cacheKey, { value, at: Date.now() });
  return value;
}
