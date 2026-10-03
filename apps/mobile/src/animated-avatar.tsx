/**
 * AnimatedAvatar — the AI assistant's animated face.
 *
 * Plays the bundled mp4 matching the given AvatarState (see
 * avatar-state.ts): idle/connecting → idle.mp4, working/waiting_for_subagents
 * → working.mp4, making_something → making_something.mp4,
 * milestone_level_up → milestone_level_up.mp4.
 *
 * Playback is muted, looping, with no controls — it's a living avatar,
 * not a video player. The static Sora webp renders underneath as an
 * instant poster and graceful fallback: if the video can't load, the
 * still avatar shows instead of an empty circle.
 *
 * Circular crop, compact by design (owner direction 2026-10-03). When
 * `size` is omitted it uses the standard avatar size from the theme
 * bundle, matching ChatAvatar.
 *
 * Exposed for the chat AI avatar (primary) and future use in the
 * "our space" status area.
 */
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect } from "react";
import { Image, StyleSheet, View } from "react-native";
import { avatarVideoSource, soraSource } from "./avatar-assets";
import type { AvatarState } from "./avatar-state";
import { useAvatarSize } from "./chat-avatar";
import { t } from "./i18n";

function setupPlayer(player: { loop: boolean; muted: boolean; play: () => void }) {
  player.loop = true;
  player.muted = true;
  player.play();
}

export function AnimatedAvatar({ state = "idle", size }: { state?: AvatarState; size?: number }) {
  const defaultSize = useAvatarSize();
  const resolvedSize = size ?? defaultSize;
  const player = useVideoPlayer(avatarVideoSource(state), setupPlayer);

  // Swap the clip when the AI state changes. The static image underneath
  // covers the transition so there's no visible flicker.
  useEffect(() => {
    player.replace(avatarVideoSource(state));
    player.play();
  }, [state, player]);

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={t("a11y.aiAvatar")}
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
        allowsPictureInPicture={false}
      />
    </View>
  );
}
