/**
 * Pet interaction videos — PURE module: no React Native / expo imports.
 *
 * She wants the desktop pet (桌宠） to feel alive under her fingers:
 * dragging = pinching her cheek, double-tap = head pat, music playing =
 * headphones on. These interaction clips play as a layer on top of the
 * existing mood system (pet/store.ts), which stays untouched.
 *
 * Default clips are the bundled avatar-anim mp4s (placeholders — she will
 * provide real interaction videos later, "醒醒定制的"). Custom mp4 URIs
 * override per interaction, same swappable pattern as task-buddy-video.ts.
 * This store only holds the overrides (null = use the bundled default).
 * Storage is injectable (AsyncStorage in production, Map-backed fake in tests).
 */

export type PetInteraction = "pinch" | "headpat" | "headphones" | "reach";

export type PetInteractionOverrides = Record<PetInteraction, string | null>;

export interface PetInteractionVideoStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const KEY = "dudu.pet.interactions.v1.overrides";

const EMPTY: PetInteractionOverrides = {
  pinch: null,
  headpat: null,
  headphones: null,
  reach: null,
};

/**
 * Bundled avatar-anim clip used per interaction until she provides the real
 * ones. Values are AvatarState names (resolved via avatarVideoSource in UI).
 */
export const INTERACTION_DEFAULT_CLIP: Record<PetInteraction, string> = {
  pinch: "idle",
  headpat: "milestone_level_up",
  headphones: "idle",
  reach: "making_something",
};

export const PET_INTERACTIONS: readonly PetInteraction[] = [
  "pinch",
  "headpat",
  "headphones",
  "reach",
];

/** One-shot interactions (play once, then hand back to the mood video). */
export function isOneShotInteraction(i: PetInteraction): boolean {
  return i === "headpat";
}

// ---------------------------------------------------------------------------
// Interaction event log — so the AI knows what she just did to the pet.
// pet-ui.tsx logs discrete touch events (drag start, long-press, double-tap,
// music start). local-agent.ts reads the most recent one (within a few
// minutes) and drops a one-line note into the system prompt, so she can
// react naturally ("她刚才揪了你的脸") without being spammed.
// In-memory only: fresh touches matter, history doesn't.
// ---------------------------------------------------------------------------

export interface PetInteractionEvent {
  type: PetInteraction;
  at: number;
}

const MAX_EVENTS = 20;
const eventListeners = new Set<() => void>();
let interactionEvents: PetInteractionEvent[] = [];

/** Log a discrete pet touch event. Call once per gesture, not per frame. */
export function logInteraction(type: PetInteraction, at: number = Date.now()): void {
  interactionEvents = [...interactionEvents.slice(-(MAX_EVENTS - 1)), { type, at }];
  for (const l of eventListeners) {
    try {
      l();
    } catch {
      /* subscriber errors must not break the log */
    }
  }
}

/**
 * Most recent interaction within `withinMs` (default 3 minutes), or null.
 * Old touches fade out — she only cares about what just happened.
 */
export function recentInteraction(withinMs: number = 3 * 60 * 1000): PetInteractionEvent | null {
  const last = interactionEvents[interactionEvents.length - 1];
  if (!last) return null;
  if (Date.now() - last.at > withinMs) return null;
  return last;
}

export function subscribeInteractionEvents(fn: () => void): () => void {
  eventListeners.add(fn);
  return () => {
    eventListeners.delete(fn);
  };
}

/** Test hook: clear the in-memory log. */
export function clearInteractionEvents(): void {
  interactionEvents = [];
}

export class PetInteractionVideoStore {
  private storage: PetInteractionVideoStorage;
  private subs = new Set<() => void>();
  private overrides: PetInteractionOverrides = { ...EMPTY };

  constructor(storage: PetInteractionVideoStorage) {
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

  /** Custom mp4 URI for an interaction, or null when using the bundled default. */
  get(state: PetInteraction): string | null {
    return this.overrides[state] ?? null;
  }

  all(): PetInteractionOverrides {
    return { ...this.overrides };
  }

  /** Set a custom video for an interaction. Empty/blank URI resets to default. */
  async set(state: PetInteraction, uri: string | null): Promise<void> {
    const clean = uri?.trim() ? uri.trim() : null;
    this.overrides = { ...this.overrides, [state]: clean };
    await this.persist();
    this.emit();
  }

  /** Reset a single interaction to the bundled default. */
  async clear(state: PetInteraction): Promise<void> {
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
      const parsed = JSON.parse(raw) as Partial<Record<PetInteraction, unknown>>;
      const next: PetInteractionOverrides = { ...EMPTY };
      for (const s of PET_INTERACTIONS) {
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
