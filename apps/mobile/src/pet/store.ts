/**
 * Desktop pet (桌宠） — pure state logic. No react-native imports so this
 * module stays unit-testable. The pet IS the AI (小梦）.
 *
 * - skin: "sora" (穹妹， default) or one of the 10 devil stickers.
 * - location: which tab the pet lives on ("chat" | "space").
 * - perch: where it sits — "free" (dragged anywhere), "input-top"
 *   (sitting on top of the chat input box), "ai-bubble" (sitting on an
 *   AI chat bubble).
 * - free positions are stored per location as screen fractions (0..1)
 *   so they survive rotation and restarts.
 *
 * Mood is DERIVED (see resolvePetMood), never stored: dragging beats
 * everything, then a short happy window after drop/tap, then AI-busy,
 * then music-bopping, then sleepy after 90s of no interaction.
 */

import { clampMascotIndex, DEFAULT_MASCOT_INDEX } from "../mascot";

export type PetSkin =
  | { kind: "sora" }
  | { kind: "devil"; index: number }
  | { kind: "custom"; imageUri: string; videoUri?: string };

export type PetLocation = "chat" | "space";

export type PetPerch = "free" | "input-top" | "ai-bubble";

export type PetMood = "idle" | "dragged" | "happy" | "sleepy" | "busy" | "bopping";

export interface PetFreePos {
  fx: number;
  fy: number;
}

export interface PetPersisted {
  skin: PetSkin;
  location: PetLocation;
  perch: PetPerch;
  /** message id of the AI bubble the pet sits on (perch === "ai-bubble"). */
  bubbleMessageId: string | null;
  pos: Record<PetLocation, PetFreePos>;
  updatedAt: number;
}

export const PET_SKIN_DEFAULT: PetSkin = { kind: "sora" };

/** Default free spots: chat → lower-right; space → near the couple header. */
export const PET_DEFAULT_POS: Record<PetLocation, PetFreePos> = {
  chat: { fx: 0.78, fy: 0.7 },
  space: { fx: 0.5, fy: 0.14 },
};

export const PET_STORAGE_KEY = "dudu.pet.v1.state";

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.min(0.98, Math.max(0.02, v));
}

export function normalizeSkin(skin: unknown): PetSkin {
  if (skin && typeof skin === "object") {
    const s = skin as { kind?: unknown; index?: unknown; imageUri?: unknown; videoUri?: unknown };
    if (s.kind === "devil") return { kind: "devil", index: clampMascotIndex(Number(s.index)) };
    if (s.kind === "custom" && typeof s.imageUri === "string" && s.imageUri) {
      const custom: PetSkin = { kind: "custom", imageUri: s.imageUri };
      if (typeof s.videoUri === "string" && s.videoUri) custom.videoUri = s.videoUri;
      return custom;
    }
  }
  return { kind: "sora" };
}

export function defaultPetState(): PetPersisted {
  return {
    skin: PET_SKIN_DEFAULT,
    location: "chat",
    perch: "free",
    bubbleMessageId: null,
    pos: {
      chat: { ...PET_DEFAULT_POS.chat },
      space: { ...PET_DEFAULT_POS.space },
    },
    updatedAt: Date.now(),
  };
}

export function normalizePetState(raw: unknown): PetPersisted {
  const d = defaultPetState();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Partial<PetPersisted>;
  const location: PetLocation = r.location === "space" ? "space" : "chat";
  const perch: PetPerch = r.perch === "input-top" || r.perch === "ai-bubble" ? r.perch : "free";
  const pos = (v: unknown, fb: PetFreePos): PetFreePos => {
    if (v && typeof v === "object") {
      const p = v as { fx?: unknown; fy?: unknown };
      return { fx: clamp01(Number(p.fx)), fy: clamp01(Number(p.fy)) };
    }
    return { ...fb };
  };
  return {
    skin: normalizeSkin(r.skin),
    location,
    perch,
    bubbleMessageId: typeof r.bubbleMessageId === "string" ? r.bubbleMessageId : null,
    pos: {
      chat: pos(r.pos?.chat, PET_DEFAULT_POS.chat),
      space: pos(r.pos?.space, PET_DEFAULT_POS.space),
    },
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : Date.now(),
  };
}

/** Pure mood resolution — priority order is the spec. */
export function resolvePetMood(input: {
  dragging: boolean;
  aiBusy: boolean;
  musicPlaying: boolean;
  lastHappyAt: number;
  lastInteractAt: number;
  now: number;
}): PetMood {
  if (input.dragging) return "dragged";
  if (input.now - input.lastHappyAt < 2500) return "happy";
  if (input.aiBusy) return "busy";
  if (input.musicPlaying) return "bopping";
  if (input.now - input.lastInteractAt > 90000) return "sleepy";
  return "idle";
}

