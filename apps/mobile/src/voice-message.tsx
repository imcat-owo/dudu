import { Audio } from "expo-av";
import { Mic, Pause, Play } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "./theme/ThemeContext";
import { useColors, useStyles } from "./ui";

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
export function VoiceBubble({ voice, user }: { voice: VoiceMessage; user: boolean }) {
  const colors = useColors();
  const s = useStyles();
  const { tokens } = useTheme();
  // Same surface tokens as text bubbles — a user's voice and text messages
  // must render in the same color (review P1, 2026-10-03).
  const bubble = user ? tokens.userBubble : tokens.aiBubble;
  const radius = bubble.radius ?? 16;
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0); // seconds
  const [error, setError] = useState("");
  const soundRef = useRef<SoundLike | null>(null);
  const bars = useRef(
    waveformBars(voice.uri).map((height, index) => ({ height, index, id: `wave-${index}` })),
  ).current;
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
      setError(e instanceof Error ? e.message : "无法播放音频。");
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
        paddingVertical: 9,
        borderRadius: radius,
        borderBottomRightRadius: user ? 6 : radius,
        borderBottomLeftRadius: user ? radius : 6,
        backgroundColor: bubble.bg,
        minWidth: 180,
        maxWidth: 260,
      }}
    >
      <View style={[s.row, { gap: 10 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playing ? "暂停语音" : "播放语音"}
          onPress={() => void toggle()}
          style={{
            width: 38,
            height: 38,
            borderRadius: 19,
            backgroundColor: bubble.fg,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {playing ? (
            <Pause size={17} color={bubble.bg} fill={bubble.bg} />
          ) : (
            <Play size={17} color={bubble.bg} fill={bubble.bg} />
          )}
        </Pressable>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={[s.row, { gap: 2, height: 22, alignItems: "flex-end" }]}>
            {bars.map((bar) => (
              <View
                key={bar.id}
                style={{
                  flex: 1,
                  height: 6 + bar.height * 16,
                  borderRadius: 2,
                  backgroundColor: bubble.fg,
                  opacity: bar.index < playedBars ? 1 : 0.25,
                }}
              />
            ))}
          </View>
          <Text style={[s.small, { color: bubble.fg, opacity: 0.75 }]}>
            {formatDuration(playing || position > 0 ? remaining : duration)}
          </Text>
        </View>
      </View>
      {!!error && <Text style={[s.small, { color: colors.danger, marginTop: 6 }]}>{error}</Text>}
    </View>
  );
}

/**
 * WeChat-style hold-to-record voice message button.
 * Press and hold to record, release to send.
 * Calls onRecorded(uri, durationSeconds) when a valid recording finishes.
 * All user-facing strings are in Simplified Chinese.
 */
export function VoiceRecorderButton({
  onRecorded,
  disabled,
}: {
  onRecorded: (uri: string, duration: number) => void;
  disabled?: boolean;
}) {
  const colors = useColors();
  const s = useStyles();
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [hint, setHint] = useState("");
  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function startRecording() {
    setHint("");
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== "granted") {
        setHint("需要麦克风权限才能录音");
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await rec.startAsync();
      recordingRef.current = rec;
      startTimeRef.current = Date.now();
      setSeconds(0);
      setRecording(true);
      timerRef.current = setInterval(() => {
        setSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 500);
    } catch (e) {
      setHint(e instanceof Error ? e.message : "录音启动失败");
      setRecording(false);
    }
  }

  async function stopRecording(cancelled: boolean) {
    clearTimer();
    const rec = recordingRef.current;
    recordingRef.current = null;
    setRecording(false);
    if (!rec) {
      setSeconds(0);
      return;
    }
    try {
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      // Use elapsed wall-clock time; getStatusAsync is unreliable after unload.
      const duration = Math.max(0, Math.round((Date.now() - startTimeRef.current) / 1000));
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
      setSeconds(0);
      if (cancelled || !uri) return;
      if (duration < 1) {
        setHint("录音太短");
        return;
      }
      setHint("");
      onRecorded(uri, duration);
    } catch (e) {
      setHint(e instanceof Error ? e.message : "录音保存失败");
      setSeconds(0);
    }
  }

  // Cleanup on unmount: stop any in-progress recording without sending.
  useEffect(() => {
    return () => {
      clearTimer();
      const rec = recordingRef.current;
      recordingRef.current = null;
      if (rec) {
        void rec.stopAndUnloadAsync().catch(() => {});
      }
    };
  }, []);

  function formatTimer(totalSeconds: number): string {
    const m = Math.floor(totalSeconds / 60);
    const sec = totalSeconds % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  return (
    <View style={{ alignItems: "center" }}>
      {!!hint && !recording && (
        <Text style={[s.small, { color: colors.danger, marginBottom: 4, textAlign: "center" }]}>
          {hint}
        </Text>
      )}
      {recording && (
        <View
          style={{
            position: "absolute",
            bottom: 52,
            backgroundColor: "rgba(0,0,0,0.75)",
            borderRadius: 12,
            paddingHorizontal: 16,
            paddingVertical: 10,
            alignItems: "center",
            zIndex: 10,
          }}
        >
          <View style={[s.row, { gap: 8, alignItems: "center" }]}>
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: "#FF3B30",
              }}
            />
            <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "600" }}>
              {formatTimer(seconds)}
            </Text>
          </View>
          <Text style={{ color: "#FFFFFF", fontSize: 12, marginTop: 4 }}>松开发送</Text>
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={recording ? "松开发送语音" : "按住说话"}
        disabled={disabled}
        onPressIn={() => void startRecording()}
        onPressOut={() => void stopRecording(false)}
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          borderRadius: 24,
          backgroundColor: recording ? "#FF3B30" : pressed ? colors.sky : "transparent",
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.4 : 1,
        })}
      >
        <Mic size={22} color={recording ? "#FFFFFF" : colors.text} strokeWidth={1.8} />
      </Pressable>
    </View>
  );
}
