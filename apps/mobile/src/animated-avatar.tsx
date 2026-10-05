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
import { useEffect, useReducer, useSyncExternalStore } from "react";
import { Image, StyleSheet, View } from "react-native";
import { avatarVideoSource, soraSource } from "./avatar-assets";
import { getCelebrateUntil, subscribeCelebration } from "./avatar-celebration";
import { type AvatarState, resolveAvatarState } from "./avatar-state";
import { useAvatarSize } from "./chat-avatar";
import { t } from "./i18n";

function setupPlayer(player: { loop: boolean; muted: boolean; play: () => void }) {
  player.loop = true;
  player.muted = true;
  player.play();
}

/**
 * useLiveAvatarState — the AI face's current clip, resolved from real
 * signals (A3 wiring):
 * - `milestone_level_up` for MILESTONE_CELEBRATION_MS after a milestone
 *   (a task card freshly reaching done, or anniversary day), then falls back;
 * - `making_something` while a creative tool (image/podcast/video) runs;
 * - `working` while a turn is in flight; `idle` otherwise.
 */
export function useLiveAvatarState(opts: {
  busy: boolean;
  running: boolean;
  makingSomething?: boolean;
}): AvatarState {
  const celebrateUntil = useSyncExternalStore(subscribeCelebration, getCelebrateUntil);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  // When the celebration window lapses, re-resolve so the clip falls back
  // to the live signals instead of freezing on the last frame.
  useEffect(() => {
    const ms = celebrateUntil - Date.now();
    if (ms <= 0) return;
    const id = setTimeout(bump, ms + 50);
    return () => clearTimeout(id);
  }, [celebrateUntil]);
  return resolveAvatarState({ ...opts, celebrateUntil });
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
