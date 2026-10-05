/**
 * Proactive initiative （主动约定） — rules store. AsyncStorage-backed,
 * write-serialized. Storage surface is injectable so tests don't need
 * React Native.
 *
 * - rules: the scheduled promises.
 * - fired slots: "ruleId:fireAtMs" strings — a slot fires at most once,
 *   ever. Interrupted execution is never retried: a failed fire still
 *   consumes its slot.
 * - daily sends: per-persona per-day counts for the shared proactive cap.
 * - daily cap N: her setting, default 3.
 */

import {
  DEFAULT_DAILY_CAP,
  type InitiativeRule,
  type InitiativeRuleStatus,
  type InitiativeSchedule,
  type InitiativeTarget,
  newRuleId,
  shanghaiDayStart,
} from "./rules";

const KEYS = {
  rules: "dudu.initiative.v1.rules",
  fired: "dudu.initiative.v1.fired",
  sends: "dudu.initiative.v1.sends",
  cap: "dudu.initiative.v1.dailyCap",
} as const;

/** Cap the fired-slot ledger so it can't grow without bound. */
const FIRED_LEDGER_CAP = 2000;
/** Cap the daily-send ledger (per persona-day entries). */
const SENDS_LEDGER_CAP = 2000;

interface SendRecord {
  personaId: string;
  /** Shanghai day start (ms) this send belongs to. */
  day: number;
  at: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function sanitizeRule(v: unknown): InitiativeRule | null {
  if (!isRecord(v)) return null;
  const { id, personaId, title, topic, type, schedule, target, status, createdAt } = v;
  if (typeof id !== "string" || !id) return null;
  if (typeof personaId !== "string" || !personaId) return null;
  if (typeof title !== "string" || typeof topic !== "string") return null;
  if (type !== "one_time" && type !== "daily" && type !== "interval") return null;
  if (!isRecord(schedule) || typeof (schedule as { kind?: unknown }).kind !== "string") return null;
  const st: InitiativeRuleStatus = status === "archived" ? "archived" : "active";
  const tg: InitiativeTarget =
    isRecord(target) && target.mode === "pinned" && typeof target.threadId === "string"
      ? { mode: "pinned", threadId: target.threadId }
      : { mode: "latest" };
  return {
    id,
    personaId,
    title,
    topic,
    type,
    schedule: schedule as unknown as InitiativeSchedule,
    target: tg,
    status: st,
    createdAt: typeof createdAt === "number" ? createdAt : 0,
  };
}

export class InitiativeStore {
  private writeChain: Promise<void> = Promise.resolve();
  private readonly nowMs: () => number;

  constructor(
    private storage: {
      getItem(k: string): Promise<string | null>;
      setItem(k: string, v: string): Promise<void>;
    },
    opts?: { nowMs?: () => number },
  ) {
    this.nowMs = opts?.nowMs ?? (() => Date.now());
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.writeChain;
    const cur = (async () => {
      await prev;
      return fn();
    })();
    this.writeChain = cur.then(
      () => {},
      () => {},
    );
    return cur;
  }

  private async loadRules(): Promise<InitiativeRule[]> {
    try {
      const raw = await this.storage.getItem(KEYS.rules);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(sanitizeRule).filter((r): r is InitiativeRule => r !== null);
    } catch {
      return [];
    }
  }

  private async saveRules(rules: InitiativeRule[]): Promise<void> {
    await this.storage.setItem(KEYS.rules, JSON.stringify(rules));
  }

  async list(includeArchived = true): Promise<InitiativeRule[]> {
    const rules = await this.loadRules();
    const filtered = includeArchived ? rules : rules.filter((r) => r.status === "active");
    return [...filtered].sort((a, b) => b.createdAt - a.createdAt);
  }

  async get(id: string): Promise<InitiativeRule | null> {
    const rules = await this.loadRules();
    return rules.find((r) => r.id === id) ?? null;
  }

  async create(input: {
    personaId: string;
    title: string;
    topic: string;
    type: InitiativeRule["type"];
    schedule: InitiativeSchedule;
    target?: InitiativeTarget;
  }): Promise<InitiativeRule> {
    return this.exclusive(async () => {
      const rules = await this.loadRules();
      const now = this.nowMs();
      const rule: InitiativeRule = {
        id: newRuleId(now),
        personaId: input.personaId,
        title: input.title.trim(),
        topic: input.topic.trim(),
        type: input.type,
        schedule: input.schedule,
        target: input.target ?? { mode: "latest" },
        status: "active",
        createdAt: now,
      };
      await this.saveRules([...rules, rule]);
      return rule;
    });
  }

