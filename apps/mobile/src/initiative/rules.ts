/**
 * Proactive initiative （主动约定） — rules. PURE module: no React Native /
 * expo imports, no I/O. All time flows through injected `nowMs`.
 *
 * A rule is a scheduled promise HE makes to HER: at a time, in a persona's
 * voice, say something about a topic. Rules are created by HER or by the AI
 * only with HER explicit permission — never invented unprompted.
 *
 * Hard constraints (her decisions, 2026-10-05):
 * - One persona per rule. A rule's message may only land in that persona's
 *   own dialogs — never anyone else's.
 * - Per-persona daily cap N (default 3), shared with the outreach channel.
 * - A fired slot never refires. Interrupted execution is never retried.
 * - Copy iron rule: natural, useful, continuable. NEVER claim she just
 *   sent a request — this is HIS initiative, not a reply.
 */

export type InitiativeRuleType = "one_time" | "daily" | "interval";

export type InitiativeRuleStatus = "active" | "archived";

export interface OneTimeSchedule {
  kind: "one_time";
  /** Epoch ms of the single fire time. */
  atMs: number;
}

export interface DailySchedule {
  kind: "daily";
  /** Shanghai wall-clock hour (0-23) — her day, her timezone. */
  hour: number;
  /** Shanghai wall-clock minute (0-59). */
  minute: number;
}

export interface IntervalSchedule {
  kind: "interval";
  /** Repeat period, ms. Minimum 1 minute. */
  everyMs: number;
  /** Anchor the cadence to this epoch ms (default: creation time). */
  anchorMs?: number;
}

export type InitiativeSchedule = OneTimeSchedule | DailySchedule | IntervalSchedule;

export interface InitiativeTargetLatest {
  mode: "latest";
}

export interface InitiativeTargetPinned {
  mode: "pinned";
  threadId: string;
}

export type InitiativeTarget = InitiativeTargetLatest | InitiativeTargetPinned;

export interface InitiativeRule {
  id: string;
  /** The persona whose voice speaks. Messages only land in ITS dialogs. */
  personaId: string;
  /** Display title, e.g. "早安". */
  title: string;
  /**
   * What the message is about — the AI's generation prompt input, e.g.
   * "提醒她喝水，顺便问问她昨晚睡得好不好". Never empty.
   */
  topic: string;
  type: InitiativeRuleType;
  schedule: InitiativeSchedule;
  target: InitiativeTarget;
  status: InitiativeRuleStatus;
  createdAt: number;
}

/** Minimum interval between fires of one rule. The daily cap is the real guard. */
export const MIN_INTERVAL_MS = 60_000;

/** Default per-persona daily proactive cap (initiative + outreach channel). */
export const DEFAULT_DAILY_CAP = 3;

const DAY_MS = 86_400_000;

export function isInitiativeRuleType(v: unknown): v is InitiativeRuleType {
  return v === "one_time" || v === "daily" || v === "interval";
}

