/**
 * 听歌房 — pluggable music sources (RN layer; playback is inherently native).
 *
 * The pure store (./store.ts) only records WHICH source a track belongs to
 * (`source: "local" | "apple-music"` + `sourceRef`). Everything that touches
 * real audio lives behind this interface, so future sources (NetEase via MCP,
 * …) plug in without touching the store, the tools, or the UI.
 *
 * Sources:
 * - local:       audio files/URLs played with expo-audio. Works immediately.
 * - apple-music: Apple Music catalog via MusicKit (@wwdrew/expo-apple-music).
 *                Needs: MusicKit App Service on the App ID + a fresh native
 *                build + the user's authorization + an Apple Music
 *                subscription. All of that is surfaced honestly in the UI —
 *                never a fake player.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { TrackSource } from "./store";

export type MusicSourceId = TrackSource;

export type SourceAuthState =
  | "unknown"
  | "authorized"
  | "denied"
  | "not-subscribed"
  | "not-configured"
  | "unavailable";

/** A track as a source understands it. */
export interface SourceTrack {
  /** Stable id within the source (local: our track id; apple-music: catalog id). */
  id: string;
  title: string;
  artist: string;
  artworkUrl: string;
  /** Seconds, null when unknown. */
  duration: number | null;
  source: MusicSourceId;
  /** Opaque ref the source needs to play (audioUri / catalog id). */
  playableRef: string;
}

export interface SourceStatus {
  playing: boolean;
  /** Seconds. */
  position: number;
  /** Seconds, null when unknown. */
  duration: number | null;
  /** Source-scoped id of the loaded track, null when nothing loaded. */
  trackId: string | null;
}

export interface MusicSource {
  readonly id: MusicSourceId;
  readonly label: string;
  /** False when the native module is missing (e.g. build without it). */
  isAvailable(): boolean;
  getAuthState(): Promise<SourceAuthState>;
  /** Runs the auth flow (may show system dialogs). */
  authorize(): Promise<SourceAuthState>;
  search(query: string, limit?: number): Promise<SourceTrack[]>;
  load(track: SourceTrack): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seekTo(seconds: number): Promise<void>;
  getStatus(): Promise<SourceStatus>;
  onStatus(cb: (s: SourceStatus) => void): () => void;
  release(): Promise<void>;
}

// ---------------------------------------------------------------------------
// local: expo-audio
// ---------------------------------------------------------------------------

const IDLE: SourceStatus = { playing: false, position: 0, duration: null, trackId: null };

class LocalMusicSource implements MusicSource {
  readonly id: MusicSourceId = "local";
  readonly label = "Local";
  private player: { dispose(): void } | null = null;
  private status: SourceStatus = IDLE;
  private listeners = new Set<(s: SourceStatus) => void>();

  isAvailable(): boolean {
    return true;
  }

  async getAuthState(): Promise<SourceAuthState> {
    return "authorized"; // local files need no authorization
  }

  async authorize(): Promise<SourceAuthState> {
    return "authorized";
  }

  async search(_query: string, _limit?: number): Promise<SourceTrack[]> {
    // Local search happens against our own library (music_track_search tool /
    // store.searchTracks), not here.
    return [];
  }

  async load(track: SourceTrack): Promise<void> {
    const { createAudioPlayer, setAudioModeAsync } = await import("expo-audio");
    await this.release();
    await setAudioModeAsync({ playsInSilentMode: true });
    const player = createAudioPlayer(track.playableRef, { updateInterval: 500 });
    const statusSub = player.addListener("playbackStatusUpdate", (st) => {
      if (!st.isLoaded) return;
      this.status = {
        playing: st.playing,
        position: st.currentTime,
        duration: typeof st.duration === "number" && st.duration > 0 ? st.duration : null,
        trackId: track.id,
      };
      this.emit();
      if (st.didJustFinish) {
        this.status = { ...this.status, playing: false, position: 0 };
        this.emit();
      }
    });
    this.player = {
      dispose: () => {
        try {
          statusSub.remove();
        } catch {
          // already removed
        }
        try {
          player.remove();
        } catch {
          // already released
        }
      },
    };
    // stash the raw player for play/pause/seek
    (this as { rawPlayer?: unknown }).rawPlayer = player;
    this.status = { playing: false, position: 0, duration: track.duration, trackId: track.id };
    this.emit();
  }