/** Minimal storage surface. AsyncStorage satisfies this in production. */
export interface PetStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export class PetStore {
  private storage: PetStorage;
  private state: PetPersisted;
  private listeners = new Set<() => void>();
  private loaded = false;

  constructor(storage: PetStorage, initial?: PetPersisted) {
    this.storage = storage;
    this.state = initial ?? defaultPetState();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch {
        // a broken listener must not break the store
      }
    }
  }

  get(): PetPersisted {
    return this.state;
  }

  async load(): Promise<PetPersisted> {
    if (this.loaded) return this.state;
    this.loaded = true;
    try {
      const raw = await this.storage.getItem(PET_STORAGE_KEY);
      if (raw) this.state = normalizePetState(JSON.parse(raw));
    } catch {
      // corrupted storage → defaults
    }
    this.emit();
    return this.state;
  }

  private async persist(): Promise<void> {
    this.state.updatedAt = Date.now();
    try {
      await this.storage.setItem(PET_STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // storage failure must not crash the pet
    }
    this.emit();
  }

  async setSkin(skin: PetSkin): Promise<void> {
    this.state = { ...this.state, skin: normalizeSkin(skin) };
    await this.persist();
  }

  async setDevilSkin(index: number): Promise<void> {
    await this.setSkin({ kind: "devil", index: clampMascotIndex(index) });
  }

  /**
   * Apply a drop result. `zone` is the drop zone id that won hit-testing,
   * or null when dropped on empty space (stays free at the drop point).
   */
  async drop(drop: {
    zone: "ai-bubble" | "input-top" | "dialog" | "tab-space" | "tab-chat" | null;
    fx: number;
    fy: number;
    bubbleMessageId?: string | null;
  }): Promise<PetPersisted> {
    const s = this.state;
    switch (drop.zone) {
      case "tab-space":
        this.state = {
          ...s,
          location: "space",
          perch: "free",
          bubbleMessageId: null,
          pos: { ...s.pos, space: { ...PET_DEFAULT_POS.space } },
        };
        break;
      case "tab-chat":
        this.state = {
          ...s,
          location: "chat",
          perch: "free",
          bubbleMessageId: null,
          pos: { ...s.pos, chat: { ...PET_DEFAULT_POS.chat } },
        };
        break;
      case "ai-bubble":
        this.state = {
          ...s,
          perch: "ai-bubble",
          bubbleMessageId: drop.bubbleMessageId ?? null,
        };
        break;
      case "input-top":
        this.state = { ...s, perch: "input-top", bubbleMessageId: null };
        break;
      default:
        // "dialog" or null → free at the drop point, in the current tab.
        this.state = {
          ...s,
          perch: "free",
          bubbleMessageId: null,
          pos: {
            ...s.pos,
            [s.location]: { fx: clamp01(drop.fx), fy: clamp01(drop.fy) },
          },
        };
        break;
    }
    await this.persist();
    return this.state;
  }

  /** Nudge the free position (e.g. clamp after rotation). */
  async setFreePos(location: PetLocation, fx: number, fy: number): Promise<void> {
    const s = this.state;
    this.state = {
      ...s,
      pos: { ...s.pos, [location]: { fx: clamp01(fx), fy: clamp01(fy) } },
    };
    await this.persist();
  }
}

/**
 * Live activity signals (module-level, NOT persisted). chat.tsx reports
 * AI-busy; music-ui.tsx reports playback. The pet overlay subscribes and
 * derives mood from these + drag state + interaction timers.
 */
export interface PetActivity {
  aiBusy: boolean;
  musicPlaying: boolean;
}

const activityListeners = new Set<(a: PetActivity) => void>();
const activityState: PetActivity = { aiBusy: false, musicPlaying: false };

function emitActivity(): void {
  for (const l of activityListeners) {
    try {
      l({ ...activityState });
    } catch {
      // ignore broken listeners
    }
  }
}

export const petActivity = {
  snapshot(): PetActivity {
    return { ...activityState };
  },
  setAiBusy(b: boolean): void {
    if (activityState.aiBusy === b) return;
    activityState.aiBusy = b;
    emitActivity();
  },
  setMusicPlaying(b: boolean): void {
    if (activityState.musicPlaying === b) return;
    activityState.musicPlaying = b;
    emitActivity();
  },
  subscribe(fn: (a: PetActivity) => void): () => void {
    activityListeners.add(fn);
    return () => {
      activityListeners.delete(fn);
    };
  },
};

export { DEFAULT_MASCOT_INDEX };
