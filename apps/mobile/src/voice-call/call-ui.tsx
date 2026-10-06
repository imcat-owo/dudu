/**
 * Voice call UI: active call screen + incoming ring overlay + controller.
 *
 * The controller owns the expo-audio recorders/players (hooks) and builds
 * the MicAdapter/SpeakerAdapter around them; the PURE VoiceCallSession
 * (session.ts) drives the conversation. No audio code in the session —
 * that's why the whole loop is node-testable.
 *
 * Honest notes:
 * - No speakerphone toggle: expo-audio exposes no output-route API, so a
 *   toggle would be a dead button (her rule). iOS routes playAndRecord to
 *   the earpiece like a phone call — correct behavior for a call.
 * - Waveform is the live mic metering (dB), not a fake animation.
 */
import {
  type AudioPlayer,
  createAudioPlayer,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { Mic, MicOff, PhoneOff } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { checkAudioPermission, requestAudioPermission } from "../device-permissions";
import { type StringKey, t } from "../i18n";
import type { Persona } from "../persona/types";
import { useColors } from "../ui";
import { createRingNotifier, proposalStore } from "./instances";
import { acceptProposal, declineProposal } from "./propose";
import { type MicAdapter, type SpeakerAdapter, VoiceCallSession } from "./session";
import type { CallPhase, CallStats, CallTranscriptEntry, TurnState } from "./types";

/* ---------------- waveform (live metering, not decoration) ---------------- */

function Waveform({ levelDb, color }: { levelDb: number; color: string }) {
  // metering dB is negative; map -60..-10 → 0..1
  const v = Math.max(0, Math.min(1, (levelDb + 60) / 50));
  // Static bar slots with stable ids (not index keys).
  const slots = useMemo(() => Array.from({ length: 24 }, (_, i) => `bar-${i}`), []);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", height: 40, gap: 3 }}>
      {slots.map((id, i) => {
        const wave = 0.35 + 0.65 * Math.abs(Math.sin(i * 0.7)) * v + 0.08;
        return (
          <View
            key={id}
            style={{
              width: 3,
              height: Math.max(4, 36 * Math.min(1, wave)),
              borderRadius: 2,
              backgroundColor: color,
              opacity: 0.35 + 0.65 * v,
            }}
          />
        );
      })}
    </View>
  );
}

/* ---------------- presentational call screen ---------------- */

export interface VoiceCallScreenProps {
  personaName: string;
  avatarUri?: string | null;
  phase: CallPhase;
  turnState: TurnState;
  levelDb: number;
  durationSec: number;
  transcript: CallTranscriptEntry[];
  muted: boolean;
  error: string;
  onToggleMute: () => void;
  onEnd: () => void;
}

const STATUS_KEY: Record<TurnState, StringKey> = {
  listening: "voicecall.status.listening",
  capturing: "voicecall.status.capturing",
  thinking: "voicecall.status.thinking",
  speaking: "voicecall.status.speaking",
};

