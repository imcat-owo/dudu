/**
 * D12 romance P2-1 — quiet intimacy growth line.
 *
 * The couple counters are flat numbers (no arc). This module derives a
 * quiet, honest "phase" from real data only: days-together. Nothing is
 * fabricated — when there is no together-since date, there is no line.
 *
 * Milestones (100 days / 365 days / 50th love letter) are detected purely
 * and celebrated once each (persisted guard) by reusing the P0-1
 * `triggerMilestoneCelebration` clip.
 *
 * PURE module: no RN imports, storage is injected.
 */

/** Growth phases, quiet by design. */
export type IntimacyPhase = "budding" | "warming" | "steady" | "deep";

/**
 * Phase from days-together.
 * null (unknown start date) → null: no line rather than an invented one.
 */
export function intimacyPhase(days: number | null): IntimacyPhase | null {
  if (days === null || !Number.isFinite(days) || days < 0) return null;
  if (days < 30) return "budding";
  if (days < 100) return "warming";
  if (days < 365) return "steady";
  return "deep";
}

export interface IntimacyMilestone {
  id: string;
  kind: "days" | "letters";
  threshold: number;
}

export const INTIMACY_MILESTONES: IntimacyMilestone[] = [
  { id: "days-100", kind: "days", threshold: 100 },
  { id: "days-365", kind: "days", threshold: 365 },
  { id: "letters-50", kind: "letters", threshold: 50 },
];

/** Pure: which milestones are newly hit (not in `celebrated`). */
export function detectNewMilestones(
  input: { days: number | null; loveLetters: number },
  celebrated: string[],
): string[] {
  const done = new Set(celebrated);
  const out: string[] = [];
  for (const m of INTIMACY_MILESTONES) {
    if (done.has(m.id)) continue;
    const value = m.kind === "days" ? input.days : input.loveLetters;
    if (value !== null && Number.isFinite(value) && value >= m.threshold) {
      out.push(m.id);
    }
  }
  return out;
}

/** Minimal storage surface — AsyncStorage satisfies this. */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const MILESTONES_KEY = "dudu.romance.milestones.v1";

/** Milestone ids already celebrated (persisted, so restarts don't replay). */
export async function loadCelebratedMilestones(storage: KeyValueStorage): Promise<string[]> {
  try {
    const raw = await storage.getItem(MILESTONES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function saveCelebratedMilestones(
  storage: KeyValueStorage,
  ids: string[],
): Promise<void> {
  try {
    await storage.setItem(MILESTONES_KEY, JSON.stringify(ids));
  } catch {
    // Non-fatal: the in-memory guard still holds for this session.
  }
}
