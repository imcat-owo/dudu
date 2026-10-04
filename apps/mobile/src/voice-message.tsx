import {
  type AudioPlayer,
  type AudioStatus,
  createAudioPlayer,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { Mic, Pause, Play } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { TText } from "./font";
import {
  encodeVoiceMessage,
  extractVoiceMessage,
  extractVoiceMessageStrict,
  parseVoiceMessage,
  type VoiceMessage,
  type VoiceMessageHit,
} from "./message-envelope";
import { radii } from "./theme/radii";
import { useTheme } from "./theme/ThemeContext";
import { useColors, useStyles } from "./ui";
import { StartSequence } from "./voice/start-sequence";

export type { VoiceMessage, VoiceMessageHit };
export {
  encodeVoiceMessage,
  extractVoiceMessage,
  extractVoiceMessageStrict,
  parseVoiceMessage,
};

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

async function createPlayer(uri: string): Promise<AudioPlayer> {
  await setAudioModeAsync({ playsInSilentMode: true });
  return createAudioPlayer(uri, { updateInterval: 200 });
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
  const playerRef = useRef<AudioPlayer | null>(null);
  const statusSubRef = useRef<{ remove(): void } | null>(null);
  const finishedRef = useRef(false);
  const bars = useRef(
    waveformBars(voice.uri).map((height, index) => ({ height, index, id: `wave-${index}` })),
  ).current;
  const duration = Math.max(1, voice.duration);

  useEffect(() => {
    return () => {
      statusSubRef.current?.remove();
      statusSubRef.current = null;
      try {
        playerRef.current?.remove();
      } catch {
        // already released
      }
      playerRef.current = null;
    };
  }, []);

  async function toggle() {
    setError("");
    try {
      if (!playerRef.current) {
        const player = await createPlayer(voice.uri);
        playerRef.current = player;
        statusSubRef.current = player.addListener("playbackStatusUpdate", (status: AudioStatus) => {
          if (!status.isLoaded) return;
          setPlaying(status.playing);
          setPosition(status.currentTime);
          if (status.didJustFinish) {
            setPlaying(false);
            setPosition(0);
            finishedRef.current = true;
          }
        });
      }
      const player = playerRef.current;
      if (player.playing) {
        player.pause();
        setPlaying(false);
      } else {
        // expo-audio stays paused at the end instead of auto-rewinding —
        // seek back to 0 before replaying a finished message.
        if (finishedRef.current) {
          finishedRef.current = false;
          await player.seekTo(0);
        }
        player.play();
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
            borderRadius: radii.lg,
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
                  borderRadius: radii.xs,
                  backgroundColor: bubble.fg,
                  opacity: bar.index < playedBars ? 1 : 0.25,
                }}
              />
            ))}
          </View>
          <TText style={[s.small, { color: bubble.fg, opacity: 0.75 }]}>
            {formatDuration(playing || position > 0 ? remaining : duration)}
          </TText>
        </View>
      </View>
      {!!error && <TText style={[s.small, { color: colors.danger, marginTop: 6 }]}>{error}</TText>}
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
  // P3-2: slide-up-to-cancel — track the finger's vertical travel; sliding
  // up past the threshold arms cancel, and release discards the recording.
  const [cancelArmed, setCancelArmed] = useState(false);
  const touchStartY = useRef<number | null>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  // P1-8: quick-tap race guard — a stop landing mid-start must abort the
  // start instead of leaving the mic hot with no stop coming.
  const startSeqRef = useRef<StartSequence | null>(null);
  if (!startSeqRef.current) startSeqRef.current = new StartSequence();
  const startSeq = startSeqRef.current;

  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function startRecording() {
    const token = startSeq.begin();
    // True when a stop landed while this start was awaiting something.
    const aborted = () => startSeq.isCancelled(token);
    // Never leave the mic armed after an aborted start.
    const releaseAudioMode = () =>
      setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {
        // best effort
      });
    setHint("");
    try {
      const { status } = await requestRecordingPermissionsAsync();
      if (aborted()) return;
      if (status !== "granted") {
        setHint("需要麦克风权限才能录音");
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      if (aborted()) {
        await releaseAudioMode();
        return;
      }
      await recorder.prepareToRecordAsync();
      if (aborted()) {
        await releaseAudioMode();
        return;
      }
      recorder.record();
      startTimeRef.current = Date.now();
      setSeconds(0);
      setCancelArmed(false);
      touchStartY.current = null;
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
    // P1-8: invalidate any in-flight startRecording FIRST, so a quick tap
    // (press-out landing mid-start) aborts the start instead of the start
    // continuing into record() after this early return.
    startSeq.cancel();
    clearTimer();
    setRecording(false);
    if (!recorder.isRecording) {
      setSeconds(0);
      return;
    }
    try {
      await recorder.stop();
      const uri = recorder.uri;
      // Use elapsed wall-clock time; proven reliable, kept from the expo-av version.
      const duration = Math.max(0, Math.round((Date.now() - startTimeRef.current) / 1000));
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
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
  // The useAudioRecorder hook disposes the recorder itself.
  useEffect(() => {
    return () => {
      // P1-8: a start that outlives unmount must not call record() afterwards.
      startSeqRef.current?.cancel();
      clearTimer();
      try {
        if (recorder.isRecording) void recorder.stop().catch(() => {});
      } catch {
        // recorder already disposed by the hook
      }
    };
  }, [recorder]);

  function formatTimer(totalSeconds: number): string {
    const m = Math.floor(totalSeconds / 60);
    const sec = totalSeconds % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  return (
    <View
      style={{ alignItems: "center" }}
      // P3-2: slide up while holding to cancel. pageY travel is device
      // pixels — 60 is comfortably past a wobble, well within a swipe.
      onTouchStart={(e) => {
        touchStartY.current = e.nativeEvent.pageY;
      }}
      onTouchMove={(e) => {
        if (!recording || touchStartY.current == null) return;
        setCancelArmed(touchStartY.current - e.nativeEvent.pageY > 60);
      }}
    >
      {!!hint && !recording && (
        <TText style={[s.small, { color: colors.danger, marginBottom: 4, textAlign: "center" }]}>
          {hint}
        </TText>
      )}
      {recording && (
        <View
          style={{
            position: "absolute",
            bottom: 52,
            backgroundColor: "rgba(0,0,0,0.75)",
            borderRadius: radii.md,
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
                borderRadius: radii.xs,
                backgroundColor: "#FF3B30",
              }}
            />
            <TText style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "600" }}>
              {formatTimer(seconds)}
            </TText>
          </View>
          <TText style={{ color: "#FFFFFF", fontSize: 12, marginTop: 4 }}>
            {cancelArmed ? "松开取消" : "松开发送 · 上滑取消"}
          </TText>
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={recording ? (cancelArmed ? "松开取消语音" : "松开发送语音") : "按住说话"}
        disabled={disabled}
        onPressIn={() => void startRecording()}
        onPressOut={() => void stopRecording(cancelArmed)}
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          borderRadius: radii.xl,
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