export function VoiceCallScreen(props: VoiceCallScreenProps) {
  const colors = useColors();
  const {
    personaName,
    phase,
    turnState,
    levelDb,
    durationSec,
    transcript,
    muted,
    error,
    onToggleMute,
    onEnd,
  } = props;
  const mm = Math.floor(durationSec / 60);
  const ss = String(durationSec % 60).padStart(2, "0");
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [transcript.length]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.canvas,
        paddingTop: 72,
        paddingHorizontal: 24,
        paddingBottom: 48,
      }}
    >
      <View style={{ alignItems: "center" }}>
        <View
          style={{
            width: 96,
            height: 96,
            borderRadius: 48,
            backgroundColor: colors.card,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: 40, color: colors.text }}>{personaName.slice(0, 1)}</Text>
        </View>
        <Text style={{ fontSize: 22, fontWeight: "600", color: colors.text, marginTop: 16 }}>
          {personaName}
        </Text>
        <Text style={{ fontSize: 14, color: colors.muted, marginTop: 6 }}>
          {phase === "connecting"
            ? (t("voicecall.status.connecting") as string)
            : phase === "live"
              ? t(STATUS_KEY[turnState])
              : phase}
        </Text>
        <Text
          style={{ fontSize: 13, color: colors.muted, marginTop: 4, fontVariant: ["tabular-nums"] }}
        >
          {mm}:{ss}
        </Text>
      </View>

      <View style={{ alignItems: "center", marginTop: 20 }}>
        <Waveform levelDb={levelDb} color={colors.blue} />
      </View>

      {error ? (
        <Text style={{ color: colors.danger, textAlign: "center", marginTop: 12 }}>{error}</Text>
      ) : null}

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1, marginTop: 16 }}
        contentContainerStyle={{ paddingBottom: 12 }}
      >
        {transcript.map((e) => (
          <View
            key={`${e.at}-${e.role}-${e.text}`}
            style={{
              alignSelf: e.role === "user" ? "flex-end" : "flex-start",
              backgroundColor: e.role === "user" ? colors.sky : colors.card,
              borderRadius: 12,
              paddingHorizontal: 12,
              paddingVertical: 8,
              marginVertical: 4,
              maxWidth: "85%",
            }}
          >
            <Text style={{ fontSize: 14, color: colors.text }}>{e.text}</Text>
          </View>
        ))}
        {transcript.length === 0 ? (
          <Text style={{ textAlign: "center", color: colors.muted, marginTop: 24 }}>
            {t("voicecall.transcript.empty") as string}
          </Text>
        ) : null}
      </ScrollView>

      <View style={{ flexDirection: "row", justifyContent: "center", gap: 28, marginTop: 16 }}>
        <Pressable
          onPress={onToggleMute}
          accessibilityLabel={t("voicecall.mute") as string}
          style={{
            width: 60,
            height: 60,
            borderRadius: 30,
            backgroundColor: muted ? colors.danger : colors.card,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {muted ? <MicOff size={24} color="#fff" /> : <Mic size={24} color={colors.text} />}
        </Pressable>
        <Pressable
          onPress={onEnd}
          accessibilityLabel={t("voicecall.end") as string}
          style={{
            width: 60,
            height: 60,
            borderRadius: 30,
            backgroundColor: colors.danger,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <PhoneOff size={24} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

/* ---------------- ringing overlay (AI-proposed call) ---------------- */

export function RingingOverlay({
  personaName,
  reason,
  onAccept,
  onDecline,
}: {
  personaName: string;
  reason: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        backgroundColor: colors.card,
        borderBottomWidth: 1,
        borderBottomColor: colors.line,
        paddingTop: 60,
        paddingBottom: 20,
        paddingHorizontal: 24,
        zIndex: 999,
      }}
    >
      <Text style={{ fontSize: 13, color: colors.muted }}>
        {t("voicecall.ring.title") as string}
      </Text>
      <Text style={{ fontSize: 20, fontWeight: "600", color: colors.text, marginTop: 4 }}>
        {personaName}
      </Text>
      <Text style={{ fontSize: 14, color: colors.text, marginTop: 8 }}>{reason}</Text>
      <View style={{ flexDirection: "row", gap: 12, marginTop: 16 }}>
        <Pressable
          onPress={onDecline}
          accessibilityLabel={t("voicecall.ring.decline") as string}
          style={{
            flex: 1,
            paddingVertical: 12,
            borderRadius: 12,
            backgroundColor: colors.canvas,
            alignItems: "center",
          }}
        >
          <Text style={{ color: colors.text, fontWeight: "600" }}>
            {t("voicecall.ring.decline") as string}
          </Text>
        </Pressable>
        <Pressable
          onPress={onAccept}
          accessibilityLabel={t("voicecall.ring.accept") as string}
          style={{
            flex: 1,
            paddingVertical: 12,
            borderRadius: 12,
            backgroundColor: colors.blue,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "600" }}>
            {t("voicecall.ring.accept") as string}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ---------------- controller: owns audio + session ---------------- */

export interface VoiceCallControllerProps {
  persona: Persona;
  adapters: {
    stt: (uri: string) => Promise<string>;
    tts: (sentence: string) => Promise<string>;
    llm: (history: { role: "user" | "assistant"; text: string }[]) => Promise<string>;
  };
  proposalId?: string;
  onEnd: (stats: CallStats | null) => void;
}

async function waitPlayerDone(player: AudioPlayer, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  // Wait until it actually starts (short files can be quick).
  for (let i = 0; i < 40 && !player.playing && Date.now() - start < 4000; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  while (player.playing && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 150));
  }
}

export function VoiceCallController({ persona, adapters, onEnd }: VoiceCallControllerProps) {
  const colors = useColors();
  const [phase, setPhase] = useState<CallPhase>("connecting");
  const [turnState, setTurnState] = useState<TurnState>("listening");
  const [levelDb, setLevelDb] = useState(-160);
  const [durationSec, setDurationSec] = useState(0);
  const [transcript, setTranscript] = useState<CallTranscriptEntry[]>([]);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const sessionRef = useRef<VoiceCallSession | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const meterCbRef = useRef<((db: number | undefined) => void) | null>(null);
  const aliveRef = useRef(true);
  const statsRef = useRef<CallStats | null>(null);

  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });
  // Live metering state for the waveform (polled every 120ms).
  const recState = useAudioRecorderState(recorder, 120);

  // Feed the hook's live metering into the session's onMetering callback.
  // Single recorder: the same stream meters through monitor AND capture —
  // the VAD never loses samples, so speech-end always fires on silence.
  useEffect(() => {
    meterCbRef.current?.(recState.metering);
    setLevelDb(recState.metering ?? -160);
  }, [recState.metering]);

  const micAdapter: MicAdapter = useMemo(
    () => ({
      async startMonitor(onMetering) {
        meterCbRef.current = onMetering;
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
          interruptionMode: "doNotMix",
        }).catch(() => {});
        if (!recorder.isRecording) {
          await recorder.prepareToRecordAsync().catch(() => {});
          recorder.record();
        }
      },
      async stopMonitor() {
        meterCbRef.current = null;
        if (recorder.isRecording) await recorder.stop().catch(() => {});
      },
      async startSegment() {
        // Restart the file so the segment holds only her turn. The metering
        // callback stays registered — VAD continuity is the whole point.
        if (recorder.isRecording) await recorder.stop().catch(() => {});
        await recorder.prepareToRecordAsync().catch(() => {});
        recorder.record();
      },
      async stopSegment() {
        if (recorder.isRecording) await recorder.stop().catch(() => {});
        // Capture the URI right after stop — it points at this segment.
        const uri = recorder.uri;
        // Keep metering alive for the next turn: restart immediately.
        await recorder.prepareToRecordAsync().catch(() => {});
        recorder.record();
        return uri;
      },
      async cancelSegment() {
        // Abandon the segment; do NOT restart — this runs on teardown.
        if (recorder.isRecording) await recorder.stop().catch(() => {});
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const speakerAdapter: SpeakerAdapter = useMemo(
    () => ({
      get isPlaying() {
        return playerRef.current?.playing ?? false;
      },
      async playQueue(uris: string[]) {
        for (const uri of uris) {
          if (!aliveRef.current) return;
          const player = createAudioPlayer({ uri });
          playerRef.current = player;
          try {
            player.play();
            await waitPlayerDone(player);
          } finally {
            try {
              player.pause();
              player.remove();
            } catch {
              // already gone
            }
            if (playerRef.current === player) playerRef.current = null;
          }
        }
      },
      stopNow() {
        const p = playerRef.current;
        playerRef.current = null;
        try {
          p?.pause();
          p?.remove();
        } catch {
          // best effort
        }
      },
    }),
    [],
  );

  useEffect(() => {
    aliveRef.current = true;
    let session: VoiceCallSession | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const startedAt = Date.now();

    (async () => {
      // Mic permission first — no permission, no fake call.
      let perm = await checkAudioPermission().catch(() => "unavailable" as const);
      if (perm !== "granted")
        perm = await requestAudioPermission().catch(() => "unavailable" as const);
      if (!aliveRef.current) return;
      if (perm !== "granted") {
        setError(t("voicecall.error.micDenied") as string);
        setPhase("ended");
        return;
      }
      session = new VoiceCallSession(
        {
          mic: micAdapter,
          speaker: speakerAdapter,
          stt: adapters.stt,
          llm: adapters.llm,
          tts: adapters.tts,
        },
        undefined,
        {
          onTurnState: (s) => aliveRef.current && setTurnState(s),
          onTranscript: (t2) => aliveRef.current && setTranscript(t2),
          onStats: (s) => {
            statsRef.current = s;
          },
          onError: (m) => aliveRef.current && setError(m),
        },
      );
      sessionRef.current = session;
      try {
        await session.start();
      } catch (e) {
        if (!aliveRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase("ended");
        return;
      }
      if (!aliveRef.current) return;
      setPhase("live");
      timer = setInterval(() => {
        setDurationSec(Math.floor((Date.now() - startedAt) / 1000));
      }, 1000);
    })().catch((e) => {
      if (aliveRef.current) setError(e instanceof Error ? e.message : String(e));
    });

    return () => {
      aliveRef.current = false;
      if (timer) clearInterval(timer);
      void sessionRef.current?.end("unmount").catch(() => {});
      sessionRef.current = null;
      try {
        playerRef.current?.pause();
        playerRef.current?.remove();
      } catch {
        // ignore
      }
      playerRef.current = null;
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleEnd() {
    const stats = statsRef.current;
    try {
      await sessionRef.current?.end("user-ended");
    } catch {
      // ignore
    }
    setPhase("ended");
    onEnd(stats);
  }

  async function handleToggleMute() {
    const next = !muted;
    setMuted(next);
    try {
      await sessionRef.current?.setMuted(next);
    } catch {
      // ignore
    }
  }

  if (phase === "ended" && error) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.canvas,
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
        }}
      >
        <Text style={{ color: colors.danger, textAlign: "center", fontSize: 15 }}>{error}</Text>
        <Pressable
          onPress={() => onEnd(statsRef.current)}
          style={{
            marginTop: 24,
            paddingVertical: 12,
            paddingHorizontal: 32,
            borderRadius: 12,
            backgroundColor: colors.card,
          }}
        >
          <Text style={{ color: colors.text, fontWeight: "600" }}>
            {t("voicecall.close") as string}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <VoiceCallScreen
      personaName={persona.name?.trim() || "嘟嘟"}
      phase={phase}
      turnState={turnState}
      levelDb={levelDb}
      durationSec={durationSec}
      transcript={transcript}
      muted={muted}
      error={error}
      onToggleMute={() => void handleToggleMute()}
      onEnd={() => void handleEnd()}
    />
  );
}

/** Accept-button handler shared by the ring UI: mark accepted, hide ring. */
export async function acceptRing(proposalId: string): Promise<boolean> {
  try {
    const notify = await createRingNotifier().catch(() => null);
    const n = notify ?? {
      scheduleNotificationAsync: () => Promise.reject(new Error("no-notify")),
      cancelScheduledNotificationAsync: () => Promise.resolve(),
    };
    const p = await acceptProposal(proposalStore, n, proposalId);
    return p !== null;
  } catch {
    return false;
  }
}

/** Decline-button handler: logged, never retried. */
export async function declineRing(proposalId: string): Promise<boolean> {
  try {
    const notify = await createRingNotifier().catch(() => null);
    const n = notify ?? {
      scheduleNotificationAsync: () => Promise.reject(new Error("no-notify")),
      cancelScheduledNotificationAsync: () => Promise.resolve(),
    };
    const p = await declineProposal(proposalStore, n, proposalId);
    return p !== null;
  } catch {
    return false;
  }
}

export function CallLoadingFallback() {
  const colors = useColors();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.canvas,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <ActivityIndicator size="large" color={colors.blue} />
    </View>
  );
}
