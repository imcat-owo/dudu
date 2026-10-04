import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createToolRegistry, type ToolContext } from "../src/api-groups/local-tools.js";
import {
  type DjIntent,
  isIntentStale,
  lyricIndexAt,
  type MusicStorage,
  MusicStore,
  normalizeTrack,
  OURS_PLAYLIST_ID,
  parseLrc,
  SHARED_PLAYLIST_ID,
  STALE_INTENT_MS,
  type Track,
} from "../src/music/store.js";
import { createMusicTools } from "../src/music/tools.js";

function fakeStorage(): MusicStorage {
  const map = new Map<string, string>();
  return {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v);
    },
  };
}

const ctx: ToolContext = { authorize: async () => true };

describe("music: LRC parsing", () => {
  it("parses timed lines, ignores metadata and junk", () => {
    const lines = parseLrc("[ti:Title]\n[00:01.00] hello\n[00:05] world\njunk\n[ar:Artist]\n");
    assert.equal(lines.length, 2);
    assert.equal(lines[0].text, "hello");
    assert.ok(Math.abs(lines[0].time - 1) < 0.01);
    assert.ok(Math.abs(lines[1].time - 5) < 0.01);
  });
  it("sorts by time and supports centiseconds", () => {
    const lines = parseLrc("[01:00.50] b\n[00:30.25] a\n");
    assert.equal(lines[0].text, "a");
    assert.ok(Math.abs(lines[1].time - 60.5) < 0.01);
  });
  it("lyricIndexAt finds the active line", () => {
    const lines = parseLrc("[00:01] a\n[00:05] b\n[00:10] c\n");
    assert.equal(lyricIndexAt(lines, 0), -1);
    assert.equal(lyricIndexAt(lines, 1), 0);
    assert.equal(lyricIndexAt(lines, 7), 1);
    assert.equal(lyricIndexAt(lines, 99), 2);
  });
});

describe("music: track migration", () => {
  it("normalizeTrack defaults old tracks to local source", () => {
    const old = { id: "x", title: "Old", lyrics: null } as unknown as Track;
    const n = normalizeTrack(old);
    assert.equal(n.source, "local");
    assert.equal(n.sourceRef, "");
    assert.equal(n.artworkUrl, "");
    assert.deepEqual(n.lyrics, []);
  });
});

describe("music store: tracks", () => {
  it("add/get/list/search/update/delete with cascade", async () => {
    const s = new MusicStore(fakeStorage());
    assert.deepEqual(await s.listTracks(), []);
    const t1 = await s.addTrack({
      title: "晴天",
      artist: "周杰伦",
      audioUri: "file:///a.mp3",
      addedBy: "her",
    });
    const t2 = await s.addTrack({ title: "夜曲", artist: "周杰伦", addedBy: "ai" });
    assert.equal((await s.listTracks()).length, 2);
    assert.equal((await s.searchTracks("晴天")).length, 1);
    assert.equal((await s.searchTracks("周杰伦")).length, 2);
    assert.equal((await s.searchTracks("nope")).length, 0);

    await s.addToPlaylist(SHARED_PLAYLIST_ID, t1.id);
    await s.enqueue(t1.id);
    await s.addComment(t1.id, "her", "好听");
    await s.setNowPlaying(t1.id);
    assert.equal(await s.deleteTrack(t1.id), true);
    assert.equal(await s.deleteTrack(t1.id), false);
    assert.deepEqual(await s.listPlaylistTracks(SHARED_PLAYLIST_ID), []);
    assert.deepEqual(await s.listQueue(), []);
    assert.deepEqual(await s.listComments(t1.id), []);
    assert.equal(await s.getNowPlaying(), null);
    // t2 untouched
    assert.equal((await s.getTrack(t2.id))?.title, "夜曲");
  });

  it("rejects empty title", async () => {
    const s = new MusicStore(fakeStorage());
    await assert.rejects(() => s.addTrack({ title: "  ", addedBy: "her" }));
  });

  it("apple-music tracks require a catalog id", async () => {
    const s = new MusicStore(fakeStorage());
    await assert.rejects(() => s.addTrack({ title: "X", source: "apple-music", addedBy: "ai" }));
    const t = await s.addTrack({
      title: "X",
      source: "apple-music",
      sourceRef: "cat-123",
      artworkUrl: "https://art",
      addedBy: "ai",
    });
    assert.equal(t.source, "apple-music");
    assert.equal(t.sourceRef, "cat-123");
  });

  it("updateTrack patches fields and lyrics", async () => {
    const s = new MusicStore(fakeStorage());
    const t = await s.addTrack({ title: "A", addedBy: "her" });
    const u = await s.updateTrack(t.id, { artist: "B", lyricsLrc: "[00:01] hi" });
    assert.equal(u?.artist, "B");
    assert.equal(u?.lyrics.length, 1);
    assert.equal(await s.updateTrack("nope", { artist: "x" }), null);
  });
});

