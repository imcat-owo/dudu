/**
 * Task buddy video overrides — PURE module: no React Native / expo imports.
 *
 * She said SVG companions look ugly: the task cards now show Sora
 * (the finalized AI face) as a looping video, like the desktop pet.
 * Default clips per task status come from the bundled avatar-anim mp4s;
 * she can upload her own mp4 per status ("醒醒定制的"), and the AI can
 * swap clips on request via the task_buddy_set_video tool.
 *
 * This store only holds the overrides (null = use the bundled default).
 * Storage is injectable (AsyncStorage in production, Map-backed fake in tests).
 */

import type { TaskStatus } from "./task-progress.js";

export type BuddyVideoState = TaskStatus;

export type BuddyVideoOverrides = Record<BuddyVideoState, string | null>;

export interface BuddyVideoStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const KEY = "dudu.taskbuddy.v1.overrides";

const EMPTY: BuddyVideoOverrides = { running: null, stuck: null, done: null };

export class TaskBuddyVideoStore {
  private storage: BuddyVideoStorage;
  private subs = new Set<() => void>();
  private overrides: BuddyVideoOverrides = { ...EMPTY };

  constructor(storage: BuddyVideoStorage) {
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

  /** Custom mp4 URI for a status, or null when using the bundled default. */
  get(state: BuddyVideoState): string | null {
    return this.overrides[state] ?? null;
  }

  all(): BuddyVideoOverrides {
    return { ...this.overrides };
  }

  /** Set a custom video for a status. Empty/blank URI resets to default. */
  async set(state: BuddyVideoState, uri: string | null): Promise<void> {
    const clean = uri && uri.trim() ? uri.trim() : null;
    this.overrides = { ...this.overrides, [state]: clean };
    await this.persist();
    this.emit();
  }

  /** Reset a single status to the bundled default. */
  async clear(state: BuddyVideoState): Promise<void> {
    await this.set(state, null);
  }

  /** Reset everything to bundled defaults. */
  async resetAll(): Promise<void> {
    this.overrides = { ...EMPTY };
    await this.persist();
    this.emit();
  }

  /** Hydrate from storage (call once at startup). */
  async load(): Promise<void> {
    const raw = await this.storage.getItem(KEY).catch(() => null);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Partial<Record<BuddyVideoState, unknown>>;
      const next: BuddyVideoOverrides = { ...EMPTY };
      for (const s of ["running", "stuck", "done"] as const) {
        const v = parsed[s];
        next[s] = typeof v === "string" && v.trim() ? v.trim() : null;
      }
      this.overrides = next;
    } catch {
      /* corrupt data → keep defaults */
    }
  }

  private async persist(): Promise<void> {
    await this.storage.setItem(KEY, JSON.stringify(this.overrides)).catch(() => null);
  }
}
