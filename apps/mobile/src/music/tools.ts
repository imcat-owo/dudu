/**
 * 听歌房 (Music Room) — AI tools. PURE module: no React Native / expo imports.
 *
 * The AI is the DJ: it plays/pauses/skips from DIALOG. Tools write playback
 * INTENTS to the store; the music room UI subscribes and drives the real
 * audio player. The AI can never touch audio directly — the intent bridge
 * is the honest mechanism.
 *
 * 点歌 flow (she requests a song in dialog, e.g. "放晴天"):
 *   1. music_track_search for it.
 *   2. Found -> dj_play it (or dj_queue_add if something is playing).
 *   3. Not found -> music_track_add it WITHOUT audioUri (a placeholder),
 *      tell her honestly you don't have the audio yet and she can attach it
 *      in the music room. Never pretend a song is playing when it isn't.
 *
 * Tool naming follows the existing local-tools convention (snake_case,
 * human-language descriptions written FOR the AI).
 */

import type { LocalTool } from "../api-groups/local-tools.js";
import {
  type MusicAuthor,
  type MusicStore,
  OURS_PLAYLIST_ID,
  SHARED_PLAYLIST_ID,
  type Track,
} from "./store.js";

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

function fmtTrack(t: Track): string {
  const audio = t.audioUri ? "has audio" : "NO AUDIO YET";
  return `- ${t.title} — ${t.artist || "unknown artist"} [${t.id}] (${audio}, plays: ${t.playCount})`;
}

export interface SourceSearchHit {
  id: string;
  title: string;
  artist: string;
}

export interface MusicToolHooks {
  /**
   * Called after a track is marked as one of "我们的歌".
   * Wired in local-agent.ts to write into the AI memory system so the AI
   * truly remembers which songs are special to the two of them.
   */
  onOursMarked?: (track: Track) => Promise<void>;
  /**
   * Apple Music catalog search. Wired in local-agent.ts (the RN layer owns
   * the native MusicKit bridge; this pure module must not import it).
   * Returns hits or throws with an honest, user-facing reason.
   */
  appleSearch?: (query: string, limit: number) => Promise<SourceSearchHit[]>;
}

/**
 * Build the music room tool set bound to a store instance.
 * Every tool REALLY works — no placeholders.
 */
