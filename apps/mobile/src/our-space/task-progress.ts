/**
 * Task progress store — PURE module: no React Native / expo imports.
 *
 * iOS-widget-style small cards in 我们的空间 show background task progress.
 * Any part of the app (knowledge indexer, AI tools, downloads) can report
 * progress here; the UI subscribes and renders live.
 *
 * Storage is injectable (AsyncStorage in production, Map-backed fake in tests).
 */

import { triggerMilestoneCelebration } from "../avatar-celebration";

export type TaskStatus = "running" | "stuck" | "done";

/**
 * A "running" task with no progress update for this long is presumed
 * abandoned and auto-marked "stuck". Generous on purpose: tasks that report
 * progress (any upsert) refresh updatedAt and never trip this. The backstop
 * exists so a crashed/killed task can't leave a stale "running" card
 * forever — the manual says "never leave a stale running card", and this
 * is the enforcement behind that promise rather than AI discipline alone.
 */
export const STUCK_AFTER_MS = 24 * 60 * 60 * 1000;

export interface BackgroundTask {
  id: string;
  /** Display name, e.g. "知识库索引" */
  name: string;
  /** 0..1 */
  progress: number;
  /** Current stage text, e.g. "正在读第 3/10 个文件" */
  stage: string;
  status: TaskStatus;
  /** Card background image URI (user-uploaded or AI-generated), null = theme default */
  backgroundUri: string | null;
  updatedAt: number;
  createdAt: number;
}

export interface TaskProgressEvents {
  onTask?: (task: BackgroundTask) => void;
  onRemove?: (id: string) => void;
}

const KEY_PREFIX = "dudu.tasks.v1.";

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export interface TaskStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export class TaskProgressStore {
  private storage: TaskStorage;
  private subs = new Set<() => void>();
  private cache = new Map<string, BackgroundTask>();

  constructor(storage: TaskStorage) {
    this.storage = storage;
  }

  subscribe(fn: () => void): () => void {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  }

  private emit(): void {
    for (const fn of this.subs) {
      try {
        fn();
      } catch {
        /* subscriber errors must not break the store */
      }
    }
  }

  /** Create or update a task. Progress is clamped to 0..1. */
  async upsert(
    input: Omit<BackgroundTask, "updatedAt" | "createdAt"> & { createdAt?: number },
  ): Promise<BackgroundTask> {
    await this.sweepStale();
    const now = Date.now();
    const prev = this.cache.get(input.id);
    const task: BackgroundTask = {
      ...input,
      progress: clamp01(input.progress),
      createdAt: prev?.createdAt ?? input.createdAt ?? now,
      updatedAt: now,
    };
    // Auto-complete: progress hit 1 → status done (unless explicitly stuck)
    if (task.progress >= 1 && task.status === "running") {
      task.status = "done";
    }
    // A3: a task freshly reaching done is a milestone — the avatar plays
    // the level-up clip for MILESTONE_CELEBRATION_MS, then falls back.
    // (load() hydrates the cache directly, so cold starts never celebrate.)
    const becameDone = prev?.status !== "done" && task.status === "done";
    this.cache.set(task.id, task);
    await this.storage.setItem(KEY_PREFIX + task.id, JSON.stringify(task)).catch(() => null);
    this.emit();
    if (becameDone) triggerMilestoneCelebration(now);
    return task;
  }

  async remove(id: string): Promise<void> {
    this.cache.delete(id);
    await this.storage.removeItem(KEY_PREFIX + id).catch(() => null);
    this.emit();
  }

  /** All tasks, newest first. Done tasks sink below active ones. */
  list(): BackgroundTask[] {
    return [...this.cache.values()].sort((a, b) => {
      const rank = (t: BackgroundTask) => (t.status === "done" ? 1 : 0);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return b.updatedAt - a.updatedAt;
    });
  }

  get(id: string): BackgroundTask | null {
    return this.cache.get(id) ?? null;
  }

  /** Set card background (uploaded or AI-generated image URI). */
  async setBackground(id: string, uri: string | null): Promise<void> {
    const task = this.cache.get(id);
    if (!task) return;
    await this.upsert({ ...task, backgroundUri: uri });
  }

  /** Hydrate from storage (call once at startup). */
  async load(): Promise<void> {
    // Storage backends without key enumeration: we track ids in an index key.
    const indexRaw = await this.storage.getItem(`${KEY_PREFIX}__index`).catch(() => null);
    if (!indexRaw) return;
    let ids: string[] = [];
    try {
      ids = JSON.parse(indexRaw) as string[];
    } catch {
      return;
    }
    for (const id of ids) {
      const raw = await this.storage.getItem(KEY_PREFIX + id).catch(() => null);
      if (!raw) continue;
      try {
        const task = JSON.parse(raw) as BackgroundTask;
        this.cache.set(id, task);
      } catch {
        /* skip corrupt entries */
      }
    }
    // A crash between sessions can leave "running" cards with ancient
    // updatedAt — sweep them to "stuck" on hydrate so they never sit stale.
    await this.sweepStale();
  }

  /**
   * Mark long-silent running tasks as "stuck" (persisted + emitted).
   * Pure time check on updatedAt; any upsert refreshes updatedAt, so only
   * truly abandoned tasks trip it.
   */
  private async sweepStale(now: number = Date.now()): Promise<void> {
    const stale: BackgroundTask[] = [];
    for (const task of this.cache.values()) {
      if (task.status === "running" && now - task.updatedAt > STUCK_AFTER_MS) {
        task.status = "stuck";
        task.updatedAt = now;
        stale.push(task);
      }
    }
    for (const task of stale) {
      await this.storage.setItem(KEY_PREFIX + task.id, JSON.stringify(task)).catch(() => null);
    }
    if (stale.length > 0) this.emit();
  }

  /** Persist the id index (call after upsert/remove in production wiring). */
  async saveIndex(): Promise<void> {
    const ids = [...this.cache.keys()];
    await this.storage.setItem(`${KEY_PREFIX}__index`, JSON.stringify(ids)).catch(() => null);
  }
}