  /** Archive (pause) or restore a rule. Returns false when the id is unknown. */
  async setStatus(id: string, status: InitiativeRuleStatus): Promise<boolean> {
    return this.exclusive(async () => {
      const rules = await this.loadRules();
      const idx = rules.findIndex((r) => r.id === id);
      if (idx < 0) return false;
      rules[idx] = { ...rules[idx], status };
      await this.saveRules(rules);
      return true;
    });
  }

  /** Delete a rule permanently. Also drops its fired-slot entries. Returns false when unknown. */
  async remove(id: string): Promise<boolean> {
    return this.exclusive(async () => {
      const rules = await this.loadRules();
      if (!rules.some((r) => r.id === id)) return false;
      await this.saveRules(rules.filter((r) => r.id !== id));
      const fired = await this.loadFired();
      await this.saveFired(fired.filter((s) => !s.startsWith(`${id}:`)));
      return true;
    });
  }

  private async loadFired(): Promise<string[]> {
    try {
      const raw = await this.storage.getItem(KEYS.fired);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((s): s is string => typeof s === "string" && s.length > 0);
    } catch {
      return [];
    }
  }

  private async saveFired(slots: string[]): Promise<void> {
    const capped =
      slots.length > FIRED_LEDGER_CAP ? slots.slice(slots.length - FIRED_LEDGER_CAP) : slots;
    await this.storage.setItem(KEYS.fired, JSON.stringify(capped));
  }

  /** True when this (rule, fire time) slot already fired — it never refires. */
  async wasSlotFired(slot: string): Promise<boolean> {
    const fired = await this.loadFired();
    return fired.includes(slot);
  }

  /** Consume a slot. Idempotent. Never throws. */
  async markSlotFired(slot: string): Promise<void> {
    return this.exclusive(async () => {
      try {
        const fired = await this.loadFired();
        if (!fired.includes(slot)) {
          await this.saveFired([...fired, slot]);
        }
      } catch {
        // Bookkeeping must never break firing.
      }
    });
  }

  async getDailyCap(): Promise<number> {
    try {
      const raw = await this.storage.getItem(KEYS.cap);
      const n = raw === null ? NaN : Number(raw);
      if (Number.isInteger(n) && n >= 1 && n <= 50) return n;
    } catch {
      // fall through to default
    }
    return DEFAULT_DAILY_CAP;
  }

  async setDailyCap(n: number): Promise<void> {
    const v = Math.max(1, Math.min(50, Math.floor(n)));
    return this.exclusive(async () => {
      await this.storage.setItem(KEYS.cap, String(v));
    });
  }

  private async loadSends(): Promise<SendRecord[]> {
    try {
      const raw = await this.storage.getItem(KEYS.sends);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (s): s is SendRecord =>
          isRecord(s) &&
          typeof s.personaId === "string" &&
          typeof s.day === "number" &&
          typeof s.at === "number",
      );
    } catch {
      return [];
    }
  }

  /** Initiative sends by this persona today (Shanghai day). */
  async countSendsToday(personaId: string, nowMs: number = Date.now()): Promise<number> {
    const day = shanghaiDayStart(nowMs);
    const sends = await this.loadSends();
    return sends.filter((s) => s.personaId === personaId && s.day === day).length;
  }

  /**
   * ALL initiative sends today, across every persona (Shanghai day).
   * Used by the outreach side of the shared cap check: outreach has no
   * persona dimension, so it counts against the global proactive total.
   */
  async countAllSendsToday(nowMs: number = Date.now()): Promise<number> {
    const day = shanghaiDayStart(nowMs);
    const sends = await this.loadSends();
    return sends.filter((s) => s.day === day).length;
  }

  /** Record an initiative send. Never throws. */
  async recordSend(personaId: string, nowMs: number = Date.now()): Promise<void> {
    return this.exclusive(async () => {
      try {
        const sends = await this.loadSends();
        const next = [...sends, { personaId, day: shanghaiDayStart(nowMs), at: nowMs }];
        const capped =
          next.length > SENDS_LEDGER_CAP ? next.slice(next.length - SENDS_LEDGER_CAP) : next;
        await this.storage.setItem(KEYS.sends, JSON.stringify(capped));
      } catch {
        // Bookkeeping must never break delivery.
      }
    });
  }

  /** Test hook. */
  async __resetForTests(): Promise<void> {
    await this.exclusive(async () => {
      await this.storage.setItem(KEYS.rules, "[]");
      await this.storage.setItem(KEYS.fired, "[]");
      await this.storage.setItem(KEYS.sends, "[]");
      await this.storage.setItem(KEYS.cap, String(DEFAULT_DAILY_CAP));
    });
  }
}
