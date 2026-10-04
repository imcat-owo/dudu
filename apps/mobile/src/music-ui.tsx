/**
 * 听歌房 (Music Room) — NetEase-inspired, couple-adapted.
 *
 * Borrowed from NetEase Cloud Music's UI language (not copied pixel-for-pixel):
 * - Now-playing screen: large album art (slowly rotating while playing),
 *   synchronized lyrics with the current line highlighted, progress bar,
 *   play controls.
 * - Comment culture -> adapted to the couple: she comments, the AI comments;
 *   per-song comments live under the song.
 * - Playlists + queue: 共享歌单 (shared), 我们的歌 (ours), custom lists.
 *
 * Couple adaptations:
 * - "拉我一起听" together mode: the player wears the couple avatar
 *   (her + AI stuck together, like the Our Space header).
 * - The AI DJs from dialog via dj_* intents; this UI applies them to the
 *   real audio player. She can also 点歌 in dialog — the AI handles it.
 * - Tapping a lyric line selects it; she asks about it in dialog and the
 *   AI answers with full lyric context (dj_now_read).
 *
 * Honest limits, stated in the UI: no real-time two-device sync (v1 is
 * single-device); a song without audio cannot play and says so.
 */

import * as ImagePicker from "expo-image-picker";
import {
  ChevronDown,
  ChevronUp,
  Disc3,
  Heart,
  ListMusic,
  ListPlus,
  MoreHorizontal,
  Music2,
  Pause,
  Play,
  Plus,
  Search,
  Send,
  SkipBack,
  SkipForward,
  Trash2,
  Users,
  X,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { soraSource } from "./avatar-assets";
import { TText } from "./font";
import { type StringKey, t } from "./i18n";
import { musicStore } from "./music/instance";
import {
  isIntentStale,
  lyricIndexAt,
  OURS_PLAYLIST_ID,
  type Playlist,
  SHARED_PLAYLIST_ID,
  type Track,
  type TrackSource,
} from "./music/store";
import { ourSpaceStore } from "./our-space/instance";
import { FadeIn, PressableScale, SoftCard, StaggerIn, useOurSpaceVersion } from "./our-space-ui";
import { petActivity } from "./pet/store";
import { SoraAmbient } from "./sora-ambient";
import { radii } from "./theme/radii";
import { useTheme } from "./theme/ThemeContext";
import { useColors } from "./ui";

/** Re-render whenever the music store changes (AI writes from dialog). */
function useMusicVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => musicStore.subscribe(() => setV((x) => x + 1)), []);
  return v;
}

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The couple avatar, mini version: her avatar + AI avatar stuck together
 * with a heart between — the visual signature of together-listening.
 */