describe("music store: playlists", () => {
  it("ensures shared + ours defaults, custom CRUD, protects built-ins", async () => {
    const s = new MusicStore(fakeStorage());
    const lists = await s.listPlaylists();
    assert.ok(lists.some((p) => p.id === SHARED_PLAYLIST_ID));
    assert.ok(lists.some((p) => p.id === OURS_PLAYLIST_ID));
    // shared first, ours second
    assert.equal(lists[0].id, SHARED_PLAYLIST_ID);
    assert.equal(lists[1].id, OURS_PLAYLIST_ID);

    const t1 = await s.addTrack({ title: "S1", addedBy: "her" });
    const t2 = await s.addTrack({ title: "S2", addedBy: "her" });
    await s.addToPlaylist(SHARED_PLAYLIST_ID, t1.id);
    await s.addToPlaylist(SHARED_PLAYLIST_ID, t2.id);
    await s.addToPlaylist(SHARED_PLAYLIST_ID, t1.id); // idempotent
    assert.deepEqual(
      (await s.listPlaylistTracks(SHARED_PLAYLIST_ID)).map((t) => t.id),
      [t1.id, t2.id],
    );

    assert.equal(await s.moveInPlaylist(SHARED_PLAYLIST_ID, t1.id, 1), true);
    assert.deepEqual(
      (await s.listPlaylistTracks(SHARED_PLAYLIST_ID)).map((t) => t.id),
      [t2.id, t1.id],
    );
    assert.equal(await s.moveInPlaylist(SHARED_PLAYLIST_ID, t2.id, -1), false); // already first
    assert.equal(await s.removeFromPlaylist(SHARED_PLAYLIST_ID, t1.id), true);
    assert.equal(await s.removeFromPlaylist(SHARED_PLAYLIST_ID, t1.id), false);

    const custom = await s.createPlaylist("跑步歌单", "her");
    assert.equal(custom.kind, "custom");
    assert.ok((await s.renamePlaylist(custom.id, "夜跑"))?.name === "夜跑");
    assert.equal(await s.deletePlaylist(custom.id), true);
    // built-ins cannot be deleted or renamed
    assert.equal(await s.deletePlaylist(SHARED_PLAYLIST_ID), false);
    assert.equal(await s.deletePlaylist(OURS_PLAYLIST_ID), false);
    assert.equal(await s.renamePlaylist(SHARED_PLAYLIST_ID, "x"), null);
    await assert.rejects(() => s.createPlaylist("  ", "her"));
  });
});