  private raw(): { play(): void; pause(): void; seekTo(s: number): Promise<void> } | null {
    return (this as { rawPlayer?: { play(): void; pause(): void; seekTo(s: number): Promise<void> } }).rawPlayer ?? null;
  }

  async play(): Promise<void> {
    const p = this.raw();
    if (!p) throw new Error("Nothing loaded.");
    p.play();
  }

  async pause(): Promise<void> {
    this.raw()?.pause();
  }

  async seekTo(seconds: number): Promise<void> {
    const p = this.raw();
    if (!p) throw new Error("Nothing loaded.");
    await p.seekTo(Math.max(0, seconds));
  }

  async getStatus(): Promise<SourceStatus> {
    return this.status;
  }

  onStatus(cb: (s: SourceStatus) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(): void {
    for (const l of this.listeners) {
      try {
        l(this.status);
      } catch {
        // broken listener must not break playback
      }
    }
  }

  async release(): Promise<void> {
    this.player?.dispose();
    this.player = null;
    (this as { rawPlayer?: unknown }).rawPlayer = undefined;
    this.status = IDLE;
    this.emit();
  }
}

// ---------------------------------------------------------------------------
// apple-music: MusicKit via @wwdrew/expo-apple-music (guarded import)
// ---------------------------------------------------------------------------

const APPLE_TOKEN_KEY = "openmuse.music.v1.apple-music.user-token";
const APPLE_STATE_KEY = "openmuse.music.v1.apple-music.auth-state";

type AppleBridge = typeof import("@wwdrew/expo-apple-music");

function loadAppleBridge(): AppleBridge | null {
  try {
    // Guarded require: the native module only exists in a real build that
    // included the config plugin. Bundler-safe because the import is lazy.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@wwdrew/expo-apple-music") as AppleBridge;
    if (!mod?.Auth || !mod?.Player || !mod?.Catalog) return null;
    return mod;
  } catch {
    return null;
  }
}

class AppleMusicSource implements MusicSource {
  readonly id: MusicSourceId = "apple-music";
  readonly label = "Apple Music";
  private status: SourceStatus = IDLE;
  private listeners = new Set<(s: SourceStatus) => void>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  isAvailable(): boolean {
    return loadAppleBridge() !== null;
  }

  async getAuthState(): Promise<SourceAuthState> {
    if (!this.isAvailable()) return "unavailable";
    const cached = await AsyncStorage.getItem(APPLE_STATE_KEY);
    if (cached === "authorized" || cached === "denied" || cached === "not-subscribed") {
      return cached;
    }
    return "unknown";
  }

  /**
   * Full auth flow: system MusicKit authorization, then subscription check.
   * On iOS no developer JWT is needed for auth itself; the native MusicKit
   * auto-token covers catalog search once the App ID has the MusicKit
   * App Service enabled.
   */
  async authorize(): Promise<SourceAuthState> {
    const bridge = loadAppleBridge();
    if (!bridge) return "unavailable";
    let state: SourceAuthState;
    try {
      const result = await bridge.Auth.authorize();
      if (result.status !== bridge.AuthStatus.AUTHORIZED || !result.musicUserToken) {
        state = result.status === bridge.AuthStatus.DENIED ? "denied" : "unknown";
      } else {
        await AsyncStorage.setItem(APPLE_TOKEN_KEY, result.musicUserToken);
        try {
          const sub = await bridge.Auth.checkSubscription(result.musicUserToken);
          state = sub.canPlayCatalogContent ? "authorized" : "not-subscribed";
        } catch {
          // Subscription check failed (offline?) — auth itself succeeded.
          state = "authorized";
        }
      }
    } catch {
      state = "unknown";
    }
    await AsyncStorage.setItem(APPLE_STATE_KEY, state);
    return state;
  }

