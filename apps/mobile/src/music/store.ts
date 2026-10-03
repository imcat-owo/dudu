/**
 * 听歌房 (Music Room) — data layer. PURE module: no React Native / expo imports.
 *
 * NetEase-inspired, couple-adapted:
 * - tracks: the shared song library (she adds via UI, the AI adds via tools)
 * - playlists: 共享歌单 (shared), 我们的歌 (ours), plus her custom lists
 * - queue: what is coming up next
 * - nowPlaying + djIntent: the AI drives playback from dialog by writing
 *   intents; the UI subscribes and applies them to the real audio player.
 *   (Dialog tools are pure — they can never touch expo-audio directly.)
 * - together: "拉我一起听" session state — when active, the player shows
 *   the couple avatar (her + AI stuck together).
 * - comments: NetEase-style per-song comments, both of them can write.
 * - memories: per-song presence notes ("we listened to this on…").
 * - selectedLyric: she taps a lyric line, then asks about it in dialog;
 *   dj_now_read hands the AI the full lyric context (Duetto pattern).
 *
 * Storage is injectable (AsyncStorage in production, Map-backed fake in tests).
 * Mutations emit to subscribers so the UI refreshes live when the AI writes
 * via tools during a chat turn.
 */

export type MusicAuthor = "her" | "ai";

/** One timed lyric line. time is seconds from track start. */
export interface LyricLine {
  time: number;
  text: string;
}

/** Where a track plays from. Pluggable — future sources add a value here. */
export type TrackSource = "local" | "apple-music";

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  /** Where this track plays from. */
  source: TrackSource;
  /**
   * Source-scoped playable reference. local: unused (audioUri is the ref).
   * apple-music: the Apple Music catalog song id.
   */
  sourceRef: string;
  /** Audio file/URL for local tracks. Empty string = no audio yet (UI must say so honestly). */
  audioUri: string;
  /** Cover image URI (picked). Empty = default art. */
  coverUri: string;
  /** Remote artwork URL (e.g. Apple Music artwork). Fallback when coverUri is empty. */
  artworkUrl: string;
  lyrics: LyricLine[];
  addedBy: MusicAuthor;
  playCount: number;
  createdAt: number;
}

/**
 * Migration guard: tracks stored before multi-source support lack the new
 * fields. Normalize on read so old data keeps working.
 */
export function normalizeTrack(t: Track): Track {
  return {
    ...t,
    source: t.source === "apple-music" ? "apple-music" : "local",
    sourceRef: typeof t.sourceRef === "string" ? t.sourceRef : "",
    artworkUrl: typeof t.artworkUrl === "string" ? t.artworkUrl : "",
    audioUri: typeof t.audioUri === "string" ? t.audioUri : "",
    coverUri: typeof t.coverUri === "string" ? t.coverUri : "",
    lyrics: Array.isArray(t.lyrics) ? t.lyrics : [],
  };
}

export type PlaylistKind = "shared" | "ours" | "custom";

export interface Playlist {
  id: string;
  /** For kind shared/ours the UI renders a localized name; custom uses name. */
  name: string;
  kind: PlaylistKind;
  trackIds: string[];
  createdBy: MusicAuthor;
  createdAt: number;
}

export interface MusicComment {
  id: string;
  trackId: string;
  author: MusicAuthor;
  text: string;
  createdAt: number;
}

export interface MusicMemory {
  id: string;
  trackId: string;
  text: string;
  createdAt: number;
}

export type DjAction = "play" | "pause" | "skip" | "prev";

/**
 * Playback intent written by AI tools, consumed by the UI.
 * The UI applies intents with `at` newer than what it already applied.
 */
export interface DjIntent {
  action: DjAction;
  /** For "play": the track to play. Absent = resume current. */
  trackId?: string;
  at: number;
  by: MusicAuthor;
}

/** "拉我一起听" — shared listening session. */
export interface TogetherState {
  active: boolean;
  startedAt: number;
  startedBy: MusicAuthor | null;
}

