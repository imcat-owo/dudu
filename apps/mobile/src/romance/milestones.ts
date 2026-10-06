/**
 * Together-days milestone celebrations （轻游戏化，克制版） — PURE module.
 *
 * What this is: at 7 / 30 / 100 / 365 days together, he celebrates once —
 * proactively, through the real initiative delivery path, in the active
 * persona's voice, referencing REAL shared memories (never a generic badge).
 *
 * What this is NOT (the 克制/restraint bar — see src/manuals/romance.ts):
 * no streaks, no decay, no energy/currency, no punishment for missing days,
 * no manipulative "he misses you" pings, no leaderboard, no pay-to-win.
 * The list of milestones is fixed and short on purpose.
 *
 * PURE: no React Native / expo imports, no I/O. Storage is injected.
 * All time flows through injected nowMs / explicit ms values.
 */

/** Fixed, short milestone list — days together. Deliberately not extendable. */
export const TOGETHER_MILESTONE_DAYS: readonly number[] = [7, 30, 100, 365];

/** Celebration hour, Shanghai wall-clock: her evening, well outside the 06:00–16:00 sleep window. */
export const CELEBRATION_HOUR_SHANGHAI = 20;

/** Storage: the milestone ledger (celebrated / skipped / pending rule ids). */
export const MILESTONE_LEDGER_KEY = "dudu.romance.together-milestones.v1";
/** Storage: master toggle. Absent = enabled. */
export const MILESTONE_ENABLED_KEY = "dudu.romance.milestone-celebrations-enabled.v1";

/** Stable id for a days-together milestone. */
export function milestoneId(days: number): string {
  return `together-days-${days}`;
}

export interface MilestoneLedger {
  /** Milestone ids already celebrated (fired once, never again). */
  celebrated: string[];
  /** Milestone ids she cancelled — treated as done, never refire. */
  skipped: string[];
  /** Milestone id -> backing initiative rule id (scheduled, not yet fired). */
  pending: Record<string, string>;
}

export function emptyLedger(): MilestoneLedger {
  return { celebrated: [], skipped: [], pending: {} };
}

/** Minimal storage surface — AsyncStorage satisfies this. */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

function isLedger(v: unknown): v is MilestoneLedger {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    Array.isArray(r.celebrated) &&
    Array.isArray(r.skipped) &&
    typeof r.pending === "object" &&
    r.pending !== null
  );
}

export async function loadMilestoneLedger(storage: KeyValueStorage): Promise<MilestoneLedger> {
  try {
    const raw = await storage.getItem(MILESTONE_LEDGER_KEY);
    if (!raw) return emptyLedger();
    const parsed: unknown = JSON.parse(raw);
    if (!isLedger(parsed)) return emptyLedger();
    return {
      celebrated: parsed.celebrated.filter((x): x is string => typeof x === "string"),
      skipped: parsed.skipped.filter((x): x is string => typeof x === "string"),
      pending: Object.fromEntries(
        Object.entries(parsed.pending).filter(
          (e): e is [string, string] => typeof e[1] === "string",
        ),
      ),
    };
  } catch {
    return emptyLedger();
  }
}

export async function saveMilestoneLedger(
  storage: KeyValueStorage,
  ledger: MilestoneLedger,
): Promise<void> {
  try {
    await storage.setItem(MILESTONE_LEDGER_KEY, JSON.stringify(ledger));
  } catch {
    // Non-fatal: the in-memory sweep guard still holds for this session.
  }
}

/** Master toggle. Absent key = enabled (the feature is on unless she turns it off). */
export async function loadMilestoneCelebrationsEnabled(storage: KeyValueStorage): Promise<boolean> {
  try {
    const raw = await storage.getItem(MILESTONE_ENABLED_KEY);
    return raw === null ? true : raw !== "0";
  } catch {
    return true;
  }
}

export async function saveMilestoneCelebrationsEnabled(
  storage: KeyValueStorage,
  enabled: boolean,
): Promise<void> {
  try {
    await storage.setItem(MILESTONE_ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    // Non-fatal.
  }
}

/**
 * Pure: which day-thresholds are newly hit (not in `done`).
 * days null (no together date) -> []: no date, no milestones, never invent.
 */
export function detectNewMilestones(days: number | null, done: string[]): number[] {
  if (days === null || !Number.isFinite(days) || days < 0) return [];
  const doneSet = new Set(done);
  return TOGETHER_MILESTONE_DAYS.filter((d) => days >= d && !doneSet.has(milestoneId(d)));
}

// ---------------------------------------------------------------------------
// Shanghai wall-clock helpers (Shanghai has no DST: one pass is exact).
// ---------------------------------------------------------------------------

interface ShanghaiParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
}

function shanghaiParts(ms: number): ShanghaiParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const get = (type: string): number =>
    Number(fmt.formatToParts(new Date(ms)).find((p) => p.type === type)?.value ?? "0");
  return {
    y: get("year"),
    mo: get("month"),
    d: get("day"),
    h: get("hour") % 24,
    mi: get("minute"),
  };
}

function shanghaiWallToMs(p: ShanghaiParts): number {
  const guess = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
  const w = shanghaiParts(guess);
  const wallAsUTC = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);
  return guess - (wallAsUTC - guess);
}

/**
 * Next 20:00 Shanghai wall-clock strictly after nowMs — when the
 * celebration message is scheduled. Her evening, outside her sleep window.
 */
export function nextCelebrationTimeMs(nowMs: number): number {
  const p = shanghaiParts(nowMs);
  let at = shanghaiWallToMs({ ...p, h: CELEBRATION_HOUR_SHANGHAI, mi: 0 });
  if (at <= nowMs) at += 86_400_000;
  return at;
}

/**
 * Build the initiative topic for a milestone celebration. The topic is what
 * the model generates the message from — it carries REAL shared memories so
 * the celebration is genuine, never a generic badge. When no memories were
 * sampled, it says so honestly instead of letting the model invent events.
 */
export function buildMilestoneTopic(days: number, since: string, memories: string[]): string {
  const memLines = memories
    .map((m) => m.trim())
    .filter((m) => m.length > 0)
    .slice(0, 3)
    .map((m) => `- ${m}`)
    .join("\n");
  const memBlock =
    memLines.length > 0
      ? `Weave in 1-2 of these REAL shared memories naturally, only if they fit the moment. Never invent memories that aren't listed here:\n${memLines}`
      : `You have no specific sampled memories right now — celebrate from the heart of the relationship, and never invent shared events.`;
  return (
    `Milestone: ${days} days together (since ${since}). ` +
    `Celebrate this warmly in your own voice, like a partner who remembers — not like a notification badge. ` +
    `${memBlock} ` +
    `Keep it short and sincere. Cute but restrained: no emoji, no generic "X天快乐！" badge copy.`
  );
}
