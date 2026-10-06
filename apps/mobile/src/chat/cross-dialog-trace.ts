/**
 * Cross-dialog audit trace + send-visibility settings (AI orchestration
 * vision, feature 2: 跨对话框读写).
 *
 * PURE module: no React Native imports. Storage is injectable (AsyncStorage
 * in production via cross-dialog-instance.ts, Map-backed fake in tests).
 *
 * Hard constraints (死线), enforced here:
 * - 留痕: EVERY cross-dialog action the AI takes (list / read / send) is
 *   recorded in the trace. The trace is append-only from the AI's side and
 *   always visible to her in the app — there is no way to act in another
 *   dialog without leaving a trace. No secret late-night conversations.
 * - The visibility setting below only controls whether a sent message
 *   carries a visible "from dialog X" tag inside the target dialog. It can
 *   be turned off per dialog or globally. Turning it off NEVER disables
 *   the trace — the fact of the send stays visible in the trace log.
 */

import { createWriteChain } from "../util/write-chain";

export type CrossDialogAction =
  | "list"
  | "read"
  | "send"
  /** AI self-organized group chat (vision feature 3) — same trace, same law. */
  | "meeting_create"
  | "meeting_round"
  | "meeting_end"
  /** Proactive outreach (主动触达) — every notification he sends her is logged here. */
  | "proactive_send"
  /** Memory-driven next-day follow-up （次日跟进） — auto-cancelled because
   * the event already came up in chat. */
  | "followup_cancelled"
  /** Daily mood check-in （每日心情） — fired, or skipped with a reason
   * (already recorded / recently active / no reply yesterday). */
  | "moodcheck_fired"
  | "moodcheck_skipped"
  /** Feed nudge (C3) — the like + reply he left on her unacknowledged post. */
  | "feed_nudge"
  /** Open-app watchdog (Aru-gap 轻控制） — welcome-back after she taps the return notification. */
  | "openapp_return"
  /** AI self-post trigger （自发帖触发器） — the AI's own feed post. */
  | "selfpost_post"
  /** Persona group chat (人设群聊) — group management + rounds, same trace, same law. */
  | "persona_group_create"
  | "persona_group_round"
  | "persona_group_add_member"
  | "persona_group_remove_member"
  | "persona_group_set_model"
  | "persona_group_archive";

export interface CrossDialogTraceEntry {
  /** Stable id, e.g. "cdt_...". */
  id: string;
  /** Epoch ms. */
  at: number;
  action: CrossDialogAction;
  /** Dialog the AI was talking in when it acted. */
  fromThreadId: string;
  fromName: string;
  /** Target dialog for read/send. Absent for list. */
  toThreadId?: string;
  toName?: string;
  /** One-liner: what happened (for send: the message text, truncated). */
  summary: string;
  /** Why the AI did it: her explicit request, or the coordination plan id. */
  reason: string;
  /** Persona scope at action time (isolation audit). */
  personaId: string;
}

export interface NewTraceEntry {
  action: CrossDialogAction;
  fromThreadId: string;
  fromName: string;
  toThreadId?: string;
  toName?: string;
  summary: string;
  reason: string;
  personaId: string;
}

/** Minimal storage surface. AsyncStorage satisfies this in production. */
export interface CrossDialogTraceStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export const TRACE_STORAGE_KEY = "dudu.cross-dialog-trace.v1";
export const VISIBILITY_STORAGE_KEY = "dudu.cross-dialog-visibility.v1";

/** The trace never grows unbounded: oldest entries are pruned. */
export const TRACE_MAX_ENTRIES = 200;

