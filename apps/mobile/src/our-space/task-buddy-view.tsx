/**
 * TaskBuddyVideo — Sora as a looping video on task progress cards.
 *
 * She said SVG companions look ugly: this replaces task-buddy.tsx (deleted)
 * with the same finalized Sora face used by the chat avatar and the pet,
 * driven by the task's status:
 *   running → working.mp4, stuck → idle.mp4, done → milestone_level_up.mp4.
 *
 * She can upload her own mp4 per status ("醒醒定制的") — overrides come
 * from taskBuddyVideoStore; null means the bundled default. The AI can
 * also swap clips on request via the task_buddy_set_video tool.
 *
 * Playback is muted, looping, no controls — a living companion, not a
 * video player. The static Sora webp renders underneath as an instant
 * poster and graceful fallback: if the video can't load, the still
 * face shows instead of an empty circle.
 *
 * Circular crop. All surrounding colors come from theme tokens (caller).
 * Zero emoji.
 */

import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { avatarVideoSource, soraSource } from "../avatar-assets";
import { taskBuddyVideoStore } from "./task-buddy-video-instance";
import type { TaskStatus } from "./task-progress";

type VideoKey = "idle" | "working" | "milestone_level_up";

const STATUS_VIDEO: Record<TaskStatus, VideoKey> = {
  running: "working",
  stuck: "idle",
  done: "milestone_level_up",
};

function setupPlayer(player: { loop: boolean; muted: boolean; play: () => void }) {
  player.loop = true;
  player.muted = true;
  player.play();
}

export function TaskBuddyVideo({ status, size }: { status: TaskStatus; size?: number }) {
  const resolvedSize = size ?? 52;
  // Rerender when she (or the AI) swaps a custom video.
  const [, setVersion] = useState(0);
  useEffect(() => taskBuddyVideoStore.subscribe(() => setVersion((v) => v + 1)), []);

  const custom = taskBuddyVideoStore.get(status);
  const bundled = avatarVideoSource(STATUS_VIDEO[status]);
  const player = useVideoPlayer(custom ? { uri: custom } : bundled, setupPlayer);

  // Swap the clip when the status changes or overrides are edited.
  // The static image underneath covers the transition so there is no
  // visible flicker; a failed swap keeps the poster visible.
  useEffect(() => {
    try {
      player.replace(custom ? { uri: custom } : bundled);
      player.play();
    } catch {
      // video swap failed → static poster stays visible
    }
  }, [status, custom, bundled, player]);

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
        style={[StyleSheet.absoluteFill, status === "running" && { transform: [{ scaleX: -1 }] }]}
        contentFit="cover"
        nativeControls={false}
        allowsFullscreen={false}
        allowsPictureInPicture={false}
      />
    </View>
  );
}