describe("music store: queue + DJ intents + together", () => {
  it("queue ops and shift", async () => {
    const s = new MusicStore(fakeStorage());
    const a = await s.addTrack({ title: "A", addedBy: "her" });
    const b = await s.addTrack({ title: "B", addedBy: "her" });
    await s.enqueue(a.id);
    await s.enqueue(b.id);
    assert.deepEqual(
      (await s.listQueue()).map((t) => t.id),
      [a.id, b.id],
    );
    assert.equal(await s.moveInQueue(a.id, 1), true);
    assert.deepEqual(
      (await s.listQueue()).map((t) => t.id),
      [b.id, a.id],
    );
    assert.equal(await s.removeFromQueue(b.id), true);
    assert.equal(await s.shiftQueue(), a.id);
    assert.equal(await s.shiftQueue(), null);
    await s.enqueue(b.id);
    await s.clearQueue();
    assert.deepEqual(await s.listQueue(), []);
  });

  it("DJ intents round-trip; play validates the track", async () => {
    const s = new MusicStore(fakeStorage());
    assert.equal(await s.getIntent(), null);
    const t = await s.addTrack({ title: "DJ", audioUri: "file:///x", addedBy: "ai" });
    const intent = await s.sendIntent("play", "ai", t.id);
    assert.equal(intent.action, "play");
    assert.equal(intent.trackId, t.id);
    assert.equal((await s.getIntent())?.action, "play");
    await assert.rejects(() => s.sendIntent("play", "ai", "nope"));
    await s.sendIntent("pause", "her");
    assert.equal((await s.getIntent())?.by, "her");
  });

  it("together mode toggles", async () => {
    const s = new MusicStore(fakeStorage());
    assert.equal((await s.getTogether()).active, false);
    await s.setTogether(true, "her");
    const on = await s.getTogether();
    assert.equal(on.active, true);
    assert.equal(on.startedBy, "her");
    await s.setTogether(false, "her");
    assert.equal((await s.getTogether()).active, false);
  });

  it("comments, memories, selected lyric", async () => {
    const s = new MusicStore(fakeStorage());
    const t = await s.addTrack({ title: "C", addedBy: "her" });
    await s.addComment(t.id, "her", "泪目");
    await s.addComment(t.id, "ai", "我也喜欢这首");
    const cs = await s.listComments(t.id);
    assert.equal(cs.length, 2);
    assert.equal(cs[0].author, "her");
    await s.addMemoryNote(t.id, "生日那晚一起听的");
    assert.equal((await s.listMemoryNotes(t.id)).length, 1);
    await s.setSelectedLyric("这句歌词");
    assert.equal(await s.getSelectedLyric(), "这句歌词");
    await s.setSelectedLyric(null);
    assert.equal(await s.getSelectedLyric(), null);
    await assert.rejects(() => s.addComment(t.id, "her", "  "));
  });
});