function CoupleAvatarMini({ size = 44 }: { size?: number }) {
  const osv = useOurSpaceVersion();
  const colors = useColors();
  const [profile, setProfile] = useState<{
    herAvatarUri: string | null;
    aiAvatarUri: string | null;
  } | null>(null);
  useEffect(() => {
    void ourSpaceStore.getCoupleProfile().then(setProfile);
  }, [osv]);
  const herSource = profile?.herAvatarUri ? { uri: profile.herAvatarUri } : null;
  const aiSource = (profile?.aiAvatarUri ? { uri: profile.aiAvatarUri } : soraSource()) as
    | { uri: string }
    | number;
  const r = size / 2;
  const one = (source: { uri: string } | number | null, fallback: React.ReactNode) => (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: r,
        backgroundColor: colors.sky,
        borderWidth: 2.5,
        borderColor: colors.card,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {source ? (
        <Image
          source={source as never}
          style={{ width: size - 5, height: size - 5, borderRadius: r - 2.5 }}
        />
      ) : (
        fallback
      )}
    </View>
  );
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {one(herSource, <Music2 size={size * 0.4} color={colors.muted} strokeWidth={1.5} />)}
      <View style={{ marginLeft: -size * 0.32, marginRight: -size * 0.32, zIndex: 2 }}>
        <View
          style={{
            width: size * 0.62,
            height: size * 0.62,
            borderRadius: size * 0.31,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.line,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Heart size={size * 0.3} color="#C15F3C" fill="#C15F3C" strokeWidth={1.8} />
        </View>
      </View>
      {one(aiSource, <Heart size={size * 0.4} color={colors.muted} strokeWidth={1.5} />)}
    </View>
  );
}

function playlistName(p: Playlist): string {
  if (p.kind === "shared") return t("music.playlist.shared");
  if (p.kind === "ours") return t("music.playlist.ours");
  return p.name;
}

// ---------------------------------------------------------------------------
// Player engine: applies DJ intents (dialog) + her taps to real audio,
// routing per-track through the pluggable source layer.
// ---------------------------------------------------------------------------

function authStateMessage(s: string): string {
  switch (s) {
    case "not-subscribed":
      return t("music.auth.noSubscription");
    case "denied":
      return t("music.auth.deniedHint");
    case "unavailable":
    case "not-configured":
      return t("music.auth.setupHint");
    default:
      return t("music.auth.needAuth");
  }
}

function usePlayerEngine() {
  const v = useMusicVersion();
  const [nowPlaying, setNowPlaying] = useState<Track | null>(null);
  const [status, setStatus] = useState({
    playing: false,
    position: 0,
    duration: null as number | null,
    trackId: null as string | null,
  });
  const [error, setError] = useState("");
  const [together, setTogether] = useState({
    active: false,
    startedAt: 0,
    startedBy: null as "her" | "ai" | null,
  });
  const appliedIntentAt = useRef(0);
  const activeSourceId = useRef<TrackSource>("local");
  const statusUnsub = useRef<(() => void) | null>(null);
  const contextPlaylist = useRef<string | null>(null);
  const prevPlaying = useRef(false);
  const advancing = useRef(false);

  const subscribeSource = useCallback((sourceId: TrackSource) => {
    statusUnsub.current?.();
    void import("./music/sources").then(({ getMusicSource }) => {
      statusUnsub.current = getMusicSource(sourceId).onStatus((s) =>
        setStatus({
          playing: s.playing,
          position: s.position,
          duration: s.duration,
          trackId: s.trackId,
        }),
      );
    });
    activeSourceId.current = sourceId;
  }, []);

  useEffect(() => () => statusUnsub.current?.(), []);
  useEffect(() => {
    void musicStore.getNowPlaying().then(setNowPlaying);
    void musicStore.getTogether().then(setTogether);
  }, [v]);

  const playTrack = useCallback(
    async (track: Track, playlistId?: string | null) => {
      setError("");
      try {
        const { getMusicSource } = await import("./music/sources");
        const src = getMusicSource(track.source);
        if (track.source === "apple-music") {
          const st = await src.getAuthState();
          if (st !== "authorized") throw new Error(authStateMessage(st));
          if (!track.sourceRef) throw new Error(t("music.auth.needAuth"));
        } else if (!track.audioUri) {
          throw new Error(t("music.noAudio"));
        }
        if (activeSourceId.current !== track.source) {
          await getMusicSource(activeSourceId.current).release();
        }
        await src.load({
          id: track.id,
          title: track.title,
          artist: track.artist,
          artworkUrl: track.artworkUrl || track.coverUri,
          duration: null,
          source: track.source,
          playableRef: track.source === "apple-music" ? track.sourceRef : track.audioUri,
        });
        subscribeSource(track.source);
        await src.play();
        await musicStore.setNowPlaying(track.id);
        await musicStore.bumpPlayCount(track.id);
        if (playlistId !== undefined) contextPlaylist.current = playlistId;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Playback failed.");
      }
    },
    [subscribeSource],
  );

  const advance = useCallback(async () => {
    if (advancing.current) return;
    advancing.current = true;
    try {
      const nextId = await musicStore.shiftQueue();
      if (nextId) {
        const tr = await musicStore.getTrack(nextId);
        if (tr) {
          await playTrack(tr);
          return;
        }
      }
      if (contextPlaylist.current && nowPlaying) {
        const tracks = await musicStore.listPlaylistTracks(contextPlaylist.current);
        const i = tracks.findIndex((x) => x.id === nowPlaying.id);
        const next = tracks[i + 1];
        if (next) {
          await playTrack(next, contextPlaylist.current);
          return;
        }
      }
      const { getMusicSource } = await import("./music/sources");
      await getMusicSource(activeSourceId.current).pause();
    } finally {
      advancing.current = false;
    }
  }, [nowPlaying, playTrack]);

  const toggle = useCallback(async () => {
    setError("");
    try {
      const { getMusicSource } = await import("./music/sources");
      const src = getMusicSource(activeSourceId.current);
      if (!nowPlaying) {
        // Nothing loaded: play the first song of the shared playlist.
        const tracks = await musicStore.listPlaylistTracks(SHARED_PLAYLIST_ID);
        if (tracks[0]) await playTrack(tracks[0], SHARED_PLAYLIST_ID);
        return;
      }
      if (status.playing) await src.pause();
      else {
        if (status.trackId !== nowPlaying.id) await playTrack(nowPlaying);
        else await src.play();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Playback failed.");
    }
  }, [nowPlaying, status, playTrack]);

  const seek = useCallback(async (seconds: number) => {
    try {
      const { getMusicSource } = await import("./music/sources");
      await getMusicSource(activeSourceId.current).seekTo(seconds);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Seek failed.");
    }
  }, []);

  // DJ intents from dialog: the AI drives playback by writing intents.
  useEffect(() => {
    void (async () => {
      const intent = await musicStore.getIntent();
      if (!intent || intent.at <= appliedIntentAt.current) return;
      appliedIntentAt.current = intent.at;
      // Stale intents (e.g. written before the app was backgrounded) must
      // never suddenly start music — consume and ignore them.
      if (isIntentStale(intent)) return;
      setError("");
      try {
        if (intent.action === "play") {
          if (intent.trackId) {
            const tr = await musicStore.getTrack(intent.trackId);
            if (tr) {
              await playTrack(tr);
              return;
            }
          }
          const { getMusicSource } = await import("./music/sources");
          const src = getMusicSource(activeSourceId.current);
          if (nowPlaying && status.trackId !== nowPlaying.id) await playTrack(nowPlaying);
          else await src.play();
        } else if (intent.action === "pause") {
          const { getMusicSource } = await import("./music/sources");
          await getMusicSource(activeSourceId.current).pause();
        } else if (intent.action === "skip") {
          await advance();
        } else if (intent.action === "restart") {
          const { getMusicSource } = await import("./music/sources");
          await getMusicSource(activeSourceId.current).seekTo(0);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "DJ command failed.");
      }
    })();
  }, [v, playTrack, advance, nowPlaying, status.trackId]);

  // Natural finish -> advance (local source reports playing:false + position:0).
  useEffect(() => {
    const was = prevPlaying.current;
    prevPlaying.current = status.playing;
    if (was && !status.playing && status.position === 0 && status.trackId) {
      void advance();
    }
  }, [status, advance]);

  const toggleTogether = useCallback(async () => {
    const next = !together.active;
    const s = await musicStore.setTogether(next, "her");
    setTogether(s);
  }, [together.active]);

  return {
    nowPlaying,
    status,
    error,
    setError,
    together,
    toggleTogether,
    playTrack,
    toggle,
    seek,
    advance,
    contextPlaylist,
  };
}

// ---------------------------------------------------------------------------
// Now playing card: NetEase-style — big art, synced lyrics, progress, controls
// ---------------------------------------------------------------------------

function CoverArt({
  track,
  size,
  spinning,
}: {
  track: Track | null;
  size: number;
  spinning: boolean;
}) {
  const colors = useColors();
  const spin = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);
  const breatheRef = useRef<Animated.CompositeAnimation | null>(null);
  useEffect(() => {
    if (spinning) {
      animRef.current = Animated.loop(
        Animated.timing(spin, {
          toValue: 1,
          duration: 24000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
      animRef.current.start();
      // Gentle "breathing" swell while the music plays — the disc feels alive.
      breatheRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(breathe, {
            toValue: 1,
            duration: 2300,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(breathe, {
            toValue: 0,
            duration: 2300,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      );
      breatheRef.current.start();
    } else {
      animRef.current?.stop();
      breatheRef.current?.stop();
      breathe.setValue(0);
    }
    return () => {
      animRef.current?.stop();
      breatheRef.current?.stop();
    };
  }, [spinning, spin, breathe]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const breatheScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.045] });
  const uri = track?.coverUri || track?.artworkUrl || "";
  return (
    <View style={{ alignItems: "center" }}>
      <Animated.View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          transform: [{ rotate }, { scale: breatheScale }],
          shadowColor: "#000",
          shadowOpacity: 0.18,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 10 },
        }}
      >
        {uri ? (
          <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />
        ) : (
          <View
            style={{
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: colors.sky,
              borderWidth: 1,
              borderColor: colors.line,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Disc3 size={size * 0.4} color={colors.muted} strokeWidth={1.2} />
          </View>
        )}
      </Animated.View>
      {/* spindle hole */}
      <View
        style={{
          position: "absolute",
          top: size / 2 - 14,
          width: 28,
          height: 28,
          borderRadius: radii.md,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.line,
        }}
      />
    </View>
  );
}

function ProgressBar({
  position,
  duration,
  onSeek,
}: {
  position: number;
  duration: number | null;
  onSeek: (s: number) => void;
}) {
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const dur = duration && duration > 0 ? duration : 0;
  const ratio = dur > 0 ? Math.min(1, position / dur) : 0;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <TText style={{ color: colors.muted, fontSize: 12, width: 40 }}>{fmtTime(position)}</TText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("music.nowPlaying")}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onPress={(e) => {
          if (width > 0 && dur > 0) onSeek((e.nativeEvent.locationX / width) * dur);
        }}
        style={{ flex: 1, height: 22, justifyContent: "center" }}
      >
        <View style={{ height: 4, borderRadius: radii.xs, backgroundColor: colors.line }}>
          <View
            style={{
              width: `${ratio * 100}%`,
              height: 4,
              borderRadius: radii.xs,
              backgroundColor: colors.text,
            }}
          />
        </View>
        <View
          style={{
            position: "absolute",
            left: `${ratio * 100}%`,
            marginLeft: -6,
            width: 12,
            height: 12,
            borderRadius: radii.xs,
            backgroundColor: colors.card,
            borderWidth: 2,
            borderColor: colors.text,
          }}
        />
      </Pressable>
      <TText style={{ color: colors.muted, fontSize: 12, width: 40, textAlign: "right" }}>
        {dur > 0 ? fmtTime(dur) : "--:--"}
      </TText>
    </View>
  );
}

const LYRIC_LINE_H = 34;

function LyricsView({ track, position }: { track: Track; position: number }) {
  const colors = useColors();
  const mv = useMusicVersion();
  const [selected, setSelected] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const idx = lyricIndexAt(track.lyrics, position);
  // Stable keys: LRC order never changes for a track; duplicates get a suffix.
  const keyed = useMemo(() => {
    const seen = new Map<string, number>();
    return track.lyrics.map((l) => {
      const base = `${l.time.toFixed(3)}|${l.text}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return { ...l, key: n === 1 ? base : `${base}#${n}` };
    });
  }, [track.lyrics]);

  useEffect(() => {
    void musicStore.getSelectedLyric().then(setSelected);
  }, [mv]);

  useEffect(() => {
    if (idx >= 0)
      scrollRef.current?.scrollTo({
        y: Math.max(0, idx * LYRIC_LINE_H - LYRIC_LINE_H),
        animated: true,
      });
  }, [idx]);

  if (track.lyrics.length === 0) {
    return (
      <TText
        style={{ color: colors.muted, fontSize: 13, textAlign: "center", paddingVertical: 18 }}
      >
        {t("music.lyrics.none")}
      </TText>
    );
  }

  const tapLine = async (text: string) => {
    const next = selected === text ? null : text;
    await musicStore.setSelectedLyric(next);
    setSelected(next);
  };

  return (
    <View>
      <ScrollView
        ref={scrollRef}
        style={{ maxHeight: LYRIC_LINE_H * 5 + 8 }}
        showsVerticalScrollIndicator={false}
      >
        {keyed.map((l, i) => {
          const active = i === idx;
          const isSel = selected === l.text;
          return (
            <Pressable
              key={l.key}
              onPress={() => void tapLine(l.text)}
              style={{ minHeight: LYRIC_LINE_H, justifyContent: "center" }}
            >
              <TText
                style={{
                  textAlign: "center",
                  fontSize: active ? 16 : 13.5,
                  fontWeight: active ? "700" : "400",
                  color: active ? colors.text : isSel ? colors.text : colors.muted,
                  opacity: active ? 1 : 0.75,
                  textDecorationLine: isSel && !active ? "underline" : "none",
                }}
              >
                {l.text}
              </TText>
            </Pressable>
          );
        })}
      </ScrollView>
      <TText style={{ color: colors.muted, fontSize: 11, textAlign: "center", marginTop: 6 }}>
        {t("music.lyrics.tapHint")}
      </TText>
    </View>
  );
}

function ControlButton({
  onPress,
  label,
  children,
  primary,
}: {
  onPress: () => void;
  label: string;
  children: React.ReactNode;
  primary?: boolean;
}) {
  const colors = useColors();
  const size = primary ? 64 : 48;
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: primary ? colors.text : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {children}
      </View>
    </PressableScale>
  );
}

// ---------------------------------------------------------------------------
// Source picker: Local vs Apple Music (auth state + authorize flow)
// ---------------------------------------------------------------------------

function authBadgeKey(s: string): StringKey {
  switch (s) {
    case "authorized":
      return "music.auth.authorized";
    case "denied":
      return "music.auth.denied";
    case "not-subscribed":
      return "music.auth.notSubscribed";
    case "unavailable":
    case "not-configured":
      return "music.auth.unavailable";
    default:
      return "music.auth.unknown";
  }
}

function SourcePicker({ onAppleSearch }: { onAppleSearch: () => void }) {
  const colors = useColors();
  const [appleState, setAppleState] = useState("unknown");
  const [authorizing, setAuthorizing] = useState(false);
  const mv = useMusicVersion();

  useEffect(() => {
    void import("./music/sources").then(async ({ getMusicSource }) => {
      try {
        setAppleState(await getMusicSource("apple-music").getAuthState());
      } catch {
        setAppleState("unavailable");
      }
    });
  }, [mv]);

  const authorize = async () => {
    setAuthorizing(true);
    try {
      const { getMusicSource } = await import("./music/sources");
      setAppleState(await getMusicSource("apple-music").authorize());
    } catch {
      setAppleState("unknown");
    } finally {
      setAuthorizing(false);
    }
  };

  const card = (
    title: string,
    subtitle: string,
    badge: string | null,
    badgeOk: boolean,
    onPress: () => void,
  ) => (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={{ flex: 1 }}
    >
      <View
        style={{
          backgroundColor: colors.card,
          borderRadius: radii.lg,
          borderWidth: 1,
          borderColor: colors.line,
          padding: 14,
          gap: 6,
        }}
      >
        <TText style={{ color: colors.text, fontSize: 14, fontWeight: "700" }}>{title}</TText>
        <TText style={{ color: colors.muted, fontSize: 11.5 }}>{subtitle}</TText>
        {badge && (
          <View
            style={{
              alignSelf: "flex-start",
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: radii.lg,
              backgroundColor: badgeOk ? colors.sky : "transparent",
              borderWidth: 1,
              borderColor: colors.line,
            }}
          >
            <TText style={{ fontSize: 10.5, color: badgeOk ? colors.text : colors.muted }}>
              {authorizing ? t("music.source.authorizing") : badge}
            </TText>
          </View>
        )}
      </View>
    </PressableScale>
  );

  const appleOk = appleState === "authorized";
  return (
    <View style={{ gap: 8 }}>
      <TText style={{ color: colors.muted, fontSize: 12 }}>{t("music.source.title")}</TText>
      <View style={{ flexDirection: "row", gap: 10 }}>
        {card(t("music.source.local"), t("music.source.local"), null, false, () => {})}
        {card(
          t("music.source.appleMusic"),
          appleOk ? t("music.source.addFromApple") : t("music.auth.needAuth"),
          t(authBadgeKey(appleState)),
          appleOk,
          () => {
            if (appleOk) onAppleSearch();
            else void authorize();
          },
        )}
      </View>
      {appleState === "not-subscribed" && (
        <TText style={{ color: colors.muted, fontSize: 11.5 }}>
          {t("music.auth.noSubscription")}
        </TText>
      )}
      {(appleState === "unavailable" || appleState === "not-configured") && (
        <TText style={{ color: colors.muted, fontSize: 11.5 }}>{t("music.auth.setupHint")}</TText>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Together bar: 拉我一起听
// ---------------------------------------------------------------------------

function TogetherBar({
  together,
  onToggle,
}: {
  together: { active: boolean };
  onToggle: () => void;
}) {
  const colors = useColors();
  return (
    <PressableScale
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={t("music.together.invite")}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          backgroundColor: colors.card,
          borderRadius: radii.lg,
          borderWidth: 1,
          borderColor: together.active ? colors.text : colors.line,
          padding: 14,
        }}
      >
        {together.active ? (
          <CoupleAvatarMini size={46} />
        ) : (
          <View
            style={{
              width: 46,
              height: 46,
              borderRadius: radii.xl,
              backgroundColor: colors.sky,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Users size={22} color={colors.muted} strokeWidth={1.5} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <TText style={{ color: colors.text, fontSize: 14.5, fontWeight: "700" }}>
            {together.active ? t("music.together.listening") : t("music.together.invite")}
          </TText>
          {!together.active && (
            <TText style={{ color: colors.muted, fontSize: 11.5, marginTop: 2 }}>
              {t("music.together.off")}
            </TText>
          )}
        </View>
        <View
          style={{
            width: 46,
            height: 26,
            borderRadius: radii.md,
            backgroundColor: together.active ? colors.text : colors.line,
            justifyContent: "center",
            paddingHorizontal: 3,
            alignItems: together.active ? "flex-end" : "flex-start",
          }}
        >
          <View
            style={{ width: 20, height: 20, borderRadius: radii.sm, backgroundColor: colors.card }}
          />
        </View>
      </View>
    </PressableScale>
  );
}

// ---------------------------------------------------------------------------
// Now playing section
// ---------------------------------------------------------------------------

/**
 * AlbumGlow — ambient blurred halo behind the now-playing card.
 *
 * Renders the current track's cover art scaled up and heavily blurred with a
 * theme-aware dim veil, crossfading smoothly when the track changes. Pure
 * atmosphere: it never carries information, so readability is untouched.
 */
function AlbumGlow({ track }: { track: Track | null }) {
  const colors = useColors();
  const { resolvedMode } = useTheme();
  const uri = track?.coverUri || track?.artworkUrl || "";
  const [shown, setShown] = useState(uri);
  const fade = useRef(new Animated.Value(uri ? 1 : 0)).current;

  useEffect(() => {
    if (uri === shown) return;
    Animated.timing(fade, { toValue: 0, duration: 260, useNativeDriver: true }).start(() => {
      setShown(uri);
      Animated.timing(fade, { toValue: 1, duration: 480, useNativeDriver: true }).start();
    });
  }, [uri, shown, fade]);

  const dark = resolvedMode === "dark";
  if (!shown) return null;
  return (
    <Animated.View
      pointerEvents="none"
      aria-hidden
      style={{
        position: "absolute",
        top: -28,
        left: -28,
        right: -28,
        bottom: -28,
        borderRadius: radii.xl + 28,
        overflow: "hidden",
        opacity: fade.interpolate({ inputRange: [0, 1], outputRange: [0, 0.55] }),
      }}
    >
      <Image
        source={{ uri: shown }}
        blurRadius={42}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        resizeMode="cover"
      />
      {/* Veil keeps the card readable over bright artwork. */}
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: dark ? "rgba(0,0,0,0.42)" : colors.canvas,
          opacity: dark ? 1 : 0.55,
        }}
      />
    </Animated.View>
  );
}

function NowPlayingSection({ engine }: { engine: ReturnType<typeof usePlayerEngine> }) {
  const colors = useColors();
  const { nowPlaying, status, error, toggle, seek, advance } = engine;
  const prev = async () => {
    try {
      const { getMusicSource } = await import("./music/sources");
      await getMusicSource(nowPlaying?.source ?? "local").seekTo(0);
    } catch {
      // best effort
    }
  };
  return (
    <View style={{ position: "relative" }}>
      <AlbumGlow track={nowPlaying} />
      <SoftCard>
        <View style={{ alignItems: "center", gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <SoraAmbient
              video={status.playing ? "making_something" : "idle"}
              slot="music-dj"
              size={34}
            />
            <TText style={{ color: colors.muted, fontSize: 11.5, letterSpacing: 1 }}>
              {status.playing ? t("music.djWorking") : t("music.nowPlaying")}
            </TText>
          </View>
          <View style={{ marginVertical: 10 }}>
            <CoverArt track={nowPlaying} size={210} spinning={status.playing} />
          </View>
          <TText
            style={{ color: colors.text, fontSize: 19, fontWeight: "800", textAlign: "center" }}
          >
            {nowPlaying?.title ?? t("music.nothingPlaying")}
          </TText>
          {!!nowPlaying && (
            <TText style={{ color: colors.muted, fontSize: 13.5, textAlign: "center" }}>
              {nowPlaying.artist || t("music.source.local")}
              {nowPlaying.source === "apple-music" ? " · Apple Music" : ""}
            </TText>
          )}
        </View>
        <View style={{ marginTop: 14 }}>
          <ProgressBar
            position={status.position}
            duration={status.duration}
            onSeek={(s) => void seek(s)}
          />
        </View>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 26,
            marginTop: 10,
          }}
        >
          <ControlButton onPress={() => void prev()} label={t("music.prev")}>
            <SkipBack size={26} color={colors.text} strokeWidth={1.6} />
          </ControlButton>
          <ControlButton
            onPress={() => void toggle()}
            label={status.playing ? t("music.pause") : t("music.play")}
            primary
          >
            {status.playing ? (
              <Pause size={28} color={colors.card} fill={colors.card} strokeWidth={1.6} />
            ) : (
              <Play size={28} color={colors.card} fill={colors.card} strokeWidth={1.6} />
            )}
          </ControlButton>
          <ControlButton onPress={() => void advance()} label={t("music.skip")}>
            <SkipForward size={26} color={colors.text} strokeWidth={1.6} />
          </ControlButton>
        </View>
        {!!nowPlaying && (
          <View style={{ marginTop: 16 }}>
            <LyricsView track={nowPlaying} position={status.position} />
          </View>
        )}
        {!!error && (
          <View
            style={{
              marginTop: 12,
              padding: 10,
              borderRadius: radii.md,
              backgroundColor: colors.sky,
            }}
          >
            <TText style={{ color: colors.text, fontSize: 12.5 }}>{error}</TText>
          </View>
        )}
      </SoftCard>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Queue section
// ---------------------------------------------------------------------------

function QueueSection() {
  const colors = useColors();
  const mv = useMusicVersion();
  const [queue, setQueue] = useState<Track[]>([]);
  useEffect(() => {
    void musicStore.listQueue().then(setQueue);
  }, [mv]);
  if (queue.length === 0) return null;
  const row = (tr: Track, i: number) => (
    <StaggerIn key={tr.id} index={i}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 }}>
        <TText style={{ color: colors.muted, fontSize: 12, width: 20 }}>{i + 1}</TText>
        <View style={{ flex: 1 }}>
          <TText style={{ color: colors.text, fontSize: 14, fontWeight: "600" }} numberOfLines={1}>
            {tr.title}
          </TText>
          <TText style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>
            {tr.artist}
          </TText>
        </View>
        <PressableScale
          onPress={() => void musicStore.moveInQueue(tr.id, -1)}
          accessibilityRole="button"
          accessibilityLabel="up"
        >
          <ChevronUp size={18} color={colors.muted} />
        </PressableScale>
        <PressableScale
          onPress={() => void musicStore.moveInQueue(tr.id, 1)}
          accessibilityRole="button"
          accessibilityLabel="down"
        >
          <ChevronDown size={18} color={colors.muted} />
        </PressableScale>
        <PressableScale
          onPress={() => void musicStore.removeFromQueue(tr.id)}
          accessibilityRole="button"
          accessibilityLabel={t("music.remove")}
        >
          <X size={18} color={colors.muted} />
        </PressableScale>
      </View>
    </StaggerIn>
  );
  return (
    <SoftCard>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <ListMusic size={16} color={colors.muted} strokeWidth={1.6} />
        <TText style={{ color: colors.text, fontSize: 15, fontWeight: "700" }}>
          {t("music.queue")}
        </TText>
      </View>
      {queue.map(row)}
    </SoftCard>
  );
}

// ---------------------------------------------------------------------------
// Playlists + song rows + per-song action menu
// ---------------------------------------------------------------------------

type SongAction = "play" | "queue" | "ours" | "edit" | "delete";

function SongRow({
  track,
  index,
  isOurs,
  onAction,
}: {
  track: Track;
  index: number;
  isOurs: boolean;
  onAction: (a: SongAction, t: Track) => void;
}) {
  const colors = useColors();
  const mv = useMusicVersion();
  const [menu, setMenu] = useState(false);
  const [listenDates, setListenDates] = useState<number[]>([]);
  const art = track.coverUri || track.artworkUrl;

  useEffect(() => {
    void musicStore.getTogetherListenDates(track.id).then(setListenDates);
  }, [mv, track.id]);

  const listenLabel =
    listenDates.length > 0
      ? t("music.togetherListened", {
          date: `${new Date(listenDates[0]).getMonth() + 1}月${new Date(listenDates[0]).getDate()}日`,
        }) +
        (listenDates.length > 1 ? t("music.togetherListenedMore", { n: listenDates.length }) : "")
      : null;
  return (
    <StaggerIn index={index}>
      <View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 9 }}>
          <Pressable
            onPress={() => onAction("play", track)}
            style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }}
          >
            {art ? (
              <Image
                source={{ uri: art }}
                style={{ width: 44, height: 44, borderRadius: radii.sm }}
              />
            ) : (
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: radii.sm,
                  backgroundColor: colors.sky,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Music2 size={20} color={colors.muted} strokeWidth={1.5} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <TText
                style={{ color: colors.text, fontSize: 14.5, fontWeight: "600" }}
                numberOfLines={1}
              >
                {track.title}
              </TText>
              <TText style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>
                {track.artist}
                {track.source === "apple-music" ? " · Apple Music" : ""}
                {!track.audioUri && track.source === "local"
                  ? ` · ${t("music.noAudio").slice(0, 6)}…`
                  : ""}
                {listenLabel ? ` · ${listenLabel}` : ""}
              </TText>
            </View>
            {isOurs && <Heart size={15} color="#C15F3C" fill="#C15F3C" strokeWidth={1.8} />}
          </Pressable>
          <PressableScale
            onPress={() => setMenu(true)}
            accessibilityRole="button"
            accessibilityLabel={track.title}
          >
            <View style={{ padding: 6 }}>
              <MoreHorizontal size={18} color={colors.muted} strokeWidth={1.8} />
            </View>
          </PressableScale>
        </View>
        <Modal
          visible={menu}
          transparent
          animationType="fade"
          onRequestClose={() => setMenu(false)}
        >
          <Pressable
            style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.25)", justifyContent: "flex-end" }}
            onPress={() => setMenu(false)}
          >
            <Pressable
              onPress={() => {}}
              style={{
                backgroundColor: colors.card,
                borderTopLeftRadius: radii.xl,
                borderTopRightRadius: radii.xl,
                padding: 20,
                gap: 4,
              }}
            >
              <TText
                style={{ color: colors.text, fontSize: 15, fontWeight: "700", marginBottom: 8 }}
                numberOfLines={1}
              >
                {track.title}
              </TText>
              {(
                [
                  ["play", t("music.play")],
                  ["queue", t("music.addToQueue")],
                  ["ours", isOurs ? t("music.unmarkOurs") : t("music.markOurs")],
                  ["edit", t("music.edit")],
                  ["delete", t("music.delete")],
                ] as [SongAction, string][]
              ).map(([a, label]) => (
                <PressableScale
                  key={a}
                  onPress={() => {
                    setMenu(false);
                    onAction(a, track);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                >
                  <View
                    style={{
                      paddingVertical: 12,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    {a === "delete" ? (
                      <Trash2 size={17} color="#C15F3C" strokeWidth={1.6} />
                    ) : a === "ours" ? (
                      <Heart
                        size={17}
                        color={isOurs ? "#C15F3C" : colors.muted}
                        fill={isOurs ? "#C15F3C" : "none"}
                        strokeWidth={1.6}
                      />
                    ) : a === "queue" ? (
                      <ListPlus size={17} color={colors.muted} strokeWidth={1.6} />
                    ) : (
                      <Play size={17} color={colors.muted} strokeWidth={1.6} />
                    )}
                    <TText
                      style={{ color: a === "delete" ? "#C15F3C" : colors.text, fontSize: 14.5 }}
                    >
                      {label}
                    </TText>
                  </View>
                </PressableScale>
              ))}
              <View style={{ height: 12 }} />
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    </StaggerIn>
  );
}

function PlaylistSection({
  engine,
  onAdd,
}: {
  engine: ReturnType<typeof usePlayerEngine>;
  onAdd: () => void;
}) {
  const colors = useColors();
  const mv = useMusicVersion();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedId, setSelectedId] = useState<string>(SHARED_PLAYLIST_ID);
  const [songs, setSongs] = useState<Track[]>([]);
  const [oursIds, setOursIds] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  // Song being edited (P1-5): null = edit sheet closed.
  const [editingTrack, setEditingTrack] = useState<Track | null>(null);

  useEffect(() => {
    void (async () => {
      setPlaylists(await musicStore.listPlaylists());
      setSongs(await musicStore.listPlaylistTracks(selectedId));
      setOursIds(new Set((await musicStore.listPlaylistTracks(OURS_PLAYLIST_ID)).map((x) => x.id)));
    })();
  }, [mv, selectedId]);

  const onAction = async (a: SongAction, tr: Track) => {
    if (a === "play") await engine.playTrack(tr, selectedId);
    else if (a === "queue") await musicStore.enqueue(tr.id);
    else if (a === "ours") {
      if (oursIds.has(tr.id)) await musicStore.removeFromPlaylist(OURS_PLAYLIST_ID, tr.id);
      else await musicStore.addToPlaylist(OURS_PLAYLIST_ID, tr.id);
    } else if (a === "edit") {
      setEditingTrack(tr);
    } else if (a === "delete") {
      await musicStore.deleteTrack(tr.id);
    }
  };

  const create = async () => {
    const n = newName.trim();
    if (!n) return;
    const p = await musicStore.createPlaylist(n, "her");
    setNewName("");
    setCreating(false);
    setSelectedId(p.id);
  };

  return (
    <SoftCard>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <TText style={{ color: colors.text, fontSize: 15, fontWeight: "700", flex: 1 }}>
          {t("music.playlists")}
        </TText>
        <PressableScale
          onPress={onAdd}
          accessibilityRole="button"
          accessibilityLabel={t("music.addSong")}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: radii.lg,
              backgroundColor: colors.sky,
            }}
          >
            <Plus size={14} color={colors.text} strokeWidth={2} />
            <TText style={{ color: colors.text, fontSize: 12.5, fontWeight: "600" }}>
              {t("music.addSong")}
            </TText>
          </View>
        </PressableScale>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 6 }}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {playlists.map((p) => {
            const sel = p.id === selectedId;
            return (
              <PressableScale
                key={p.id}
                onPress={() => setSelectedId(p.id)}
                accessibilityRole="button"
                accessibilityLabel={playlistName(p)}
              >
                <View
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: radii.lg,
                    backgroundColor: sel ? colors.text : "transparent",
                    borderWidth: 1,
                    borderColor: sel ? colors.text : colors.line,
                  }}
                >
                  <TText
                    style={{
                      color: sel ? colors.card : colors.muted,
                      fontSize: 13,
                      fontWeight: sel ? "700" : "400",
                    }}
                  >
                    {playlistName(p)} · {p.trackIds.length}
                  </TText>
                </View>
              </PressableScale>
            );
          })}
          <PressableScale
            onPress={() => setCreating((x) => !x)}
            accessibilityRole="button"
            accessibilityLabel={t("music.playlist.create")}
          >
            <View
              style={{
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: radii.lg,
                borderWidth: 1,
                borderStyle: "dashed",
                borderColor: colors.line,
              }}
            >
              <TText style={{ color: colors.muted, fontSize: 13 }}>
                + {t("music.playlist.create")}
              </TText>
            </View>
          </PressableScale>
        </View>
      </ScrollView>
      {creating && (
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder={t("music.playlist.nameHint")}
            placeholderTextColor={colors.muted}
            style={{
              flex: 1,
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: radii.md,
              paddingHorizontal: 12,
              paddingVertical: 8,
              color: colors.text,
              fontSize: 14,
            }}
          />
          <PressableScale
            onPress={() => void create()}
            accessibilityRole="button"
            accessibilityLabel={t("music.playlist.create")}
          >
            <View
              style={{
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: radii.md,
                backgroundColor: colors.text,
              }}
            >
              <TText style={{ color: colors.card, fontSize: 13, fontWeight: "700" }}>
                {t("music.playlist.create")}
              </TText>
            </View>
          </PressableScale>
        </View>
      )}
      {songs.length === 0 ? (
        <View style={{ alignItems: "center", paddingVertical: 24 }}>
          <SoraAmbient video="idle" slot="music-dj" size={64} />
          <TText style={{ color: colors.muted, fontSize: 13, textAlign: "center", marginTop: 14 }}>
            {t("music.songs.empty")}
          </TText>
        </View>
      ) : (
        songs.map((tr, i) => (
          <SongRow
            key={tr.id}
            track={tr}
            index={i}
            isOurs={oursIds.has(tr.id)}
            onAction={(a, x) => void onAction(a, x)}
          />
        ))
      )}
      {editingTrack && <EditSongModal track={editingTrack} onClose={() => setEditingTrack(null)} />}
    </SoftCard>
  );
}