  async search(query: string, limit = 10): Promise<SourceTrack[]> {
    const bridge = loadAppleBridge();
    if (!bridge) throw new Error("Apple Music is not available in this build.");
    const state = await this.getAuthState();
    if (state !== "authorized") {
      throw new Error("Apple Music is not authorized. Authorize it in the music room first.");
    }
    const q = query.trim();
    if (!q) return [];
    const res = await bridge.Catalog.search(q, [bridge.CatalogSearchType.SONGS], {
      limit: Math.max(1, Math.min(25, limit)),
    });
    return (res.songs ?? []).map((s) => ({
      id: s.id,
      title: s.title,
      artist: s.artistName,
      artworkUrl: s.artworkUrl ?? "",
      duration: typeof s.duration === "number" && s.duration > 0 ? s.duration / 1000 : null,
      source: "apple-music" as const,
      playableRef: s.id,
    }));
  }

  async load(track: SourceTrack): Promise<void> {
    const bridge = loadAppleBridge();
    if (!bridge) throw new Error("Apple Music is not available in this build.");
    await bridge.Player.setQueue(track.playableRef, bridge.MusicItem.SONG);
    this.status = {
      playing: false,
      position: 0,
      duration: track.duration,
      trackId: track.id,
    };
    this.emit();
    this.startPolling(bridge);
  }

  async play(): Promise<void> {
    const bridge = loadAppleBridge();
    if (!bridge) throw new Error("Apple Music is not available in this build.");
    bridge.Player.play();
    this.status = { ...this.status, playing: true };
    this.emit();
  }

  async pause(): Promise<void> {
    loadAppleBridge()?.Player.pause();
    this.status = { ...this.status, playing: false };
    this.emit();
  }

  async seekTo(seconds: number): Promise<void> {
    loadAppleBridge()?.Player.seekToTime(Math.max(0, seconds));
  }

  async getStatus(): Promise<SourceStatus> {
    const bridge = loadAppleBridge();
    if (!bridge) return this.status;
    try {
      const st = await bridge.Player.getCurrentState();
      const playing = st.playbackState === "playing";
      this.status = {
        playing,
        position: typeof st.playbackTime === "number" ? st.playbackTime : this.status.position,
        duration: this.status.duration,
        trackId: st.currentSong ? st.currentSong.id : this.status.trackId,
      };
    } catch {
      // keep last known status when the native call fails
    }
    return this.status;
  }

  onStatus(cb: (s: SourceStatus) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(): void {
    for (const l of this.listeners) {
      try {
        l(this.status);
      } catch {
        // broken listener must not break playback
      }
    }
  }

  private startPolling(bridge: AppleBridge): void {
    this.stopPolling();
    // MusicKit pushes coarse events; poll position for smooth lyrics/progress.
    this.pollTimer = setInterval(() => {
      void this.getStatus().then((s) => this.emit());
    }, 1000);
    void bridge;
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async release(): Promise<void> {
    this.stopPolling();
    try {
      loadAppleBridge()?.Player.pause();
    } catch {
      // best effort
    }
    this.status = IDLE;
    this.emit();
  }
}

// ---------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------

const localSource = new LocalMusicSource();
const appleMusicSource = new AppleMusicSource();

const REGISTRY: Record<MusicSourceId, MusicSource> = {
  local: localSource,
  "apple-music": appleMusicSource,
};

export function getMusicSource(id: MusicSourceId): MusicSource {
  return REGISTRY[id] ?? localSource;
}

/** Sources usable in this build (native module present). */
export function availableMusicSources(): MusicSource[] {
  return (Object.keys(REGISTRY) as MusicSourceId[])
    .map((id) => REGISTRY[id])
    .filter((s) => s.isAvailable());
}
