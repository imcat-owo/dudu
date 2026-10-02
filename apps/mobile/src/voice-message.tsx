import { Audio } from "expo-av";
import { Pause, Play } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { colors, s } from "./ui";

export type VoiceMessage = {
  uri: string;
  duration: number; // seconds
};

/**
 * Detect a voice message encoded in message content.
 * Convention: {"type":"voice_message","uri":"...","duration":12}
 */
export function parseVoiceMessage(content: string): VoiceMessage | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as Record<string, unknown>).type === "voice_message" &&
      typeof (parsed as Record<string, unknown>).uri === "string" &&
      typeof (parsed as Record<string, unknown>).duration === "number"
    ) {
      const p = parsed as { uri: string; duration: number };
      if (p.uri && p.duration >= 0) return { uri: p.uri, duration: p.duration };
    }
  } catch {
    // not JSON — not a voice message
  }
  return null;
}

export function encodeVoiceMessage(uri: string, duration: number): string {
  return JSON.stringify({ type: "voice_message", uri, duration });
}

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const sec = Math.floor(totalSeconds % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// Deterministic pseudo-waveform so the bubble looks like WeChat/QQ voice.
function waveformBars(uri: string, count = 24): number[] {
  let seed = 0;
  for (let i = 0; i < uri.length; i++) seed = (seed * 31 + uri.charCodeAt(i)) >>> 0;
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    bars.push(0.25 + ((seed % 100) / 100) * 0.75);
  }
  return bars;
}

type SoundLike = {
  playAsync: () => Promise<unknown>;
  pauseAsync: () => Promise<unknown>;
  unloadAsync: () => Promise<unknown>;
  setOnPlaybackStatusUpdate: (cb: (status: unknown) => void) => void;
  getStatusAsync: () => Promise<unknown>;
};

async function createSound(uri: string): Promise<SoundLike> {
  await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
  const { sound } = await Audio.Sound.createAsync(
    { uri },
    { shouldPlay: false, progressUpdateIntervalMillis: 200 },
  );
  return sound as unknown as SoundLike;
}

/**
 * WeChat/QQ-style voice message bubble. Plays an audio file, shows a
 * play/pause button, duration, and a waveform progress bar.
 */
export function VoiceBubble({
  voice,
  user,
}: {
  voice: VoiceMessage;
  user: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0); // seconds
  const [error, setError] = useState("");
  const soundRef = useRef<SoundLike | null>(null);
  const bars = useRef(waveformBars(voice.uri)).current;
  const duration = Math.max(1, voice.duration);

  useEffect(() => {
    return () => {
      void soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
    };
  }, []);

  async function toggle() {
    setError("");
    try {
      if (!soundRef.current) {
        soundRef.current = await createSound(voice.uri);
        soundRef.current.setOnPlaybackStatusUpdate((status) => {
          const st = status as {
            isLoaded?: boolean;
            isPlaying?: boolean;
            positionMillis?: number;
            didJustFinish?: boolean;
          };
          if (!st.isLoaded) return;
          setPlaying(!!st.isPlaying);
          setPosition((st.positionMillis ?? 0) / 1000);
          if (st.didJustFinish) {
            setPlaying(false);
            setPosition(0);
          }
        });
      }
      const status = (await soundRef.current.getStatusAsync()) as {
        isLoaded?: boolean;
        isPlaying?: boolean;
      };
      if (status.isPlaying) {
        await soundRef.current.pauseAsync();
        setPlaying(false);
      } else {
        await soundRef.current.playAsync();
        setPlaying(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not play audio.");
      setPlaying(false);
    }
  }

  const progress = Math.min(1, position / duration);
  const playedBars = Math.floor(progress * bars.length);
  const remaining = Math.max(0, duration - position);

  return (
    <View
      style={{
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 22,
        borderBottomRightRadius: user ? 7 : 22,
        borderBottomLeftRadius: user ? 22 : 7,
        backgroundColor: user ? colors.blue : "#EEEEF0",
        minWidth: 180,
        maxWidth: 260,
      }}
    >
      <View style={[s.row, { gap: 10 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playing ? "Pause voice message" : "Play voice message"}
          onPress={() => void toggle()}
          style={{
            width: 38,
            height: 38,
            borderRadius: 19,
            backgroundColor: user ? "#FFFFFF" : colors.blue,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {playing ? (
            <Pause size={17} color={colors.text} fill={colors.text} />
          ) : (
            <Play size={17} color={colors.text} fill={colors.text} />
          )}
        </Pressable>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={[s.row, { gap: 2, height: 22, alignItems: "flex-end" }]}>
            {bars.map((height, i) => (
              <View
                key={i}
                style={{
                  flex: 1,
                  height: 6 + height * 16,
                  borderRadius: 2,
                  backgroundColor: i < playedBars ? colors.blueDark : "rgba(20,40,60,0.22)",
                }}
              />
            ))}
          </View>
          <Text style={[s.small, { color: colors.muted }]}>
            {formatDuration(playing || position > 0 ? remaining : duration)}
          </Text>
        </View>
      </View>
      {!!error && (
        <Text style={[s.small, { color: colors.danger, marginTop: 6 }]}>{error}</Text>
      )}
    </View>
  );
}
