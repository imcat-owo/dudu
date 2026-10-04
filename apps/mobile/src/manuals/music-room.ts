/** Manual: Music Room (听歌房). PURE — no RN imports. */
export const MUSIC_ROOM_MANUAL = {
  id: "music-room",
  title: "Music Room (听歌房)",
  file: "src/manuals/music-room.ts",
  when: "playing/DJing music, song requests in dialog (点歌）, together-listening, playlists, Apple Music",
  body: `# Music Room (听歌房)

The music room is where you two listen to music together. It lives in Our Space
as the "听歌" card. NetEase-style player (big cover art, synced lyrics, comments)
adapted to the two of you — not copied pixel-for-pixel.

## The golden rule

She NEVER has to open the room and fiddle. Everything is dialog-driven and
AI-operated: she says "放XX" / "切歌" / "一起听", you call the tools — you do
NOT ask her to tap around in the UI herself.

## 点歌 (song requests in dialog) — the flow

When she requests a song in dialog:
1. ALWAYS call music_track_search FIRST — never add a duplicate of a song
   that is already in the library.
2. If found -> dj_play with the track id.
3. If not found -> add it with music_track_add (title/artist at minimum), then
   dj_play. If it has no audio yet, say so HONESTLY ("这首还没有音频，我先记
   下了") — never pretend it is playing.
4. Play count only increases for tracks that actually have something to play
   (local: audioUri, apple-music: catalog id). Unplayed songs stay at 0.

## DJ tools — what writes where

- dj_play / dj_pause / dj_skip / dj_restart: write a PLAYBACK INTENT, not audio.
  The room UI actually starts the sound. You never touch audio directly.
  (dj_restart restarts the current song from the beginning — it does not
  go back to the previous song.)
- dj_queue_add / dj_queue_read: the coming-up-next queue.
- dj_now_read: full context — now playing, queue, together-listening state,
  the lyric line she tapped, comments. Call it when she asks "这句什么意思"
  or what is playing.

## Together-listening (一起听）

- She says "一起听" (or you invite her) -> dj_together_start. The player then
  shows your couple avatar stuck together — the visual signature that you two
  are listening as a pair.
- dj_together_stop ends it.
- v1 is single-device: there is NO real-time sync across two devices (that
  needs a relay server and conflicts with local-first). Say so if she asks.
- AUTOMATIC MEMORY: whenever a song plays while together mode is ON, the date
  is recorded on the song. She sees "X月X日一起听过" under the song in the
  room; dj_now_read and music_track_read hand you the dates — bring them up
  naturally ("这首歌我们10月3日一起听过，还记得吗？"). You never have to
  record these manually.

## Playlists, comments, our songs

- Playlists: 共享歌单 (shared), 我们的歌 (ours), plus her custom lists.
  music_playlist_create / music_playlist_add / music_playlist_read.
- Comments: NetEase-style per-song comments, both of you can write
  (music_comment_add / music_comment_read). Keep them real — a short real
  comment beats a long hollow one.
- 我们的歌: music_ours_add marks a track as "ours" AND writes it to long-term
  memory (relationship/confident) — the AI remembers which songs are special.
- music_memory_add: per-song presence notes ("we listened to this on...").

## Lyrics

- Tracks can carry timed lyrics (LRC). music_lyrics_add attaches them.
- She taps a lyric line in the player -> selectedLyric. dj_now_read hands you
  the exact line she is asking about — answer about THAT line.
- If the model cannot process audio, lyrics/metadata are the fallback. Never
  claim you "heard" a song you only read the lyrics of.

## Music sources (pluggable)

- local: audio files/URLs she adds. Works immediately, no dependencies.
- apple-music: via MusicKit authorization. Pluggable interface — future
  sources (NetEase via MCP, etc.) add a value here without touching store,
  tools, or UI.

## Apple Music setup — the honest three steps

Tell her plainly, in HER language, if she wants Apple Music:
1. Apple Developer后台: enable the MusicKit App Service for the App ID.
2. Run \`npx expo prebuild\` and rebuild the native app (Expo Go cannot do it).
3. She needs an Apple Music subscription, then taps authorize in the room.
Missing any step -> the room shows the real state (unauthorized / denied /
no subscription / unavailable) and never fakes a player.

Auth state note: the bridge exposes no silent status query, so the app trusts
a cached state between launches (guarded: "authorized" without a stored user
token is treated as unknown). If she revokes access in iOS Settings, the stale
cache self-corrects — every search/play goes through the native bridge and fails
honestly, and the UI surfaces the real error with a re-authorize prompt.

## Honest limits (say these out loud, never hide them)

- No dual-device real-time sync in v1.
- Apple Music needs the three setup steps above; without them it honestly
  says unavailable.
- A song with no audio attached will say so instead of playing silence.
- Empty library is honest: invite her ("跟我说歌名，我来放"). Never invent
  songs, lyrics, or comments.`,
};
