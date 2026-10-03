/**
 * SoraAmbient — a living Sora video for ambient spots in the app.
 *
 * By analogy with the task cards' video buddy (which she loved): places
 * that used to show a dead static icon now show Sora breathing —
 * Our Space empty states, the music room DJ buddy, the knowledge base
 * empty state.
 *
 * - Circular crop, no white borders (same as animated-avatar.tsx).
 * - Muted, looping, no controls — a companion, not a video player.
 * - The static Sora webp renders underneath as instant poster + fallback.
 * - `video` picks the bundled default clip; `slot` lets her (or the AI)
 *   override it with her own mp4 via ambientVideoStore ("醒醒定制的").
 */

import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { avatarVideoSource, soraSource } from "./avatar-assets";
import type { AmbientVideoSlot } from "./sora-ambient-video";
import { ambientVideoStore } from "./sora-ambient-video-instance";

export type AmbientVideoKind = "idle" | "working" | "making_something" | "milestone_level_up";

function setupPlayer(player: { loop: boolean; muted: boolean; play: () => void }) {
  player.loop = true;
  player.muted = true;
  player.play();
}

export function SoraAmbient({
  video,
  slot,
  size,
}: {
  video: AmbientVideoKind;
  slot: AmbientVideoSlot;
  size?: number;
}) {
  const resolvedSize = size ?? 72;
  // Rerender when she (or the AI) swaps a custom video.
  const [, setVersion] = useState(0);
  useEffect(() => ambientVideoStore.subscribe(() => setVersion((v) => v + 1)), []);

  const custom = ambientVideoStore.get(slot);
  const bundled = avatarVideoSource(video);
  const player = useVideoPlayer(custom ? { uri: custom } : bundled, setupPlayer);

  // Swap the clip when the kind changes or overrides are edited.
  // The static image underneath covers the transition so there is no
  // visible flicker; a failed swap keeps the poster visible.
  useEffect(() => {
    try {
      player.replace(custom ? { uri: custom } : bundled);
      player.play();
    } catch {
      // video swap failed → static poster stays visible
    }
  }, [video, custom, bundled, player]);

  return (
    <View
      accessibilityRole="image"
      style={{
        width: resolvedSize,
        height: resolvedSize,
        borderRadius: resolvedSize / 2,
        overflow: "hidden",
      }}
    >
      <Image source={soraSource()} resizeMode="cover" style={StyleSheet.absoluteFill} />
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
        allowsFullscreen={false}
        allowsPictureInPicture={false}
      />
    </View>
  );
}
