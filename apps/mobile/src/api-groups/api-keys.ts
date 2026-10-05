/**
 * B2: per-group API key pool with rotation strategies.
 *
 * Learned from Kelivo's api_key_manager.dart (Chevey339/kelivo):
 * - 4 strategies: roundRobin / priority / leastUsed / random
 * - keys auto-disable after N consecutive failures, recover after M minutes
 * - usage counters feed the leastUsed strategy
 *
 * Pure functions + a small stateful selector. Secrets (the key strings)
 * never appear in logs — selection results expose only key ids.
 */

import type { ApiGroup, ApiKeyEntry, KeyRotationStrategy } from "./types";

export function newApiKeyId(): string {
  return `k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function blankApiKey(name = ""): ApiKeyEntry {
  return {
    id: newApiKeyId(),
    name,
    key: "",
    priority: 5,
    enabled: true,
    consecutiveFailures: 0,
    totalRequests: 0,
    disabledUntil: null,
    lastError: null,
    createdAt: Date.now(),
  };
}

export const DEFAULT_AUTO_DISABLE_AFTER = 3;
export const DEFAULT_RECOVER_AFTER_MINUTES = 5;

/** Keys eligible for selection right now. */
export function availableKeys(group: ApiGroup, now: number = Date.now()): ApiKeyEntry[] {
  const pool = group.apiKeys ?? [];
  const recoverMs = (group.keyRecoverAfterMinutes ?? DEFAULT_RECOVER_AFTER_MINUTES) * 60_000;
  return pool.filter((k) => {
    if (!k.enabled) return false;
    if (k.disabledUntil != null) {
      if (now < k.disabledUntil) return false;
      // Cooldown elapsed — the key becomes eligible again (auto-recovery).
    }
    return k.key.trim().length > 0;
  });
}

/**
 * Pick a key id for the next request. Pure given the inputs + the
 * round-robin cursor. Returns null when the pool is empty/unusable.
 */
export function selectKeyId(
  group: ApiGroup,
  cursor: { index: number },
  now: number = Date.now(),
): { keyId: string | null; strategy: KeyRotationStrategy } {
  const strategy: KeyRotationStrategy = group.keyRotation ?? "roundRobin";
  const pool = availableKeys(group, now);
  if (pool.length === 0) return { keyId: null, strategy };
  let chosen: ApiKeyEntry;
  switch (strategy) {
    case "priority": {
      chosen = [...pool].sort((a, b) => a.priority - b.priority)[0];
      break;
    }
    case "leastUsed": {
      chosen = [...pool].sort((a, b) => a.totalRequests - b.totalRequests)[0];
      break;
    }
    case "random": {
      chosen = pool[Math.floor(Math.random() * pool.length)];
      break;
    }
    case "roundRobin":
    default: {
      const idx = cursor.index % pool.length;
      chosen = pool[idx];
      cursor.index = (idx + 1) % pool.length;
      break;
    }
  }
  return { keyId: chosen.id, strategy };
}

/**
 * Record a request outcome against a key. Returns the updated entry.
 * On reaching the failure threshold the key is auto-disabled until
 * now + recoverAfterMinutes (Kelivo behavior).
 */
export function recordKeyResult(
  key: ApiKeyEntry,
  ok: boolean,
  group: ApiGroup,
  now: number = Date.now(),
  error?: string,
): ApiKeyEntry {
  const threshold = group.keyAutoDisableAfter ?? DEFAULT_AUTO_DISABLE_AFTER;
  const recoverMs = (group.keyRecoverAfterMinutes ?? DEFAULT_RECOVER_AFTER_MINUTES) * 60_000;
  if (ok) {
    return {
      ...key,
      consecutiveFailures: 0,
      totalRequests: key.totalRequests + 1,
      disabledUntil: null,
      lastError: null,
    };
  }
  const failures = key.consecutiveFailures + 1;
  return {
    ...key,
    consecutiveFailures: failures,
    lastError: error ?? key.lastError,
    disabledUntil: failures >= threshold ? now + recoverMs : key.disabledUntil,
  };
}

/** Resolve the actual secret to send for a group + selected key id. */
export function resolveKeySecret(group: ApiGroup, keyId: string | null): string | undefined {
  if (keyId) {
    const entry = (group.apiKeys ?? []).find((k) => k.id === keyId);
    const secret = entry?.key?.trim();
    if (secret) return secret;
  }
  // Legacy single-key field (and keyless local endpoints).
  return group.apiKey?.trim() || undefined;
}

/** Masked display, e.g. "sk-…3f2a". Never the full secret. */
export function maskKey(secret: string): string {
  const t = secret.trim();
  if (t.length <= 8) return "…";
  return `${t.slice(0, 3)}…${t.slice(-4)}`;
}