export interface MusicStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const KEYS = {
  tracks: "dudu.music.v1.tracks",
  playlists: "dudu.music.v1.playlists",
  comments: "dudu.music.v1.comments",
  memories: "dudu.music.v1.memories",
  queue: "dudu.music.v1.queue",
  nowPlaying: "dudu.music.v1.now",
  intent: "dudu.music.v1.intent",
  together: "dudu.music.v1.together",
  selectedLyric: "dudu.music.v1.selectedLyric",
} as const;

export const SHARED_PLAYLIST_ID = "pl-shared";
export const OURS_PLAYLIST_ID = "pl-ours";

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function readJson<T>(storage: MusicStorage, key: string, fallback: T): Promise<T> {
  try {
    const raw = await storage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(storage: MusicStorage, key: string, value: unknown): Promise<void> {
  await storage.setItem(key, JSON.stringify(value));
}

/**
 * Parse LRC-ish lyrics into timed lines.
 * Accepts `[mm:ss.xx] text` and `[mm:ss] text`; ignores metadata tags
 * like `[ti:...]` / `[ar:...]` and blank lines. Sorted by time.
 */
export function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const re = /^\s*\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]\s*(.*)$/;
  for (const raw of text.split("\n")) {
    const m = re.exec(raw);
    if (!m) continue;
    const min = Number(m[1]);
    const sec = Number(m[2]);
    if (!Number.isFinite(min) || !Number.isFinite(sec) || sec >= 60) continue;
    let frac = 0;
    if (m[3] !== undefined) {
      const f = m[3].padEnd(3, "0").slice(0, 3);
      frac = Number(f) / 1000;
    }
    const body = (m[4] ?? "").trim();
    if (!body) continue;
    lines.push({ time: min * 60 + sec + frac, text: body });
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

/** Index of the lyric line active at `position` seconds (-1 if none). */
export function lyricIndexAt(lyrics: LyricLine[], position: number): number {
  let idx = -1;
  for (let i = 0; i < lyrics.length; i++) {
    if (lyrics[i].time <= position + 0.05) idx = i;
    else break;
  }
  return idx;
}

export class MusicStore {
  private storage: MusicStorage;
  private listeners = new Set<() => void>();
  /** Serializes mutations so concurrent writes never lose data. */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(storage: MusicStorage) {
    this.storage = storage;
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

  private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(fn, fn);
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  // ---------- tracks ----------

  async addTrack(input: {
    title: string;
    artist?: string;
    album?: string;
    source?: TrackSource;
    sourceRef?: string;
    audioUri?: string;
    coverUri?: string;
    artworkUrl?: string;
    lyricsLrc?: string;
    addedBy: MusicAuthor;
  }): Promise<Track> {
    return this.enqueueWrite(async () => {
      const title = input.title.trim();
      if (!title) throw new Error("Track title is required.");
      const source: TrackSource = input.source === "apple-music" ? "apple-music" : "local";
      if (source === "apple-music" && !(input.sourceRef ?? "").trim()) {
        throw new Error("Apple Music tracks need a catalog song id (sourceRef).");
      }
      const track: Track = {
        id: newId("trk"),
        title,
        artist: (input.artist ?? "").trim(),
        album: (input.album ?? "").trim(),
        source,
        sourceRef: (input.sourceRef ?? "").trim(),
        audioUri: (input.audioUri ?? "").trim(),
        coverUri: (input.coverUri ?? "").trim(),
        artworkUrl: (input.artworkUrl ?? "").trim(),
        lyrics: input.lyricsLrc ? parseLrc(input.lyricsLrc) : [],
        addedBy: input.addedBy,
        playCount: 0,
        createdAt: Date.now(),
      };
      const all = await readJson<Track[]>(this.storage, KEYS.tracks, []);
      all.push(track);
      await writeJson(this.storage, KEYS.tracks, all);
      this.emit();
      return track;
    });
  }

  async getTrack(id: string): Promise<Track | null> {
    const all = await readJson<Track[]>(this.storage, KEYS.tracks, []);
    const t = all.find((x) => x.id === id);
    return t ? normalizeTrack(t) : null;
  }

  async listTracks(): Promise<Track[]> {
    const all = await readJson<Track[]>(this.storage, KEYS.tracks, []);
    return all.map(normalizeTrack).sort((a, b) => b.createdAt - a.createdAt);
  }

  async searchTracks(query: string): Promise<Track[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const all = await this.listTracks();
    return all.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q),
    );
  }

  async updateTrack(
    id: string,
    patch: {
      title?: string;
      artist?: string;
      album?: string;
      audioUri?: string;
      coverUri?: string;
      artworkUrl?: string;
      sourceRef?: string;
      lyricsLrc?: string;
    },
  ): Promise<Track | null> {
    return this.enqueueWrite(async () => {
      const all = await readJson<Track[]>(this.storage, KEYS.tracks, []);
      const t = all.find((x) => x.id === id);
      if (!t) return null;
      if (patch.title !== undefined) {
        const v = patch.title.trim();
        if (!v) throw new Error("Track title must not be empty.");
        t.title = v;
      }
      if (patch.artist !== undefined) t.artist = patch.artist.trim();
      if (patch.album !== undefined) t.album = patch.album.trim();
      if (patch.audioUri !== undefined) t.audioUri = patch.audioUri.trim();
      if (patch.coverUri !== undefined) t.coverUri = patch.coverUri.trim();
      if (patch.artworkUrl !== undefined) t.artworkUrl = patch.artworkUrl.trim();
      if (patch.sourceRef !== undefined) t.sourceRef = patch.sourceRef.trim();
      if (patch.lyricsLrc !== undefined) t.lyrics = parseLrc(patch.lyricsLrc);
      await writeJson(this.storage, KEYS.tracks, all);
      this.emit();
      return t;
    });
  }

  async deleteTrack(id: string): Promise<boolean> {
    return this.enqueueWrite(async () => {
      const all = await readJson<Track[]>(this.storage, KEYS.tracks, []);
      const idx = all.findIndex((t) => t.id === id);
      if (idx < 0) return false;
      all.splice(idx, 1);
      await writeJson(this.storage, KEYS.tracks, all);
      // Cascade: playlists, queue, comments, memories, now-playing.
      const playlists = await readJson<Playlist[]>(this.storage, KEYS.playlists, []);
      for (const p of playlists) p.trackIds = p.trackIds.filter((x) => x !== id);
      await writeJson(this.storage, KEYS.playlists, playlists);
      const queue = await readJson<string[]>(this.storage, KEYS.queue, []);
      await writeJson(
        this.storage,
        KEYS.queue,
        queue.filter((x) => x !== id),
      );
      const comments = await readJson<MusicComment[]>(this.storage, KEYS.comments, []);
      await writeJson(
        this.storage,
        KEYS.comments,
        comments.filter((c) => c.trackId !== id),
      );
      const memories = await readJson<MusicMemory[]>(this.storage, KEYS.memories, []);
      await writeJson(
        this.storage,
        KEYS.memories,
        memories.filter((m) => m.trackId !== id),
      );
      const now = await readJson<string | null>(this.storage, KEYS.nowPlaying, null);
      if (now === id) await writeJson(this.storage, KEYS.nowPlaying, null);
      this.emit();
      return true;
    });
  }

  async bumpPlayCount(id: string): Promise<void> {
    await this.enqueueWrite(async () => {
      const all = await readJson<Track[]>(this.storage, KEYS.tracks, []);
      const t = all.find((x) => x.id === id);
      if (!t) return;
      t.playCount += 1;
      await writeJson(this.storage, KEYS.tracks, all);
    });
  }

  // ---------- playlists ----------

  /** Creates 共享歌单 + 我们的歌 on first run. Idempotent. */
  async ensureDefaultPlaylists(): Promise<void> {
    await this.enqueueWrite(async () => {
      const all = await readJson<Playlist[]>(this.storage, KEYS.playlists, []);
      let changed = false;
      if (!all.some((p) => p.id === SHARED_PLAYLIST_ID)) {
        all.push({
          id: SHARED_PLAYLIST_ID,
          name: "",
          kind: "shared",
          trackIds: [],
          createdBy: "her",
          createdAt: Date.now(),
        });
        changed = true;
      }
      if (!all.some((p) => p.id === OURS_PLAYLIST_ID)) {
        all.push({
          id: OURS_PLAYLIST_ID,
          name: "",
          kind: "ours",
          trackIds: [],
          createdBy: "her",
          createdAt: Date.now(),
        });
        changed = true;
      }
      if (changed) {
        await writeJson(this.storage, KEYS.playlists, all);
        this.emit();
      }
    });
  }

  async listPlaylists(): Promise<Playlist[]> {
    await this.ensureDefaultPlaylists();
    const all = await readJson<Playlist[]>(this.storage, KEYS.playlists, []);
    const order = (p: Playlist) => (p.kind === "shared" ? 0 : p.kind === "ours" ? 1 : 2);
    return [...all].sort((a, b) => order(a) - order(b) || a.createdAt - b.createdAt);
  }

  async getPlaylist(id: string): Promise<Playlist | null> {
    const all = await this.listPlaylists();
    return all.find((p) => p.id === id) ?? null;
  }

  async createPlaylist(name: string, createdBy: MusicAuthor): Promise<Playlist> {
    return this.enqueueWrite(async () => {
      const n = name.trim();
      if (!n) throw new Error("Playlist name is required.");
      if (n.length > 60) throw new Error("Playlist name too long (max 60).");
      const pl: Playlist = {
        id: newId("pl"),
        name: n,
        kind: "custom",
        trackIds: [],
        createdBy,
        createdAt: Date.now(),
      };
      const all = await readJson<Playlist[]>(this.storage, KEYS.playlists, []);
      all.push(pl);
      await writeJson(this.storage, KEYS.playlists, all);
      this.emit();
      return pl;
    });
  }

  async renamePlaylist(id: string, name: string): Promise<Playlist | null> {
    return this.enqueueWrite(async () => {
      const n = name.trim();
      if (!n) throw new Error("Playlist name must not be empty.");
      const all = await readJson<Playlist[]>(this.storage, KEYS.playlists, []);
      const p = all.find((x) => x.id === id);
      if (p?.kind !== "custom") return null;
      p.name = n;
      await writeJson(this.storage, KEYS.playlists, all);
      this.emit();
      return p;
    });
  }

  async deletePlaylist(id: string): Promise<boolean> {
    return this.enqueueWrite(async () => {
      const all = await readJson<Playlist[]>(this.storage, KEYS.playlists, []);
      const idx = all.findIndex((p) => p.id === id);
      if (idx < 0 || all[idx].kind !== "custom") return false;
      all.splice(idx, 1);
      await writeJson(this.storage, KEYS.playlists, all);
      this.emit();
      return true;
    });
  }

  async addToPlaylist(playlistId: string, trackId: string): Promise<boolean> {
    await this.ensureDefaultPlaylists();
    return this.enqueueWrite(async () => {
      const track = await this.getTrack(trackId);
      if (!track) throw new Error("Track not found.");
      const all = await readJson<Playlist[]>(this.storage, KEYS.playlists, []);
      const p = all.find((x) => x.id === playlistId);
      if (!p) throw new Error("Playlist not found.");
      if (!p.trackIds.includes(trackId)) {
        p.trackIds.push(trackId);
        await writeJson(this.storage, KEYS.playlists, all);
        this.emit();
      }
      return true;
    });
  }

  async removeFromPlaylist(playlistId: string, trackId: string): Promise<boolean> {
    await this.ensureDefaultPlaylists();
    return this.enqueueWrite(async () => {
      const all = await readJson<Playlist[]>(this.storage, KEYS.playlists, []);
      const p = all.find((x) => x.id === playlistId);
      if (!p) return false;
      const before = p.trackIds.length;
      p.trackIds = p.trackIds.filter((x) => x !== trackId);
      if (p.trackIds.length === before) return false;
      await writeJson(this.storage, KEYS.playlists, all);
      this.emit();
      return true;
    });
  }

  async moveInPlaylist(playlistId: string, trackId: string, dir: -1 | 1): Promise<boolean> {
    await this.ensureDefaultPlaylists();
    return this.enqueueWrite(async () => {
      const all = await readJson<Playlist[]>(this.storage, KEYS.playlists, []);
      const p = all.find((x) => x.id === playlistId);
      if (!p) return false;
      const i = p.trackIds.indexOf(trackId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= p.trackIds.length) return false;
      [p.trackIds[i], p.trackIds[j]] = [p.trackIds[j], p.trackIds[i]];
      await writeJson(this.storage, KEYS.playlists, all);
      this.emit();
      return true;
    });
  }

  async listPlaylistTracks(playlistId: string): Promise<Track[]> {
    const p = await this.getPlaylist(playlistId);
    if (!p) return [];
    const out: Track[] = [];
    for (const id of p.trackIds) {
      const t = await this.getTrack(id);
      if (t) out.push(t);
    }
    return out;
  }

  // ---------- comments ----------

  async addComment(trackId: string, author: MusicAuthor, text: string): Promise<MusicComment> {
    return this.enqueueWrite(async () => {
      const t = text.trim();
      if (!t) throw new Error("Comment must not be empty.");
      if (t.length > 500) throw new Error("Comment too long (max 500).");
      const track = await this.getTrack(trackId);
      if (!track) throw new Error("Track not found.");
      const c: MusicComment = { id: newId("cm"), trackId, author, text: t, createdAt: Date.now() };
      const all = await readJson<MusicComment[]>(this.storage, KEYS.comments, []);
      all.push(c);
      await writeJson(this.storage, KEYS.comments, all);
      this.emit();
      return c;
    });
  }

  async listComments(trackId: string): Promise<MusicComment[]> {
    const all = await readJson<MusicComment[]>(this.storage, KEYS.comments, []);
    return all.filter((c) => c.trackId === trackId).sort((a, b) => a.createdAt - b.createdAt);
  }

  async deleteComment(id: string): Promise<boolean> {
    return this.enqueueWrite(async () => {
      const all = await readJson<MusicComment[]>(this.storage, KEYS.comments, []);
      const idx = all.findIndex((c) => c.id === id);
      if (idx < 0) return false;
      all.splice(idx, 1);
      await writeJson(this.storage, KEYS.comments, all);
      this.emit();
      return true;
    });
  }

  // ---------- per-song memories (presence notes) ----------

  async addMemoryNote(trackId: string, text: string): Promise<MusicMemory> {
    return this.enqueueWrite(async () => {
      const t = text.trim();
      if (!t) throw new Error("Memory note must not be empty.");
      if (t.length > 500) throw new Error("Memory note too long (max 500).");
      const track = await this.getTrack(trackId);
      if (!track) throw new Error("Track not found.");
      const m: MusicMemory = { id: newId("mm"), trackId, text: t, createdAt: Date.now() };
      const all = await readJson<MusicMemory[]>(this.storage, KEYS.memories, []);
      all.push(m);
      await writeJson(this.storage, KEYS.memories, all);
      this.emit();
      return m;
    });
  }

  async listMemoryNotes(trackId: string): Promise<MusicMemory[]> {
    const all = await readJson<MusicMemory[]>(this.storage, KEYS.memories, []);
    return all.filter((m) => m.trackId === trackId).sort((a, b) => b.createdAt - a.createdAt);
  }

  // ---------- queue ----------

  async enqueue(trackId: string): Promise<boolean> {
    return this.enqueueWrite(async () => {
      const track = await this.getTrack(trackId);
      if (!track) throw new Error("Track not found.");
      const q = await readJson<string[]>(this.storage, KEYS.queue, []);
      q.push(trackId);
      await writeJson(this.storage, KEYS.queue, q);
      this.emit();
      return true;
    });
  }

  async listQueue(): Promise<Track[]> {
    const q = await readJson<string[]>(this.storage, KEYS.queue, []);
    const out: Track[] = [];
    for (const id of q) {
      const t = await this.getTrack(id);
      if (t) out.push(t);
    }
    return out;
  }

  async removeFromQueue(trackId: string): Promise<boolean> {
    return this.enqueueWrite(async () => {
      const q = await readJson<string[]>(this.storage, KEYS.queue, []);
      const next = q.filter((x) => x !== trackId);
      if (next.length === q.length) return false;
      await writeJson(this.storage, KEYS.queue, next);
      this.emit();
      return true;
    });
  }

  async moveInQueue(trackId: string, dir: -1 | 1): Promise<boolean> {
    return this.enqueueWrite(async () => {
      const q = await readJson<string[]>(this.storage, KEYS.queue, []);
      const i = q.indexOf(trackId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= q.length) return false;
      [q[i], q[j]] = [q[j], q[i]];
      await writeJson(this.storage, KEYS.queue, q);
      this.emit();
      return true;
    });
  }

  async clearQueue(): Promise<void> {
    await this.enqueueWrite(async () => {
      await writeJson(this.storage, KEYS.queue, []);
      this.emit();
    });
  }

  /** Pops the head of the queue. Returns the track id or null. */
  async shiftQueue(): Promise<string | null> {
    return this.enqueueWrite(async () => {
      const q = await readJson<string[]>(this.storage, KEYS.queue, []);
      const head = q.shift() ?? null;
      await writeJson(this.storage, KEYS.queue, q);
      if (head) this.emit();
      return head;
    });
  }

  // ---------- now playing / DJ intents ----------

  async setNowPlaying(trackId: string | null): Promise<void> {
    await this.enqueueWrite(async () => {
      await writeJson(this.storage, KEYS.nowPlaying, trackId);
      this.emit();
    });
  }

  async getNowPlaying(): Promise<Track | null> {
    const id = await readJson<string | null>(this.storage, KEYS.nowPlaying, null);
    return id ? this.getTrack(id) : null;
  }

  /**
   * The AI writes playback intents from dialog; the UI consumes them.
   * Pure — never touches audio directly.
   */
  async sendIntent(action: DjAction, by: MusicAuthor, trackId?: string): Promise<DjIntent> {
    return this.enqueueWrite(async () => {
      if (action === "play" && trackId) {
        const t = await this.getTrack(trackId);
        if (!t) throw new Error("Track not found.");
      }
      const intent: DjIntent = { action, trackId, at: Date.now(), by };
      await writeJson(this.storage, KEYS.intent, intent);
      this.emit();
      return intent;
    });
  }

  async getIntent(): Promise<DjIntent | null> {
    return readJson<DjIntent | null>(this.storage, KEYS.intent, null);
  }

  // ---------- together mode ----------

  async setTogether(active: boolean, by: MusicAuthor): Promise<TogetherState> {
    return this.enqueueWrite(async () => {
      const s: TogetherState = {
        active,
        startedAt: active ? Date.now() : 0,
        startedBy: active ? by : null,
      };
      await writeJson(this.storage, KEYS.together, s);
      this.emit();
      return s;
    });
  }

  async getTogether(): Promise<TogetherState> {
    const s = await readJson<TogetherState | null>(this.storage, KEYS.together, null);
    return s ?? { active: false, startedAt: 0, startedBy: null };
  }

  // ---------- selected lyric (tap-to-ask) ----------

  async setSelectedLyric(text: string | null): Promise<void> {
    await this.enqueueWrite(async () => {
      await writeJson(this.storage, KEYS.selectedLyric, text);
      this.emit();
    });
  }

  async getSelectedLyric(): Promise<string | null> {
    return readJson<string | null>(this.storage, KEYS.selectedLyric, null);
  }
}
