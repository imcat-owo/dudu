/**
 * Ambient video overrides — PURE module: no React Native / expo imports.
 *
 * SoraAmbient (src/sora-ambient.tsx) puts a living Sora video in places
 * that used to show a dead static icon: Our Space empty states, the music
 * room DJ buddy, the knowledge base empty state.
 *
 * Each slot has a bundled default (artwork/avatar-anim/ mp4s); she can
 * upload her own mp4 per slot ("醒醒定制的"), and the AI can swap clips
 * via the ambient_video_set tool. Null = use the bundled default.
 * Storage is injectable (AsyncStorage in production, Map-backed fake in tests).
 */

export type AmbientVideoSlot = "ourspace" | "music-dj" | "knowledge" | "skills" | "threads";

export type AmbientVideoOverrides = Record<AmbientVideoSlot, string | null>;

export interface AmbientVideoStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const KEY = "dudu.ambientvideo.v1.overrides";

export const AMBIENT_VIDEO_SLOTS: readonly AmbientVideoSlot[] = [
  "ourspace",
  "music-dj",
  "knowledge",
  "skills",
  "threads",
];

const EMPTY: AmbientVideoOverrides = {
  ourspace: null,
  "music-dj": null,
  knowledge: null,
  skills: null,
  threads: null,
};

export class AmbientVideoStore {
  private storage: AmbientVideoStorage;
  private subs = new Set<() => void>();
  private overrides: AmbientVideoOverrides = { ...EMPTY };

  constructor(storage: AmbientVideoStorage) {
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

  /** Load persisted overrides; corrupt data falls back to defaults. */
  async load(): Promise<void> {
    try {
      const raw = await this.storage.getItem(KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<AmbientVideoOverrides>;
      const next: AmbientVideoOverrides = { ...EMPTY };
      for (const slot of AMBIENT_VIDEO_SLOTS) {
        const v = parsed[slot];
        next[slot] = typeof v === "string" && v.trim() ? v.trim() : null;
      }
      this.overrides = next;
    } catch {
      this.overrides = { ...EMPTY };
    }
    this.emit();
  }

  private async persist(): Promise<void> {
    try {
      await this.storage.setItem(KEY, JSON.stringify(this.overrides));
    } catch {
      /* persistence is best-effort; the in-memory value still works */
    }
  }

  /** Custom mp4 URI for a slot, or null when using the bundled default. */
  get(slot: AmbientVideoSlot): string | null {
    return this.overrides[slot] ?? null;
  }

  all(): AmbientVideoOverrides {
    return { ...this.overrides };
  }

  /** Set a custom video for a slot. Empty/blank URI resets to default. */
  async set(slot: AmbientVideoSlot, uri: string | null): Promise<void> {
    const clean = uri?.trim() ? uri.trim() : null;
    this.overrides = { ...this.overrides, [slot]: clean };
    await this.persist();
    this.emit();
  }

  /** Reset a single slot to the bundled default. */
  async clear(slot: AmbientVideoSlot): Promise<void> {
    await this.set(slot, null);
  }

  /** Reset everything to bundled defaults. */
  async resetAll(): Promise<void> {
    this.overrides = { ...EMPTY };
    await this.persist();
    this.emit();
  }
}