// ---------------------------------------------------------------------------
// Comments (NetEase-style, couple-adapted) + our memories
// ---------------------------------------------------------------------------

function CommentsSection({ trackId }: { trackId: string | null }) {
  const colors = useColors();
  const mv = useMusicVersion();
  const [comments, setComments] = useState<{ id: string; author: string; text: string }[]>([]);
  const [memories, setMemories] = useState<{ id: string; text: string }[]>([]);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!trackId) {
      setComments([]);
      setMemories([]);
      return;
    }
    void (async () => {
      setComments(await musicStore.listComments(trackId));
      setMemories(await musicStore.listMemoryNotes(trackId));
    })();
  }, [mv, trackId]);

  if (!trackId) return null;

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await musicStore.addComment(trackId, "her", text);
  };

  return (
    <SoftCard>
      <TText style={{ color: colors.text, fontSize: 15, fontWeight: "700", marginBottom: 8 }}>
        {t("music.comments")}
      </TText>
      {comments.length === 0 ? (
        <View style={{ alignItems: "center", paddingVertical: 12 }}>
          <SoraAmbient video="idle" slot="music-dj" size={48} />
          <TText style={{ color: colors.muted, fontSize: 13, marginTop: 10 }}>
            {t("music.comments.empty")}
          </TText>
        </View>
      ) : (
        comments.map((c) => (
          <View key={c.id} style={{ flexDirection: "row", gap: 10, paddingVertical: 8 }}>
            <View
              style={{
                width: 30,
                height: 30,
                borderRadius: radii.lg,
                backgroundColor: colors.sky,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <TText style={{ fontSize: 12, color: colors.muted }}>
                {c.author === "ai" ? "AI" : t("space.couple.herAvatar").slice(0, 1)}
              </TText>
            </View>
            <View style={{ flex: 1 }}>
              <TText style={{ color: colors.muted, fontSize: 11.5 }}>
                {c.author === "ai" ? t("space.couple.aiAvatar") : t("space.couple.herAvatar")}
              </TText>
              <TText style={{ color: colors.text, fontSize: 14, marginTop: 2 }}>{c.text}</TText>
            </View>
          </View>
        ))
      )}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={t("music.comments.hint")}
          placeholderTextColor={colors.muted}
          style={{
            flex: 1,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radii.md,
            paddingHorizontal: 12,
            paddingVertical: 9,
            color: colors.text,
            fontSize: 14,
          }}
        />
        <PressableScale
          onPress={() => void send()}
          accessibilityRole="button"
          accessibilityLabel={t("music.comments")}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: radii.lg,
              backgroundColor: colors.text,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Send size={17} color={colors.card} strokeWidth={1.8} />
          </View>
        </PressableScale>
      </View>
      {memories.length > 0 && (
        <View style={{ marginTop: 14 }}>
          <TText style={{ color: colors.text, fontSize: 13.5, fontWeight: "700", marginBottom: 6 }}>
            {t("music.memories")}
          </TText>
          {memories.map((m) => (
            <TText key={m.id} style={{ color: colors.muted, fontSize: 12.5, marginBottom: 4 }}>
              · {m.text}
            </TText>
          ))}
        </View>
      )}
    </SoftCard>
  );
}

// ---------------------------------------------------------------------------
// Add song: local form + Apple Music catalog search
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Edit song (P1-5): the "no audio" error used to point at a "song info"
// feature that didn't exist. Now it does — title/artist/audio, wired to
// musicStore.updateTrack.
// ---------------------------------------------------------------------------

function EditSongModal({ track, onClose }: { track: Track; onClose: () => void }) {
  const colors = useColors();
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist);
  const [audioUri, setAudioUri] = useState(track.audioUri);
  const [busy, setBusy] = useState(false);

  const pickAudio = async () => {
    try {
      const DocPicker = await import("expo-document-picker");
      const res = await DocPicker.getDocumentAsync({ type: "audio/*", copyToCacheDirectory: true });
      if (!res.canceled && res.assets[0]) setAudioUri(res.assets[0].uri);
    } catch {
      // picker unavailable — she can paste a URI instead
    }
  };

  const save = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await musicStore.updateTrack(track.id, {
        title: title.trim(),
        artist: artist.trim(),
        audioUri: audioUri.trim(),
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const input = (value: string, onChange: (s: string) => void, hint: string) => (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={hint}
      placeholderTextColor={colors.muted}
      style={{
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radii.md,
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: colors.text,
        fontSize: 14,
      }}
    />
  );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.25)", justifyContent: "flex-end" }}
        onPress={onClose}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: colors.canvas,
            borderTopLeftRadius: radii.xl,
            borderTopRightRadius: radii.xl,
            maxHeight: "88%",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", padding: 18, gap: 10 }}>
            <TText style={{ color: colors.text, fontSize: 16, fontWeight: "800", flex: 1 }}>
              {t("music.editSong")}
            </TText>
            <PressableScale onPress={onClose} accessibilityRole="button" accessibilityLabel="close">
              <X size={20} color={colors.muted} />
            </PressableScale>
          </View>
          <View style={{ paddingHorizontal: 18, paddingBottom: 24, gap: 10 }}>
            {input(title, setTitle, t("music.song.titleHint"))}
            {input(artist, setArtist, t("music.song.artistHint"))}
            {track.source === "local" && (
              <>
                {input(audioUri, setAudioUri, t("music.song.audioHint"))}
                <PressableScale
                  onPress={() => void pickAudio()}
                  accessibilityRole="button"
                  accessibilityLabel={t("music.song.audioHint")}
                >
                  <View
                    style={{
                      borderWidth: 1,
                      borderColor: colors.line,
                      borderRadius: radii.md,
                      paddingVertical: 10,
                      alignItems: "center",
                    }}
                  >
                    <TText style={{ color: colors.muted, fontSize: 13 }}>
                      {t("music.song.pickAudio")}
                    </TText>
                  </View>
                </PressableScale>
              </>
            )}
            <PressableScale
              onPress={() => void save()}
              accessibilityRole="button"
              accessibilityLabel={t("music.save")}
            >
              <View
                style={{
                  backgroundColor: colors.text,
                  borderRadius: radii.lg,
                  paddingVertical: 12,
                  alignItems: "center",
                  opacity: !title.trim() || busy ? 0.5 : 1,
                }}
              >
                <TText style={{ color: colors.canvas, fontSize: 14, fontWeight: "700" }}>
                  {t("music.save")}
                </TText>
              </View>
            </PressableScale>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function AddSongModal({
  visible,
  initialTab,
  onClose,
}: {
  visible: boolean;
  initialTab: "local" | "apple";
  onClose: () => void;
}) {
  const colors = useColors();
  const [tab, setTab] = useState<"local" | "apple">(initialTab);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [album, setAlbum] = useState("");
  const [audioUri, setAudioUri] = useState("");
  const [coverUri, setCoverUri] = useState("");
  const [lrc, setLrc] = useState("");
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistId, setPlaylistId] = useState<string>(SHARED_PLAYLIST_ID);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<import("./music/sources").SourceTrack[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [appleState, setAppleState] = useState("unknown");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setTab(initialTab);
    void musicStore.listPlaylists().then(setPlaylists);
    void import("./music/sources").then(async ({ getMusicSource }) => {
      try {
        setAppleState(await getMusicSource("apple-music").getAuthState());
      } catch {
        setAppleState("unavailable");
      }
    });
  }, [visible, initialTab]);

  const reset = () => {
    setTitle("");
    setArtist("");
    setAlbum("");
    setAudioUri("");
    setCoverUri("");
    setLrc("");
    setQuery("");
    setResults([]);
    setSearchError(null);
  };

  const pickAudio = async () => {
    try {
      const DocPicker = await import("expo-document-picker");
      const res = await DocPicker.getDocumentAsync({ type: "audio/*", copyToCacheDirectory: true });
      if (!res.canceled && res.assets[0]) setAudioUri(res.assets[0].uri);
    } catch {
      // picker unavailable — she can paste a URI instead
    }
  };

  const pickCover = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: "images",
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (!res.canceled && res.assets[0]) setCoverUri(res.assets[0].uri);
    } catch {
      // picker cancelled
    }
  };

  const submitLocal = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const tr = await musicStore.addTrack({
        title: title.trim(),
        artist: artist.trim(),
        album: album.trim(),
        audioUri: audioUri.trim(),
        coverUri,
        lyricsLrc: lrc.trim() || undefined,
        addedBy: "her",
      });
      await musicStore.addToPlaylist(playlistId, tr.id);
      reset();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const doAppleSearch = async () => {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    setSearchError(null);
    try {
      const { getMusicSource } = await import("./music/sources");
      const hits = await getMusicSource("apple-music").search(q, 10);
      setResults(hits);
      if (hits.length === 0) setSearchError(t("music.source.noResults"));
    } catch (e) {
      setResults([]);
      const msg = e instanceof Error ? e.message : "";
      // Map known native-bridge failures to the auth hints she already sees.
      if (/not authorized/i.test(msg)) setSearchError(t("music.auth.needAuth"));
      else if (/not available/i.test(msg)) setSearchError(t("music.auth.unavailable"));
      else setSearchError(t("music.source.searchFailed"));
    } finally {
      setSearching(false);
    }
  };

  const addAppleTrack = async (hit: import("./music/sources").SourceTrack) => {
    if (busy) return;
    setBusy(true);
    try {
      const tr = await musicStore.addTrack({
        title: hit.title,
        artist: hit.artist,
        source: "apple-music",
        sourceRef: hit.id,
        artworkUrl: hit.artworkUrl,
        addedBy: "her",
      });
      await musicStore.addToPlaylist(playlistId, tr.id);
      onClose();
      reset();
    } finally {
      setBusy(false);
    }
  };

  const input = (
    value: string,
    onChange: (s: string) => void,
    hint: string,
    multiline?: boolean,
  ) => (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={hint}
      placeholderTextColor={colors.muted}
      multiline={multiline}
      numberOfLines={multiline ? 4 : 1}
      style={{
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radii.md,
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: colors.text,
        fontSize: 14,
        textAlignVertical: multiline ? "top" : "center",
      }}
    />
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.25)", justifyContent: "flex-end" }}
        onPress={onClose}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: colors.canvas,
            borderTopLeftRadius: radii.xl,
            borderTopRightRadius: radii.xl,
            maxHeight: "88%",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", padding: 18, gap: 10 }}>
            <TText style={{ color: colors.text, fontSize: 16, fontWeight: "800", flex: 1 }}>
              {t("music.addSong")}
            </TText>
            <PressableScale onPress={onClose} accessibilityRole="button" accessibilityLabel="close">
              <X size={20} color={colors.muted} />
            </PressableScale>
          </View>
          <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 18, marginBottom: 12 }}>
            {(
              [
                ["local", t("music.source.local")],
                ["apple", t("music.source.appleMusic")],
              ] as ["local" | "apple", string][]
            ).map(([id, label]) => (
              <PressableScale
                key={id}
                onPress={() => setTab(id)}
                accessibilityRole="button"
                accessibilityLabel={label}
              >
                <View
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 8,
                    borderRadius: radii.lg,
                    backgroundColor: tab === id ? colors.text : "transparent",
                    borderWidth: 1,
                    borderColor: tab === id ? colors.text : colors.line,
                  }}
                >
                  <TText
                    style={{
                      color: tab === id ? colors.card : colors.muted,
                      fontSize: 13,
                      fontWeight: tab === id ? "700" : "400",
                    }}
                  >
                    {label}
                  </TText>
                </View>
              </PressableScale>
            ))}
          </View>
          <ScrollView
            style={{ paddingHorizontal: 18 }}
            contentContainerStyle={{ gap: 10, paddingBottom: 30 }}
          >
            {tab === "local" ? (
              <>
                {input(title, setTitle, t("music.song.titleHint"))}
                {input(artist, setArtist, t("music.song.artistHint"))}
                {input(album, setAlbum, t("music.song.albumHint"))}
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    {input(audioUri, setAudioUri, t("music.song.audioHint"))}
                  </View>
                  <PressableScale
                    onPress={() => void pickAudio()}
                    accessibilityRole="button"
                    accessibilityLabel={t("music.pickAudio")}
                  >
                    <View
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        borderRadius: radii.md,
                        borderWidth: 1,
                        borderColor: colors.line,
                      }}
                    >
                      <TText style={{ color: colors.text, fontSize: 13 }}>
                        {t("music.pickAudio")}
                      </TText>
                    </View>
                  </PressableScale>
                </View>
                <PressableScale
                  onPress={() => void pickCover()}
                  accessibilityRole="button"
                  accessibilityLabel={t("music.pickCover")}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      padding: 10,
                      borderRadius: radii.md,
                      borderWidth: 1,
                      borderColor: colors.line,
                    }}
                  >
                    {coverUri ? (
                      <Image
                        source={{ uri: coverUri }}
                        style={{ width: 40, height: 40, borderRadius: radii.sm }}
                      />
                    ) : (
                      <View
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: radii.sm,
                          backgroundColor: colors.sky,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Music2 size={18} color={colors.muted} />
                      </View>
                    )}
                    <TText style={{ color: colors.muted, fontSize: 13 }}>
                      {t("music.song.coverHint")}
                    </TText>
                  </View>
                </PressableScale>
                {input(lrc, setLrc, t("music.song.lyricsHint"), true)}
                <TText style={{ color: colors.muted, fontSize: 12 }}>{t("music.playlists")}</TText>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {playlists.map((p) => (
                      <PressableScale
                        key={p.id}
                        onPress={() => setPlaylistId(p.id)}
                        accessibilityRole="button"
                        accessibilityLabel={playlistName(p)}
                      >
                        <View
                          style={{
                            paddingHorizontal: 12,
                            paddingVertical: 7,
                            borderRadius: radii.lg,
                            backgroundColor: playlistId === p.id ? colors.text : "transparent",
                            borderWidth: 1,
                            borderColor: playlistId === p.id ? colors.text : colors.line,
                          }}
                        >
                          <TText
                            style={{
                              color: playlistId === p.id ? colors.card : colors.muted,
                              fontSize: 12.5,
                            }}
                          >
                            {playlistName(p)}
                          </TText>
                        </View>
                      </PressableScale>
                    ))}
                  </View>
                </ScrollView>
                <PressableScale
                  onPress={() => void submitLocal()}
                  accessibilityRole="button"
                  accessibilityLabel={t("music.addSong")}
                >
                  <View
                    style={{
                      paddingVertical: 13,
                      borderRadius: radii.md,
                      backgroundColor: colors.text,
                      alignItems: "center",
                      opacity: title.trim() ? 1 : 0.5,
                    }}
                  >
                    <TText style={{ color: colors.card, fontSize: 14.5, fontWeight: "700" }}>
                      {t("music.addSong")}
                    </TText>
                  </View>
                </PressableScale>
              </>
            ) : appleState !== "authorized" ? (
              <View style={{ gap: 8, paddingVertical: 12 }}>
                <TText style={{ color: colors.text, fontSize: 14, textAlign: "center" }}>
                  {authStateMessage(appleState)}
                </TText>
                <TText style={{ color: colors.muted, fontSize: 12.5, textAlign: "center" }}>
                  {t("music.auth.needAuth")}
                </TText>
              </View>
            ) : (
              <>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    {input(query, setQuery, t("music.source.searchHint"))}
                  </View>
                  <PressableScale
                    onPress={() => void doAppleSearch()}
                    accessibilityRole="button"
                    accessibilityLabel={t("music.source.searchHint")}
                  >
                    <View
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        borderRadius: radii.md,
                        backgroundColor: colors.text,
                      }}
                    >
                      {searching ? (
                        <TText style={{ color: colors.card, fontSize: 13 }}>…</TText>
                      ) : (
                        <Search size={16} color={colors.card} strokeWidth={2} />
                      )}
                    </View>
                  </PressableScale>
                </View>
                {!!searchError && (
                  <TText
                    style={{
                      color: colors.danger,
                      fontSize: 12.5,
                      textAlign: "center",
                      paddingTop: 6,
                    }}
                  >
                    {searchError}
                  </TText>
                )}
                {results.map((hit) => (
                  <View
                    key={hit.id}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      paddingVertical: 8,
                    }}
                  >
                    {hit.artworkUrl ? (
                      <Image
                        source={{ uri: hit.artworkUrl }}
                        style={{ width: 44, height: 44, borderRadius: radii.sm }}
                      />
                    ) : (
                      <View
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: radii.sm,
                          backgroundColor: colors.sky,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Music2 size={18} color={colors.muted} />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <TText
                        style={{ color: colors.text, fontSize: 14, fontWeight: "600" }}
                        numberOfLines={1}
                      >
                        {hit.title}
                      </TText>
                      <TText style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>
                        {hit.artist}
                      </TText>
                    </View>
                    <PressableScale
                      onPress={() => void addAppleTrack(hit)}
                      accessibilityRole="button"
                      accessibilityLabel={t("music.addSong")}
                    >
                      <View
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 7,
                          borderRadius: radii.md,
                          backgroundColor: colors.text,
                        }}
                      >
                        <TText style={{ color: colors.card, fontSize: 12.5, fontWeight: "700" }}>
                          {t("music.addSong")}
                        </TText>
                      </View>
                    </PressableScale>
                  </View>
                ))}
              </>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Page: assembled music room (rendered as an Our Space card page)
// ---------------------------------------------------------------------------

export function MusicRoomPage() {
  const engine = usePlayerEngine();
  const [addVisible, setAddVisible] = useState(false);
  const [addTab, setAddTab] = useState<"local" | "apple">("local");
  // The desktop pet bops while music plays.
  useEffect(() => {
    petActivity.setMusicPlaying(engine.status.playing);
  }, [engine.status.playing]);
  return (
    <View style={{ gap: 14 }}>
      <FadeIn>
        <TogetherBar together={engine.together} onToggle={() => void engine.toggleTogether()} />
      </FadeIn>
      <SourcePicker
        onAppleSearch={() => {
          setAddTab("apple");
          setAddVisible(true);
        }}
      />
      <NowPlayingSection engine={engine} />
      <QueueSection />
      <PlaylistSection
        engine={engine}
        onAdd={() => {
          setAddTab("local");
          setAddVisible(true);
        }}
      />
      <CommentsSection trackId={engine.nowPlaying?.id ?? null} />
      <AddSongModal visible={addVisible} initialTab={addTab} onClose={() => setAddVisible(false)} />
    </View>
  );
}