export function newRuleId(nowMs: number = Date.now()): string {
  return `ir_${nowMs.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

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
  const get = (type: string) =>
    Number(fmt.formatToParts(new Date(ms)).find((p) => p.type === type)?.value ?? "0");
  return {
    y: get("year"),
    mo: get("month"),
    d: get("day"),
    h: get("hour") % 24,
    mi: get("minute"),
  };
}

/** Shanghai wall-clock → epoch ms. Shanghai has no DST: one pass is exact. */
function shanghaiWallToMs(p: ShanghaiParts): number {
  const guess = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
  const w = shanghaiParts(guess);
  const wallAsUTC = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);
  return guess - (wallAsUTC - guess);
}

/** Start of the Shanghai calendar day containing `ms` (for the daily cap). */
export function shanghaiDayStart(ms: number): number {
  const p = shanghaiParts(ms);
  return shanghaiWallToMs({ ...p, h: 0, mi: 0 });
}

/**
 * Next fire strictly after `nowMs`. Returns null when there is none
 * (one_time in the past). Pure.
 */
export function nextFireAt(rule: InitiativeRule, nowMs: number): number | null {
  const s = rule.schedule;
  if (s.kind === "one_time") {
    return s.atMs > nowMs ? s.atMs : null;
  }
  if (s.kind === "daily") {
    const p = shanghaiParts(nowMs);
    let fire = shanghaiWallToMs({ ...p, h: s.hour, mi: s.minute });
    if (fire <= nowMs) fire += DAY_MS;
    return fire;
  }
  // interval
  const anchor = typeof s.anchorMs === "number" && s.anchorMs > 0 ? s.anchorMs : rule.createdAt;
  if (anchor > nowMs) return anchor;
  const elapsed = nowMs - anchor;
  const periods = Math.floor(elapsed / s.everyMs) + 1;
  return anchor + periods * s.everyMs;
}

/** Slot identity: a (rule, fire time) pair fires at most once, ever. */
export function slotId(ruleId: string, fireAtMs: number): string {
  return `${ruleId}:${fireAtMs}`;
}

export interface RuleValidationError {
  field: string;
  message: string;
}

/**
 * Validate rule input. Returns errors (empty = valid). Never throws.
 * Times are her explicit choices — no sleep-window clamping here: when SHE
 * says 8:00, it fires at 8:00.
 */
export function validateRuleInput(input: {
  personaId?: unknown;
  title?: unknown;
  topic?: unknown;
  type?: unknown;
  schedule?: unknown;
  target?: unknown;
}): RuleValidationError[] {
  const errs: RuleValidationError[] = [];
  if (typeof input.personaId !== "string" || input.personaId.trim().length === 0) {
    errs.push({ field: "personaId", message: "personaId is required." });
  }
  if (typeof input.title !== "string" || input.title.trim().length === 0) {
    errs.push({ field: "title", message: "title is required." });
  } else if (input.title.trim().length > 40) {
    errs.push({ field: "title", message: "title must be 40 characters or fewer." });
  }
  if (typeof input.topic !== "string" || input.topic.trim().length === 0) {
    errs.push({ field: "topic", message: "topic is required — what should the message be about?" });
  } else if (input.topic.trim().length > 500) {
    errs.push({ field: "topic", message: "topic must be 500 characters or fewer." });
  }
  if (!isInitiativeRuleType(input.type)) {
    errs.push({ field: "type", message: "type must be one_time, daily, or interval." });
    return errs;
  }
  const s = input.schedule as Record<string, unknown> | null | undefined;
  if (input.type === "one_time") {
    const at = s?.atMs;
    if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) {
      errs.push({ field: "schedule.atMs", message: "one_time needs a valid atMs epoch." });
    }
  } else if (input.type === "daily") {
    const h = s?.hour;
    const m = s?.minute;
    if (typeof h !== "number" || !Number.isInteger(h) || h < 0 || h > 23) {
      errs.push({ field: "schedule.hour", message: "daily needs hour 0-23 (Shanghai time)." });
    }
    if (typeof m !== "number" || !Number.isInteger(m) || m < 0 || m > 59) {
      errs.push({ field: "schedule.minute", message: "daily needs minute 0-59." });
    }
  } else {
    const every = s?.everyMs;
    if (typeof every !== "number" || !Number.isFinite(every) || every < MIN_INTERVAL_MS) {
      errs.push({
        field: "schedule.everyMs",
        message: `interval needs everyMs >= ${MIN_INTERVAL_MS} (1 minute).`,
      });
    }
  }
  const t = input.target as Record<string, unknown> | null | undefined;
  if (t !== undefined && t !== null) {
    if (t.mode === "pinned") {
      if (typeof t.threadId !== "string" || t.threadId.trim().length === 0) {
        errs.push({ field: "target.threadId", message: "pinned target needs a threadId." });
      }
    } else if (t.mode !== "latest" && t.mode !== undefined) {
      errs.push({ field: "target.mode", message: 'target.mode must be "latest" or "pinned".' });
    }
  }
  return errs;
}

/** Human schedule summary for the management UI. Pure. */
export function describeSchedule(rule: InitiativeRule): string {
  const s = rule.schedule;
  if (s.kind === "one_time") {
    const p = shanghaiParts(s.atMs);
    return `一次 · ${p.mo}月${p.d}日 ${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`;
  }
  if (s.kind === "daily") {
    return `每天 ${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`;
  }
  const mins = Math.round(s.everyMs / 60_000);
  if (mins < 60) return `每 ${mins} 分钟`;
  const hours = s.everyMs / 3_600_000;
  if (Number.isInteger(hours)) return `每 ${hours} 小时`;
  return `每 ${(s.everyMs / 3_600_000).toFixed(1)} 小时`;
}