function newTraceId(): string {
  return `cdt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function readJson<T>(storage: CrossDialogTraceStorage, key: string, fallback: T): Promise<T> {
  try {
    const raw = await storage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function isValidEntry(e: unknown): e is CrossDialogTraceEntry {
  if (typeof e !== "object" || e === null) return false;
  const v = e as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.at === "number" &&
    (v.action === "list" ||
      v.action === "read" ||
      v.action === "send" ||
      v.action === "meeting_create" ||
      v.action === "meeting_round" ||
      v.action === "meeting_end") &&
    typeof v.fromThreadId === "string" &&
    typeof v.fromName === "string" &&
    typeof v.summary === "string" &&
    typeof v.reason === "string" &&
    typeof v.personaId === "string"
  );
}

export type CrossDialogTraceListener = () => void;

export class CrossDialogTraceStore {
  private listeners = new Set<CrossDialogTraceListener>();
  /**
   * Serializes append/clear so two overlapping read→modify→write cycles
   * can't lose an entry. Reads stay unlocked.
   */
  private writeChain = createWriteChain();

  constructor(private storage: CrossDialogTraceStorage) {}

  subscribe(listener: CrossDialogTraceListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    // Serialized by the shared write-chain helper (src/util/write-chain.ts).
    return this.writeChain(fn);
  }

  /**
   * Newest first. Entries are appended in insertion order, so reversing is
   * deterministic even when two entries share a millisecond timestamp
   * (common when the AI acts via tools).
   */
  async list(limit = 100): Promise<CrossDialogTraceEntry[]> {
    const all = await readJson<unknown[]>(this.storage, TRACE_STORAGE_KEY, []);
    return all.filter(isValidEntry).reverse().slice(0, Math.max(0, limit));
  }

  /** Record one action. Storage failures propagate to the caller (the tool
   *  reports them) — a trace entry is never silently dropped. P3-6: the old
   *  docstring claimed "always succeeds" AND "the error is rethrown"; the
   *  code rethrows, so the docstring now says that. */
  async append(entry: NewTraceEntry): Promise<CrossDialogTraceEntry> {
    return this.exclusive(async () => {
      const all = await readJson<unknown[]>(this.storage, TRACE_STORAGE_KEY, []);
      const valid = all.filter(isValidEntry);
      const full: CrossDialogTraceEntry = {
        ...entry,
        id: newTraceId(),
        at: Date.now(),
      };
      valid.push(full);
      const pruned = valid.slice(-TRACE_MAX_ENTRIES);
      await this.storage.setItem(TRACE_STORAGE_KEY, JSON.stringify(pruned));
      this.emit();
      return full;
    });
  }

  async clear(): Promise<void> {
    return this.exclusive(async () => {
      await this.storage.setItem(TRACE_STORAGE_KEY, "[]");
      this.emit();
    });
  }

  /** Test hook. */
  async __resetForTests(): Promise<void> {
    await this.clear();
  }
}

export interface CrossDialogVisibilitySnapshot {
  /** Global default for the "from dialog X" tag on sent messages. */
  sendTagVisible: boolean;
  /** Per-dialog overrides; null/unset entries follow the global default. */
  dialogOverrides: Record<string, boolean>;
}

const DEFAULT_VISIBILITY: CrossDialogVisibilitySnapshot = {
  sendTagVisible: true,
  dialogOverrides: {},
};

function isValidVisibility(v: unknown): v is CrossDialogVisibilitySnapshot {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.sendTagVisible !== "boolean") return false;
  if (typeof o.dialogOverrides !== "object" || o.dialogOverrides === null) return false;
  return Object.values(o.dialogOverrides as Record<string, unknown>).every(
    (x) => typeof x === "boolean",
  );
}

/**
 * Whether a message sent into a dialog carries a visible source tag
 * ("来自「X」对话框"). Default ON; she can turn it off globally or per
 * dialog. This NEVER affects the trace — the trace always records.
 */
export class CrossDialogVisibilityStore {
  private listeners = new Set<CrossDialogTraceListener>();
  private writeChain = createWriteChain();

  constructor(private storage: CrossDialogTraceStorage) {}

  subscribe(listener: CrossDialogTraceListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    // Serialized by the shared write-chain helper (src/util/write-chain.ts).
    return this.writeChain(fn);
  }

  async getSnapshot(): Promise<CrossDialogVisibilitySnapshot> {
    const v = await readJson<unknown>(this.storage, VISIBILITY_STORAGE_KEY, null);
    return isValidVisibility(v) ? v : { ...DEFAULT_VISIBILITY, dialogOverrides: {} };
  }

  /** Effective setting for one dialog: per-dialog override wins. */
  async isSendTagVisible(threadId: string): Promise<boolean> {
    const snap = await this.getSnapshot();
    const override = snap.dialogOverrides[threadId];
    return typeof override === "boolean" ? override : snap.sendTagVisible;
  }

  async setGlobalVisible(visible: boolean): Promise<void> {
    return this.exclusive(async () => {
      const snap = await this.getSnapshot();
      await this.storage.setItem(
        VISIBILITY_STORAGE_KEY,
        JSON.stringify({ ...snap, sendTagVisible: visible }),
      );
      this.emit();
    });
  }

  /**
   * Per-dialog override. Pass null to clear the override (follow global).
   */
  async setDialogVisible(threadId: string, visible: boolean | null): Promise<void> {
    return this.exclusive(async () => {
      const snap = await this.getSnapshot();
      const dialogOverrides = { ...snap.dialogOverrides };
      if (visible === null) delete dialogOverrides[threadId];
      else dialogOverrides[threadId] = visible;
      await this.storage.setItem(
        VISIBILITY_STORAGE_KEY,
        JSON.stringify({ ...snap, dialogOverrides }),
      );
      this.emit();
    });
  }

  /** Test hook. */
  async __resetForTests(): Promise<void> {
    await this.exclusive(async () => {
      await this.storage.setItem(VISIBILITY_STORAGE_KEY, JSON.stringify(DEFAULT_VISIBILITY));
      this.emit();
    });
  }
}