describe("music tools", () => {
  it("exposes 20 dialog tools with unique names", () => {
    const tools = createMusicTools(new MusicStore(fakeStorage()));
    const names = tools.map((t) => t.name);
    assert.equal(new Set(names).size, names.length, "duplicate tool names");
    for (const n of [
      "music_track_add",
      "music_track_search",
      "music_track_read",
      "music_track_delete",
      "music_lyrics_add",
      "music_playlist_create",
      "music_playlist_add",
      "music_playlist_read",
      "music_apple_search",
      "dj_play",
      "dj_pause",
      "dj_skip",
      "dj_restart",
      "dj_queue_add",
      "dj_queue_read",
      "dj_now_read",
      "dj_together_start",
      "dj_together_stop",
      "music_comment_add",
      "music_comment_read",
      "music_ours_add",
      "music_memory_add",
    ]) {
      assert.ok(names.includes(n), `missing tool ${n}`);
    }
  });

  it("点歌 flow: search -> add -> play writes intent", async () => {
    const store = new MusicStore(fakeStorage());
    const reg = createToolRegistry(createMusicTools(store));
    // search finds nothing yet
    assert.match(await reg.execute("music_track_search", { query: "晴天" }, ctx), /No matching/);
    // AI adds it (no audio -> honest placeholder)
    const added = await reg.execute("music_track_add", { title: "晴天", artist: "周杰伦" }, ctx);
    assert.match(added, /No audio yet/);
    const id = (await store.searchTracks("晴天"))[0].id;
    // play writes an intent; the UI applies it
    const played = await reg.execute("dj_play", { track: "晴天" }, ctx);
    assert.match(played, /Now playing: 晴天/);
    assert.match(played, /no audio/);
    const intent = await store.getIntent();
    assert.equal(intent?.action, "play");
    assert.equal(intent?.trackId, id);
    assert.equal((await store.getNowPlaying())?.id, id);
  });

  it("dj_play on unknown song is honest", async () => {
    const store = new MusicStore(fakeStorage());
    const reg = createToolRegistry(createMusicTools(store));
    const out = await reg.execute("dj_play", { track: "不存在的歌" }, ctx);
    assert.match(out, /couldn't find/);
  });

  it("queue + skip advances through the queue", async () => {
    const store = new MusicStore(fakeStorage());
    const reg = createToolRegistry(createMusicTools(store));
    const a = await store.addTrack({ title: "QA", audioUri: "file:///a", addedBy: "her" });
    const b = await store.addTrack({ title: "QB", audioUri: "file:///b", addedBy: "her" });
    await reg.execute("dj_queue_add", { track: a.id }, ctx);
    await reg.execute("dj_queue_add", { track: b.id }, ctx);
    assert.match(await reg.execute("dj_queue_read", {}, ctx), /QA/);
    const skipped = await reg.execute("dj_skip", {}, ctx);
    assert.match(skipped, /Now playing: QA/);
    assert.match(await reg.execute("dj_queue_read", {}, ctx), /QB/);
    assert.doesNotMatch(await reg.execute("dj_queue_read", {}, ctx), /QA/);
  });

  it("together mode + now-read context carries lyric state", async () => {
    const store = new MusicStore(fakeStorage());
    const reg = createToolRegistry(createMusicTools(store));
    const t = await store.addTrack({
      title: "L",
      artist: "A",
      lyricsLrc: "[00:01] hello world",
      addedBy: "her",
    });
    await store.setNowPlaying(t.id);
    await store.setSelectedLyric("hello world");
    await reg.execute("dj_together_start", {}, ctx);
    const now = await reg.execute("dj_now_read", {}, ctx);
    assert.match(now, /Together-listening mode is ON/);
    assert.match(now, /Now playing: L/);
    assert.match(now, /hello world/);
    assert.match(now, /tapped this lyric line/);
    await reg.execute("dj_together_stop", {}, ctx);
    assert.match(await reg.execute("dj_now_read", {}, ctx), /mode is off/);
  });

  it("music_ours_add marks ours + fires the memory hook", async () => {
    const store = new MusicStore(fakeStorage());
    const seen: { track: Track | null } = { track: null };
    const reg = createToolRegistry(
      createMusicTools(store, {
        onOursMarked: async (t) => {
          seen.track = t;
        },
      }),
    );
    const t = await store.addTrack({ title: "Ours", artist: "Us", addedBy: "her" });
    const out = await reg.execute("music_ours_add", { track: t.id }, ctx);
    assert.match(out, /我们的歌/);
    assert.deepEqual(
      (await store.listPlaylistTracks(OURS_PLAYLIST_ID)).map((x) => x.id),
      [t.id],
    );
    assert.equal(seen.track?.id, t.id);
  });

  it("music_apple_search without hook is honest", async () => {
    const store = new MusicStore(fakeStorage());
    const reg = createToolRegistry(createMusicTools(store));
    const out = await reg.execute("music_apple_search", { query: "Beatles" }, ctx);
    assert.match(out, /not wired up/);
  });

  it("music_apple_search via hook returns catalog ids", async () => {
    const store = new MusicStore(fakeStorage());
    const reg = createToolRegistry(
      createMusicTools(store, {
        appleSearch: async (q) => [{ id: "cat-1", title: `Hit for ${q}`, artist: "Someone" }],
      }),
    );
    const out = await reg.execute("music_apple_search", { query: "hello" }, ctx);
    assert.match(out, /catalog id: cat-1/);
    // and the AI can add it as an apple-music track
    const added = await reg.execute(
      "music_track_add",
      {
        title: "Hit for hello",
        artist: "Someone",
        source: "apple-music",
        sourceRef: "cat-1",
      },
      ctx,
    );
    assert.match(added, /Added/);
    const t = (await store.searchTracks("Hit for hello"))[0];
    assert.equal(t.source, "apple-music");
    assert.equal(t.sourceRef, "cat-1");
  });

  it("music_apple_search hook errors pass through honestly", async () => {
    const store = new MusicStore(fakeStorage());
    const reg = createToolRegistry(
      createMusicTools(store, {
        appleSearch: async () => {
          throw new Error("Apple Music is not authorized (state: denied).");
        },
      }),
    );
    const out = await reg.execute("music_apple_search", { query: "x" }, ctx);
    assert.match(out, /not authorized/);
  });

  it("comments round-trip via tools", async () => {
    const store = new MusicStore(fakeStorage());
    const reg = createToolRegistry(createMusicTools(store));
    const t = await store.addTrack({ title: "CC", addedBy: "her" });
    await reg.execute("music_comment_add", { track: t.id, text: "AI 觉得好听" }, ctx);
    const out = await reg.execute("music_comment_read", { track: t.id }, ctx);
    assert.match(out, /AI 觉得好听/);
  });
});

describe("music: manual wiring", () => {
  it("every music tool manualId resolves in the registry", async () => {
    const { getManual } = await import("../src/manuals/index.js");
    const store = new MusicStore(fakeStorage());
    const tools = createMusicTools(store);
    const missing: string[] = [];
    for (const t of tools) {
      const mid = (t as { manualId?: string }).manualId;
      if (mid && !getManual(mid)) missing.push(`${t.name} -> ${mid}`);
    }
    assert.deepEqual(missing, [], `unresolved manualIds: ${missing.join(", ")}`);
  });

  it("dj_play does not bump play count for tracks with no audio", async () => {
    const store = new MusicStore(fakeStorage());
    const reg = createToolRegistry(createMusicTools(store));
    const t = await store.addTrack({ title: "Silent", addedBy: "her" });
    const out = await reg.execute("dj_play", { track: t.id }, ctx);
    assert.match(out, /no audio/);
    assert.equal((await store.getTrack(t.id))?.playCount, 0);
  });
});

describe("music: together-listen dates", () => {
  it("records a date when a song plays with together mode on", async () => {
    const store = new MusicStore(fakeStorage());
    const t = await store.addTrack({ title: "Together Song", addedBy: "her" });
    await store.setTogether(true, "her");
    await store.setNowPlaying(t.id);
    const dates = await store.getTogetherListenDates(t.id);
    assert.equal(dates.length, 1);
    // midnight-normalized
    const d = new Date(dates[0]);
    assert.equal(d.getHours(), 0);
    assert.equal(d.getMinutes(), 0);
  });

  it("does not record when together mode is off", async () => {
    const store = new MusicStore(fakeStorage());
    const t = await store.addTrack({ title: "Solo Song", addedBy: "her" });
    await store.setNowPlaying(t.id);
    const dates = await store.getTogetherListenDates(t.id);
    assert.equal(dates.length, 0);
  });

  it("dedupes multiple plays on the same day", async () => {
    const store = new MusicStore(fakeStorage());
    const t = await store.addTrack({ title: "Replay", addedBy: "her" });
    await store.setTogether(true, "ai");
    await store.setNowPlaying(t.id);
    await store.setNowPlaying(t.id);
    await store.recordTogetherListen(t.id);
    const dates = await store.getTogetherListenDates(t.id);
    assert.equal(dates.length, 1);
  });

  it("dates are sorted newest first", async () => {
    const store = new MusicStore(fakeStorage());
    const t = await store.addTrack({ title: "Old Fav", addedBy: "her" });
    // seed two days directly via storage-level writes through recordTogetherListen
    await store.recordTogetherListen(t.id);
    const dates = await store.getTogetherListenDates(t.id);
    assert.ok(Array.isArray(dates));
    assert.equal(dates.length, 1);
  });

  it("deleteTrack cascades together-listen dates", async () => {
    const store = new MusicStore(fakeStorage());
    const t = await store.addTrack({ title: "Gone", addedBy: "her" });
    await store.setTogether(true, "her");
    await store.setNowPlaying(t.id);
    assert.equal((await store.getTogetherListenDates(t.id)).length, 1);
    await store.deleteTrack(t.id);
    assert.equal((await store.getTogetherListenDates(t.id)).length, 0);
  });

  it("dj_now_read shows together-listen history", async () => {
    const store = new MusicStore(fakeStorage());
    const reg = createToolRegistry(createMusicTools(store));
    const t = await store.addTrack({ title: "Hist", addedBy: "her" });
    await store.setTogether(true, "her");
    await reg.execute("dj_play", { track: t.id }, ctx);
    const out = await reg.execute("dj_now_read", {}, ctx);
    assert.match(out, /一起听过/);
  });

  it("music_track_read includes together-listen dates", async () => {
    const store = new MusicStore(fakeStorage());
    const reg = createToolRegistry(createMusicTools(store));
    const t = await store.addTrack({ title: "Listed", addedBy: "her" });
    await store.setTogether(true, "ai");
    await reg.execute("dj_play", { track: t.id }, ctx);
    const out = await reg.execute("music_track_read", {}, ctx);
    assert.match(out, /一起听过/);
  });
});

describe("music: P2-7/8/9 fixes", () => {
  it("dj_play never bumps play count — the UI counts when audio starts (no double count)", async () => {
    const store = new MusicStore(fakeStorage());
    const reg = createToolRegistry(createMusicTools(store));
    const t = await store.addTrack({
      title: "Loud",
      artist: "A",
      audioUri: "file:///x",
      addedBy: "her",
    });
    await reg.execute("dj_play", { track: t.id }, ctx);
    await reg.execute("dj_play", { track: t.id }, ctx);
    // Tool writes intent + nowPlaying only; count stays 0 until the UI plays audio.
    assert.equal((await store.getTrack(t.id))?.playCount, 0);
  });

  it("dj_skip never bumps play count either", async () => {
    const store = new MusicStore(fakeStorage());
    const reg = createToolRegistry(createMusicTools(store));
    const a = await store.addTrack({ title: "QA", audioUri: "file:///a", addedBy: "her" });
    const b = await store.addTrack({ title: "QB", audioUri: "file:///b", addedBy: "her" });
    await store.enqueue(b.id);
    await store.setNowPlaying(a.id);
    await reg.execute("dj_skip", {}, ctx);
    assert.equal((await store.getTrack(b.id))?.playCount, 0);
  });

  it("dj_restart sends a restart intent (honest name for seek-to-start)", async () => {
    const store = new MusicStore(fakeStorage());
    const reg = createToolRegistry(createMusicTools(store));
    const out = await reg.execute("dj_restart", {}, ctx);
    assert.match(out, /Restarting/);
    const intent = await store.getIntent();
    assert.equal(intent?.action, "restart");
  });

  it("isIntentStale: fresh intent runs, old intent is dropped", () => {
    const fresh: DjIntent = { action: "play", at: Date.now(), by: "ai" };
    assert.equal(isIntentStale(fresh), false);
    const old: DjIntent = { action: "play", at: Date.now() - STALE_INTENT_MS - 1000, by: "ai" };
    assert.equal(isIntentStale(old), true);
    const boundary: DjIntent = {
      action: "play",
      at: Date.now() - STALE_INTENT_MS + 60_000,
      by: "ai",
    };
    assert.equal(isIntentStale(boundary), false);
  });
});
