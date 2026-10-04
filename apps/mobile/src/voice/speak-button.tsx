/**
 * Speak button: tap to synthesize AI text via TTS and play it.
 * WeChat/QQ-style voice bubble P0 — "播合成语音".
 *
 * Shows a speaker icon; while synthesizing, a spinner; while playing,
 * a stop icon. Tapping while playing stops.
 */

import { type AudioPlayer, createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { Volume2, VolumeX } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable } from "react-native";
import { t } from "../i18n";
import { useColors } from "../ui";
import { useVoiceConfig } from "./store";
import { synthesizeSpeech } from "./tts";

export function SpeakButton({ text, bubbleFg }: { text: string; bubbleFg: string }) {
  const colors = useColors();
  const { tts } = useVoiceConfig();
  const [state, setState] = useState<"idle" | "synthesizing" | "playing">("idle");
  const [error, setError] = useState("");
  const playerRef = useRef<AudioPlayer | null>(null);
  const listenerRef = useRef<{ remove(): void } | null>(null);
  // P3-15: the component can unmount while synthesis is in flight. Without
  // this, the player created after unmount is unstoppable (no ref, no UI).
  const mountedRef = useRef(true);

  /** Release the native player AND its status listener. Idempotent. */
  function releasePlayer() {
    try {
      listenerRef.current?.remove();
    } catch {
      // already released
    }
    listenerRef.current = null;
    try {
      playerRef.current?.pause();
      playerRef.current?.remove();
    } catch {
      // already released
    }
    playerRef.current = null;
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      releasePlayer();
    };
  }, []);

  async function stop() {
    releasePlayer();
    setState("idle");
  }

  async function speak() {
    if (state === "playing") {
      await stop();
      return;
    }
    if (state === "synthesizing") return;
    setError("");
    setState("synthesizing");
    try {
      const uri = await synthesizeSpeech(text, tts);
      // P3-15: unmounted while synthesizing — bail before creating a player
      // nobody can stop.
      if (!mountedRef.current) {
        setState("idle");
        return;
      }
      await setAudioModeAsync({ playsInSilentMode: true });
      const player = createAudioPlayer(uri);
      playerRef.current = player;
      listenerRef.current = player.addListener("playbackStatusUpdate", (status) => {
        if (!status.isLoaded) return;
        if (status.didJustFinish) {
          // P2-12: release the native player AND the listener on finish.
          // Previously the ref was just nulled — leaking a native player
          // and a listener on every completed playback.
          releasePlayer();
          setState("idle");
        }
      });
      player.play();
      setState("playing");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("idle");
    }
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        error
          ? t("voice.speakFailed", { error })
          : state === "playing"
            ? t("voice.stopSpeak")
            : t("voice.speak")
      }
      onPress={() => void (state === "playing" ? stop() : speak())}
      style={{ padding: 6, opacity: 0.7 }}
    >
      {state === "synthesizing" ? (
        <ActivityIndicator size="small" color={bubbleFg} />
      ) : state === "playing" ? (
        <VolumeX size={15} color={bubbleFg} />
      ) : (
        // On TTS failure the icon tints danger-red so the failure is visible;
        // tapping retries (speak() clears the error first).
        <Volume2 size={15} color={error ? colors.danger : bubbleFg} />
      )}
    </Pressable>
  );
}