export function createMusicTools(store: MusicStore, hooks: MusicToolHooks = {}): LocalTool[] {
  const ai: MusicAuthor = "ai";

  async function resolveTrack(ref: string): Promise<Track | null> {
    const byId = await store.getTrack(ref);
    if (byId) return byId;
    const hits = await store.searchTracks(ref);
    return hits[0] ?? null;
  }

  return [
    // ---- library ----
    {
      name: "music_track_add",
      description:
        'Add a song to the shared music library (听歌房). Use when she asks you to add/find a song (点歌）. title is required; artist/album/audioUri/lyricsLrc are optional. LOCAL tracks: if you don\'t have an audio URL, OMIT audioUri — the track becomes a placeholder she can attach audio to later in the music room; tell her honestly it has no audio yet. APPLE MUSIC tracks: first music_apple_search the catalog, then add with source="apple-music", sourceRef=<catalog song id>, artworkUrl=<artwork> — these play through her Apple Music subscription. Optionally put it straight into a playlist via playlistId (default: the 共享歌单 shared playlist).',
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Song title (required)." },
          artist: { type: "string", description: "Artist name." },
          album: { type: "string", description: "Album name." },
          audioUri: {
            type: "string",
            description: "Audio file URL or local URI (local tracks). Omit if unknown.",
          },
          source: {
            type: "string",
            description:
              'Where it plays from: "local" (default) or "apple-music" (needs the Apple Music catalog song id as sourceRef).',
          },
          sourceRef: {
            type: "string",
            description: "Apple Music catalog song id (required when source is apple-music).",
          },
          artworkUrl: {
            type: "string",
            description: "Remote artwork URL (e.g. from Apple Music catalog search).",
          },
          lyricsLrc: { type: "string", description: "Lyrics in LRC format ([mm:ss.xx] line)." },
          playlistId: { type: "string", description: "Playlist to add into (default: shared)." },
        },
        required: ["title"],
        additionalProperties: false,
      },
      manualId: "music-room",
      run: async (args) => {
        const t = await store.addTrack({
          title: strArg(args, "title"),
          artist: strArg(args, "artist"),
          album: strArg(args, "album"),
          source: strArg(args, "source") === "apple-music" ? "apple-music" : "local",
          sourceRef: strArg(args, "sourceRef"),
          audioUri: strArg(args, "audioUri"),
          artworkUrl: strArg(args, "artworkUrl"),
          lyricsLrc: strArg(args, "lyricsLrc") || undefined,
          addedBy: ai,
        });
        const plId = strArg(args, "playlistId") || SHARED_PLAYLIST_ID;
        try {
          await store.addToPlaylist(plId, t.id);
        } catch {
          // playlist missing — track still exists in the library
        }
        const audioNote = t.audioUri
          ? "Audio attached."
          : "No audio yet — she can attach it in the music room.";
        return `Added: ${t.title} — ${t.artist || "unknown artist"} [${t.id}]. ${audioNote}`;
      },
    },
    {
      name: "music_track_search",
      description:
        "Search the shared music library by title/artist/album. ALWAYS call this first when she requests a song in dialog (点歌） before playing or adding — never add a duplicate of a song that is already there.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search text." },
        },
        required: ["query"],
        additionalProperties: false,
      },
      manualId: "music-room",
      run: async (args) => {
        const hits = await store.searchTracks(strArg(args, "query"));
        if (hits.length === 0) return "No matching songs in the library.";
        return hits.slice(0, 10).map(fmtTrack).join("\n");
      },
    },
    {
      name: "music_apple_search",
      description:
        'Search the Apple Music catalog (needs her Apple Music authorization + subscription — if it fails, tell her honestly to authorize Apple Music in the music room instead of pretending). Returns catalog songs with ids; feed a chosen id into music_track_add with source="apple-music" so it becomes playable in the room.',
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Song title / artist to search." },
          limit: { type: "number", description: "Max results (default 10)." },
        },
        required: ["query"],
        additionalProperties: false,
      },
      manualId: "music-room",
      run: async (args) => {
        if (!hooks.appleSearch) {
          return "Apple Music search is not wired up in this context. Local tracks still work.";
        }
        try {
          const hits = await hooks.appleSearch(strArg(args, "query"), 10);
          if (hits.length === 0) return "No matching songs in the Apple Music catalog.";
          return hits.map((s) => `- ${s.title} — ${s.artist} [catalog id: ${s.id}]`).join("\n");
        } catch (e) {
          // The hook throws honest, user-facing reasons (not available /
          // not authorized / no subscription) — pass them straight through.
          return e instanceof Error ? e.message : "Apple Music search failed.";
        }
      },
    },
    {
      name: "music_track_read",
      description:
        "List songs in the music library, or in one playlist. Use to see what is available before DJ-ing.",
      parameters: {
        type: "object",
        properties: {
          playlistId: { type: "string", description: "Optional playlist id to list." },
        },
        additionalProperties: false,
      },
      manualId: "music-room",
      run: async (args) => {
        const plId = strArg(args, "playlistId");
        const tracks = plId ? await store.listPlaylistTracks(plId) : await store.listTracks();
        if (tracks.length === 0) return "The library is empty. Add songs with music_track_add.";
        return tracks.slice(0, 30).map(fmtTrack).join("\n");
      },
    },
    {
      name: "music_track_delete",
      description: "Delete a song from the library (also removes it from playlists and the queue).",
      parameters: {
        type: "object",
        properties: { trackId: { type: "string", description: "Track id." } },
        required: ["trackId"],
        additionalProperties: false,
      },
      manualId: "music-room",
      run: async (args) => {
        const ok = await store.deleteTrack(strArg(args, "trackId"));
        return ok ? "Song deleted." : "Song not found.";
      },
    },
    {
      name: "music_lyrics_add",
      description:
        "Attach or replace timed lyrics for a song (LRC format: [mm:ss.xx] line). The music room highlights the current line while playing; she can tap a line to ask you about it.",
      parameters: {
        type: "object",
        properties: {
          trackId: { type: "string", description: "Track id." },
          lyricsLrc: { type: "string", description: "Lyrics in LRC format." },
        },
        required: ["trackId", "lyricsLrc"],
        additionalProperties: false,
      },
      manualId: "music-room",
      run: async (args) => {
        const t = await store.updateTrack(strArg(args, "trackId"), {
          lyricsLrc: strArg(args, "lyricsLrc"),
        });
        if (!t) return "Song not found.";
        return `Lyrics saved for ${t.title}: ${t.lyrics.length} timed lines.`;
      },
    },
    // ---- playlists ----
    {
      name: "music_playlist_create",
      description:
        "Create a new playlist in the music room (e.g. a themed list for the two of you).",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "Playlist name." } },
        required: ["name"],
        additionalProperties: false,
      },
      manualId: "music-room",
      run: async (args) => {
        const p = await store.createPlaylist(strArg(args, "name"), ai);
        return `Playlist created: ${p.name} [${p.id}]`;
      },
    },
    {
      name: "music_playlist_add",
      description: "Add a song to a playlist (track id or search text; playlist id).",
      parameters: {
        type: "object",
        properties: {
          track: { type: "string", description: "Track id or title/artist to search." },
          playlistId: { type: "string", description: "Playlist id." },
        },
        required: ["track", "playlistId"],
        additionalProperties: false,
      },
      manualId: "music-room",
      run: async (args) => {
        const t = await resolveTrack(strArg(args, "track"));
        if (!t) return "Song not found in the library. Add it first with music_track_add.";
        await store.addToPlaylist(strArg(args, "playlistId"), t.id);
        return `Added ${t.title} to the playlist.`;
      },
    },
    {
      name: "music_playlist_read",
      description:
        "List all playlists (共享歌单 shared, 我们的歌 ours, and custom ones) with song counts.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "music-room",
      run: async () => {
        const lists = await store.listPlaylists();
        const kindName = (k: string) =>
          k === "shared" ? "共享歌单" : k === "ours" ? "我们的歌" : "custom";
        return lists
          .map(
            (p) =>
              `- ${p.kind === "custom" ? p.name : kindName(p.kind)} [${p.id}] — ${p.trackIds.length} songs`,
          )
          .join("\n");
      },
    },
    // ---- DJ ----
    {
      name: "dj_play",
      description:
        "DJ: play a song (or resume). Give a track id or a title/artist to search; omit to resume the current song. Writes a playback intent — the music room UI actually starts the audio. If the song has no audio attached, the room will say so honestly instead of playing silence.",
      parameters: {
        type: "object",
        properties: {
          track: {
            type: "string",
            description: "Track id or title/artist to search. Omit to resume.",
          },
        },
        additionalProperties: false,
      },
      manualId: "music-room",
      run: async (args) => {
        const ref = strArg(args, "track");
        if (!ref) {
          const now = await store.getNowPlaying();
          if (!now) return "Nothing to resume — the room is empty. Add songs first.";
          await store.sendIntent("play", ai);
          return `Resuming: ${now.title} — ${now.artist}.`;
        }
        const t = await resolveTrack(ref);
        if (!t)
          return `I couldn't find "${ref}" in the library. Add it first with music_track_add.`;
        await store.setNowPlaying(t.id);
        await store.sendIntent("play", ai, t.id);
        await store.bumpPlayCount(t.id);
        const audioNote = t.audioUri
          ? ""
          : " (Note: this song has no audio attached yet — the room will say so.)";
        return `Now playing: ${t.title} — ${t.artist}.${audioNote}`;
      },
    },
    {
      name: "dj_pause",
      description: "DJ: pause playback. The music room UI applies it.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "music-room",
      run: async () => {
        await store.sendIntent("pause", ai);
        return "Paused.";
      },
    },
    {
      name: "dj_skip",
      description:
        "DJ: skip to the next song in the queue (or the next song in the current playlist context).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "music-room",
      run: async () => {
        const nextId = await store.shiftQueue();
        if (nextId) {
          const t = await store.getTrack(nextId);
          await store.setNowPlaying(nextId);
          await store.sendIntent("play", ai, nextId);
          if (t) await store.bumpPlayCount(nextId);
          return t ? `Skipped. Now playing: ${t.title} — ${t.artist}.` : "Skipped.";
        }
        await store.sendIntent("skip", ai);
        return "Skipped (the room advances to the next song).";
      },
    },
    {
      name: "dj_prev",
      description: "DJ: go back to the previous song.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "music-room",
      run: async () => {
        await store.sendIntent("prev", ai);
        return "Going back to the previous song.";
      },
    },
    {
      name: "dj_queue_add",
      description: "DJ: add a song to the coming-up queue (track id or title/artist to search).",
      parameters: {
        type: "object",
        properties: { track: { type: "string", description: "Track id or title/artist." } },
        required: ["track"],
        additionalProperties: false,
      },
      manualId: "music-room",
      run: async (args) => {
        const t = await resolveTrack(strArg(args, "track"));
        if (!t) return "Song not found in the library. Add it first with music_track_add.";
        await store.enqueue(t.id);
        const q = await store.listQueue();
        return `Queued: ${t.title} — ${t.artist}. (${q.length} in queue)`;
      },
    },
    {
      name: "dj_queue_read",
      description: "DJ: read the coming-up queue.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "music-room",
      run: async () => {
        const q = await store.listQueue();
        if (q.length === 0) return "The queue is empty.";
        return q
          .map((t, i) => `${i + 1}. ${t.title} — ${t.artist || "unknown artist"} [${t.id}]`)
          .join("\n");
      },
    },
    {
      name: "dj_now_read",
      description:
        'Read the full now-playing context: current song, queue, together-listening state, the lyric line she tapped (selectedLyric), and comments. Call this when she asks about lyrics ("这句什么意思") or what is playing — it carries the Duetto-style context: playback state + the exact lyric she is asking about.',
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "music-room",
      run: async () => {
        const now = await store.getNowPlaying();
        const together = await store.getTogether();
        const selected = await store.getSelectedLyric();
        const q = await store.listQueue();
        const lines: string[] = [];
        lines.push(
          together.active
            ? `Together-listening mode is ON (started by ${together.startedBy === "ai" ? "you" : "her"}). You are listening together — the player shows your couple avatar.`
            : "Together-listening mode is off.",
        );
        if (!now) {
          lines.push("Nothing is playing right now.");
        } else {
          lines.push(`Now playing: ${now.title} — ${now.artist || "unknown artist"} [${now.id}]`);
          if (now.lyrics.length > 0) {
            lines.push(`Lyrics (${now.lyrics.length} timed lines):`);
            lines.push(now.lyrics.map((l) => `[${l.time.toFixed(1)}s] ${l.text}`).join("\n"));
          } else {
            lines.push("This song has no timed lyrics attached.");
          }
          const comments = await store.listComments(now.id);
          if (comments.length > 0) {
            lines.push(`Comments on this song (${comments.length}):`);
            for (const c of comments.slice(-5)) {
              lines.push(`- ${c.author === "ai" ? "you" : "her"}: ${c.text}`);
            }
          }
        }
        lines.push(
          selected
            ? `She tapped this lyric line and may ask about it: "${selected}" — answer about THIS line.`
            : "She hasn't tapped any lyric line.",
        );
        if (q.length > 0)
          lines.push(
            `Coming up next: ${q
              .slice(0, 5)
              .map((t) => t.title)
              .join(", ")}`,
          );
        return lines.join("\n");
      },
    },
    {
      name: "dj_together_start",
      description:
        'Start together-listening mode (拉她一起听 / 她拉你一起听）: the music room shows your couple avatar stuck together on the player — the visual signature that you two are listening as a pair. Call when she says "一起听" or you invite her.',
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "music-room",
      run: async () => {
        await store.setTogether(true, ai);
        return "Together-listening mode is ON. The player now shows your couple avatar.";
      },
    },
    {
      name: "dj_together_stop",
      description: "Stop together-listening mode.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "music-room",
      run: async () => {
        await store.setTogether(false, ai);
        return "Together-listening mode is off.";
      },
    },
    // ---- comments / ours / memories ----
    {
      name: "music_comment_add",
      description:
        "Comment on a song (NetEase-style), as the AI. Use when you want to react to a song you are listening to together — she sees it in the music room under the song.",
      parameters: {
        type: "object",
        properties: {
          track: { type: "string", description: "Track id or title/artist." },
          text: { type: "string", description: "Your comment (max 500 chars)." },
        },
        required: ["track", "text"],
        additionalProperties: false,
      },
      manualId: "music-room",
      run: async (args) => {
        const t = await resolveTrack(strArg(args, "track"));
        if (!t) return "Song not found.";
        await store.addComment(t.id, ai, strArg(args, "text"));
        return `Commented on ${t.title}.`;
      },
    },
    {
      name: "music_comment_read",
      description: "Read comments on a song (track id or title/artist).",
      parameters: {
        type: "object",
        properties: { track: { type: "string", description: "Track id or title/artist." } },
        required: ["track"],
        additionalProperties: false,
      },
      manualId: "music-room",
      run: async (args) => {
        const t = await resolveTrack(strArg(args, "track"));
        if (!t) return "Song not found.";
        const list = await store.listComments(t.id);
        if (list.length === 0) return `No comments on ${t.title} yet.`;
        return list.map((c) => `- ${c.author === "ai" ? "you" : "her"}: ${c.text}`).join("\n");
      },
    },
    {
      name: "music_ours_add",
      description:
        'Mark a song as one of "我们的歌" (our songs) — it goes into the 我们的歌 playlist AND into your long-term memory, so you truly remember which songs are special to the two of you.',
      parameters: {
        type: "object",
        properties: { track: { type: "string", description: "Track id or title/artist." } },
        required: ["track"],
        additionalProperties: false,
      },
      manualId: "music-room",
      run: async (args) => {
        const t = await resolveTrack(strArg(args, "track"));
        if (!t) return "Song not found in the library. Add it first with music_track_add.";
        await store.addToPlaylist(OURS_PLAYLIST_ID, t.id);
        if (hooks.onOursMarked) {
          try {
            await hooks.onOursMarked(t);
          } catch {
            // memory write failing must not break the playlist add
          }
        }
        return `「${t.title}」 is now one of 我们的歌. Remembered.`;
      },
    },
    {
      name: "music_memory_add",
      description:
        'Save a presence note about a song (e.g. "we listened to this on her birthday, she cried at the second verse"). Kept with the song in the music room.',
      parameters: {
        type: "object",
        properties: {
          track: { type: "string", description: "Track id or title/artist." },
          text: { type: "string", description: "The memory note (max 500 chars)." },
        },
        required: ["track", "text"],
        additionalProperties: false,
      },
      manualId: "music-room",
      run: async (args) => {
        const t = await resolveTrack(strArg(args, "track"));
        if (!t) return "Song not found.";
        await store.addMemoryNote(t.id, strArg(args, "text"));
        return `Memory note saved for ${t.title}.`;
      },
    },
  ];
}
