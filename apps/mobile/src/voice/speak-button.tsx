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
import { useColors } from "../ui";
import { synthesizeSpeech } from "./tts";
import { useVoiceConfig } from "./store";

export function SpeakButton({ text, bubbleFg }: { text: string; bubbleFg: string }) {
  const colors = useColors();
  const { tts } = useVoiceConfig();
  const [state, setState] = useState<"idle" | "synthesizing" | "playing">("idle");
  const [error, setError] = useState("");
  const playerRef = useRef<AudioPlayer | null>(null);

  useEffect(() => {
    return () => {
      try {
        playerRef.current?.remove();
      } catch {
        // already released
      }
      playerRef.current = null;
    };
  }, []);

  async function stop() {
    try {
      playerRef.current?.pause();
      playerRef.current?.remove();
    } catch {
      // ignore
    }
    playerRef.current = null;
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
      await setAudioModeAsync({ playsInSilentMode: true });
      const player = createAudioPlayer(uri);
      playerRef.current = player;
      player.addListener("playbackStatusUpdate", (status) => {
        if (!status.isLoaded) return;
        if (status.didJustFinish) {
          setState("idle");
          playerRef.current = null;
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
      accessibilityLabel={state === "playing" ? "停止朗读" : "朗读"}
      onPress={() => void (state === "playing" ? stop() : speak())}
      style={{ padding: 6, opacity: 0.7 }}
    >
      {state === "synthesizing" ? (
        <ActivityIndicator size="small" color={bubbleFg} />
      ) : state === "playing" ? (
        <VolumeX size={15} color={bubbleFg} />
      ) : (
        <Volume2 size={15} color={bubbleFg} />
      )}
    </Pressable>
  );
}
