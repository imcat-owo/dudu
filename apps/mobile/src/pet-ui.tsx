/**
 * PetOverlay — the draggable desktop pet (桌宠）. The pet IS the AI (小梦）.
 *
 * Rendered once at the LocalApp root, floating above tab content.
 * - Drag with PanResponder + Animated (no new native deps).
 * - Drop zones (registered by screens): AI bubble, input top, dialog,
 *   space/chat tab buttons.
 * - Sora skin (default): reuses the 4 bundled avatar-anim mp4s. The "busy"
 *   mood mirrors the AI's AvatarState via the same mapping as
 *   AnimatedAvatar (idle→idle.mp4, working→working.mp4,
 *   making_something→making_something.mp4, milestone→milestone_level_up.mp4);
 *   static webp underneath as poster/fallback. Devil skins: static
 *   sticker + built-in motion (breathing / bounce).
 * - Mood is derived: dragged > happy (2.5s after drop/tap) > AI-busy >
 *   music-bopping > sleepy (90s idle) > idle.
 */
import { useVideoPlayer, type VideoSource, VideoView } from "expo-video";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  PanResponder,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { avatarVideoSource, soraSource } from "./avatar-assets";
import type { AvatarState } from "./avatar-state";
import { t } from "./i18n";
import { mascotSource } from "./mascot-assets";
import { petInteractionVideos, petStore } from "./pet/instance";
import {
  INTERACTION_DEFAULT_CLIP,
  isOneShotInteraction,
  logInteraction,
  type PetInteraction,
} from "./pet/interactions";
import { getAiBubbleMessageId, hitTestAt, measureZone } from "./pet/registry";
import {
  type PetMood,
  type PetPersisted,
  type PetSkin,
  petActivity,
  resolvePetMood,
} from "./pet/store";

const PET_SIZE = 64;
/** Bottom tab bar height — the pet never parks under it. */
const TAB_BAR_SPACE = 92;

const MOOD_VIDEO: Record<PetMood, AvatarState | null> = {
  idle: "idle",
  dragged: "idle",
  happy: "milestone_level_up",
  // busy is resolved dynamically from the AI's AvatarState (same source of
  // truth as AnimatedAvatar) — see PetFace below.
  busy: "working",
  bopping: "idle",
  sleepy: null,
};

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function interactionVideoSource(interaction: PetInteraction): VideoSource {
  const custom = petInteractionVideos.get(interaction);
  if (custom) return { uri: custom };
  return avatarVideoSource(INTERACTION_DEFAULT_CLIP[interaction] as AvatarState);
}

function PetFace({
  skin,
  mood,
  size,
  interaction,
  aiState,
  onInteractionEnd,
}: {
  skin: PetSkin;
  mood: PetMood;
  size: number;
  interaction: PetInteraction | null;
  /** The AI's current AvatarState — drives the "busy" mood video, mirroring AnimatedAvatar. */
  aiState: AvatarState;
  onInteractionEnd: () => void;
}) {
  // "busy" mirrors the AI state (idle/working/making_something/...) via the
  // same AVATAR_STATE_VIDEO mapping as AnimatedAvatar; other moods are fixed.
  const videoState: AvatarState | null = mood === "busy" ? aiState : MOOD_VIDEO[mood];
  const player = useVideoPlayer(
    videoState ? avatarVideoSource(videoState) : avatarVideoSource("idle"),
    (p) => {
      p.loop = true;
      p.muted = true;
      p.play();
    },
  );

  useEffect(() => {
    if (videoState && (skin.kind === "sora" || (skin.kind === "custom" && skin.videoUri))) {
      try {
        player.replace(
          skin.kind === "custom" && skin.videoUri
            ? { uri: skin.videoUri }
            : avatarVideoSource(videoState),
        );
        player.play();
      } catch {
        // video swap failed → static poster stays visible
      }
    }
  }, [videoState, skin, player]);

  // ---- Interaction layer: plays on top of the mood video (sora skin only).
  // Crossfades in/out; one-shot interactions (head pat) hand back on playToEnd.
  const interactionPlayer = useVideoPlayer(avatarVideoSource("idle"), (p) => {
    p.muted = true;
  });
  const [, setVideoVersion] = useState(0);
  useEffect(() => petInteractionVideos.subscribe(() => setVideoVersion((v) => v + 1)), []);

  useEffect(() => {
    if (!interaction) {
      try {
        interactionPlayer.pause();
      } catch {
        // player not ready yet — harmless
      }
      return;
    }
    try {
      interactionPlayer.replace(interactionVideoSource(interaction));
      interactionPlayer.loop = !isOneShotInteraction(interaction);
      interactionPlayer.play();
    } catch {
      // swap failed → mood video stays visible underneath
    }
  }, [interaction, interactionPlayer]);

  useEffect(() => {
    if (interaction !== "headpat") return;
    const sub = interactionPlayer.addListener("playToEnd", () => {
      onInteractionEnd();
    });
    return () => sub.remove();
  }, [interaction, interactionPlayer, onInteractionEnd]);

  const interactionOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(interactionOpacity, {
      toValue: interaction ? 1 : 0,
      duration: 280,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [interaction, interactionOpacity]);

  // Built-in motion for static skins / states without a video.
  const breathe = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: mood === "busy" ? 1100 : 2400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: mood === "busy" ? 1100 : 2400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [breathe, mood]);

  const scale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const bounce = breathe.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, mood === "bopping" ? -7 : -3, 0],
  });

  const showVideo =
    (skin.kind === "sora" || (skin.kind === "custom" && !!skin.videoUri)) && videoState !== null;
  const showInteraction = interaction !== null && skin.kind === "sora";
  const dimmed = mood === "sleepy" || mood === "dragged";

  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        transform: [
          { scale: mood === "dragged" ? 1.14 : scale },
          { translateY: mood === "bopping" || mood === "happy" ? bounce : 0 },
        ],
        opacity: dimmed ? 0.75 : 1,
      }}
    >
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: "hidden",
          backgroundColor: "transparent",
        }}
      >
        {skin.kind === "custom" ? (
          <>
            <Image
              source={{ uri: skin.imageUri }}
              resizeMode="cover"
              style={StyleSheet.absoluteFill}
            />
            {showVideo && skin.videoUri && (
              <VideoView
                player={player}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                nativeControls={false}
                allowsPictureInPicture={false}
              />
            )}
          </>
        ) : skin.kind === "sora" ? (
          <>
            <Image source={soraSource()} resizeMode="cover" style={StyleSheet.absoluteFill} />
            {showVideo && (
              <VideoView
                player={player}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                nativeControls={false}
                allowsPictureInPicture={false}
              />
            )}
            {showInteraction && (
              <Animated.View style={[StyleSheet.absoluteFill, { opacity: interactionOpacity }]}>
                <VideoView
                  player={interactionPlayer}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  nativeControls={false}
                  allowsPictureInPicture={false}
                />
              </Animated.View>
            )}
          </>
        ) : (
          <Image
            source={mascotSource(skin.index)}
            resizeMode="cover"
            style={StyleSheet.absoluteFill}
          />
        )}
      </View>
    </Animated.View>
  );
}

export function PetOverlay({
  section,
  onNavigate,
}: {
  section: string;
  onNavigate: (next: "chat" | "space") => void;
}) {
  const { width: W, height: H } = useWindowDimensions();
  const [pet, setPet] = useState<PetPersisted | null>(null);
  const [activity, setActivity] = useState(petActivity.snapshot());
  const [dragging, setDragging] = useState(false);
  const [interaction, setInteraction] = useState<PetInteraction | null>(null);
  const [, setTick] = useState(0);
  const lastHappyAt = useRef(0);
  const lastInteractAt = useRef(Date.now());
  const lastTapAt = useRef(0);
  const pan = useRef(new Animated.ValueXY()).current;
  const panStart = useRef({ x: 0, y: 0 });
  /** Last known absolute pet position (updated on spring completion / drag). */
  const posRef = useRef({ x: 0, y: 0 });
  const movedFar = useRef(false);
  /** Mirror of `interaction` for use inside the PanResponder (stale closures). */
  const interactionRef = useRef<PetInteraction | null>(null);
  /** Long-press (reach out) timer + whether it fired this touch. */
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const stateRef = useRef<PetPersisted | null>(null);
  stateRef.current = pet;

  const setInteractionBoth = useCallback((v: PetInteraction | null) => {
    interactionRef.current = v;
    setInteraction(v);
  }, []);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  /** After an interaction ends, fall back to headphones if music is playing. */
  const maybeRestoreHeadphones = useCallback(() => {
    if (petActivity.snapshot().musicPlaying && interactionRef.current === null) {
      interactionRef.current = "headphones";
      setInteraction("headphones");
    }
  }, []);

  const handleInteractionEnd = useCallback(() => {
    // One-shot (head pat) finished → hand back to mood / headphones.
    if (interactionRef.current === "headpat") {
      interactionRef.current = null;
      setInteraction(null);
      maybeRestoreHeadphones();
    }
  }, [maybeRestoreHeadphones]);

  useEffect(() => {
    void petStore.load().then((s) => {
      setPet(s);
      // Start at the saved free spot (anchored perches resolve on the next tick).
      const p = s.pos[s.location];
      const ix = clamp(p.fx * W, 0, Math.max(0, W - PET_SIZE));
      const iy = clamp(p.fy * H, 0, Math.max(0, H - PET_SIZE - TAB_BAR_SPACE));
      pan.setValue({ x: ix, y: iy });
      posRef.current = { x: ix, y: iy };
      lastInteractAt.current = Date.now();
    });
    const unsub = petStore.subscribe(() => setPet({ ...petStore.get() }));
    const unsubAct = petActivity.subscribe((a) => setActivity(a));
    void petInteractionVideos.load();
    const timer = setInterval(() => setTick((n) => n + 1), 5000);
    return () => {
      unsub();
      unsubAct();
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Music playing → headphones interaction (unless a touch interaction owns the pet).
  useEffect(() => {
    if (activity.musicPlaying && interactionRef.current === null) {
      interactionRef.current = "headphones";
      setInteraction("headphones");
      logInteraction("headphones");
    } else if (!activity.musicPlaying && interactionRef.current === "headphones") {
      interactionRef.current = null;
      setInteraction(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity.musicPlaying]);

  const mood: PetMood = useMemo(
    () =>
      resolvePetMood({
        dragging,
        aiBusy: activity.aiBusy,
        musicPlaying: activity.musicPlaying,
        lastHappyAt: lastHappyAt.current,
        lastInteractAt: lastInteractAt.current,
        now: Date.now(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dragging, activity, pet],
  );

  const maxX = Math.max(0, W - PET_SIZE);
  const maxY = Math.max(0, H - PET_SIZE - TAB_BAR_SPACE);

  /** Compute where the pet should rest for the current perch. */
  const resolveRestPosition = useCallback(async (): Promise<{ x: number; y: number }> => {
    const s = stateRef.current;
    if (!s) return { x: maxX / 2, y: maxY / 2 };
    if (s.perch === "input-top") {
      const r = await measureZone("input-top");
      if (r) return { x: clamp(r.x + 10, 0, maxX), y: clamp(r.y - PET_SIZE + 18, 0, maxY) };
    }
    if (s.perch === "ai-bubble") {
      // Only stay perched while the registered bubble is the one dropped on.
      // A new AI message (or a scrolled-away bubble) → sit free instead.
      if (s.bubbleMessageId && s.bubbleMessageId === getAiBubbleMessageId()) {
        const r = await measureZone("ai-bubble");
        if (r) {
          return {
            x: clamp(r.x + r.width - PET_SIZE + 12, 0, maxX),
            y: clamp(r.y - PET_SIZE + 20, 0, maxY),
          };
        }
      }
      // Anchor lost: sit free where it visually is, and stop retrying.
      const fx = clamp(posRef.current.x, 0, maxX) / Math.max(1, maxX);
      const fy = clamp(posRef.current.y, 0, maxY) / Math.max(1, maxY);
      void petStore.drop({ zone: null, fx, fy });
      return { x: posRef.current.x, y: posRef.current.y };
    }
    const p = s.pos[s.location];
    return { x: clamp(p.fx * W, 0, maxX), y: clamp(p.fy * H, 0, maxY) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [W, H, maxX, maxY]);

  const springTo = useCallback(
    (x: number, y: number) => {
      const tx = clamp(x, 0, maxX);
      const ty = clamp(y, 0, maxY);
      Animated.spring(pan, {
        toValue: { x: tx, y: ty },
        useNativeDriver: false,
        bounciness: 8,
      }).start(({ finished }) => {
        if (finished) posRef.current = { x: tx, y: ty };
      });
    },
    [pan, maxX, maxY],
  );

  // Rest position when pet state / tab / screen size changes (not while dragging).
  useEffect(() => {
    if (!pet || dragging) return;
    if (section !== pet.location) return;
    void resolveRestPosition().then(({ x, y }) => {
      // Already there → skip (avoids fighting the follow-tick).
      const cur = posRef.current;
      if (Math.abs(cur.x - x) < 1 && Math.abs(cur.y - y) < 1) return;
      springTo(x, y);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pet?.perch, pet?.location, pet?.skin, section, W, H]);

  // While perched on a bubble/input, follow it (scroll / resize) on a tick.
  useEffect(() => {
    if (!pet || dragging) return;
    if (pet.perch !== "ai-bubble" && pet.perch !== "input-top") return;
    if (section !== pet.location) return;
    const timer = setInterval(() => {
      void resolveRestPosition().then(({ x, y }) => springTo(x, y));
    }, 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pet?.perch, pet?.location, dragging, section]);

  const doHappy = useCallback(() => {
    lastHappyAt.current = Date.now();
    lastInteractAt.current = Date.now();
    setTick((n) => n + 1);
  }, []);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, gs) => Math.abs(gs.dx) + Math.abs(gs.dy) > 5,
        onPanResponderGrant: () => {
          movedFar.current = false;
          longPressFired.current = false;
          setDragging(true);
          lastInteractAt.current = Date.now();
          // Long-press (no drag): she holds still ~500ms → pet reaches out
          // its hand to touch her finger. Cancelled as soon as she moves.
          cancelLongPress();
          longPressTimer.current = setTimeout(() => {
            longPressTimer.current = null;
            if (
              !movedFar.current &&
              (interactionRef.current === null || interactionRef.current === "headphones")
            ) {
              longPressFired.current = true;
              setInteractionBoth("reach");
              logInteraction("reach");
              lastInteractAt.current = Date.now();
            }
          }, 500);
          // Stop any in-flight spring and pick up from the true position.
          pan.stopAnimation((v: { x: number; y: number }) => {
            panStart.current = { x: v.x, y: v.y };
            posRef.current = { x: v.x, y: v.y };
            pan.setOffset(panStart.current);
            pan.setValue({ x: 0, y: 0 });
          });
        },
        onPanResponderMove: (_e, gs) => {
          const dist = Math.abs(gs.dx) + Math.abs(gs.dy);
          if (dist > 5) movedFar.current = true;
          if (dist > 10) {
            // It's a drag, not a long-press → pinch her cheek.
            cancelLongPress();
            longPressFired.current = false;
            if (interactionRef.current !== "pinch") {
              setInteractionBoth("pinch");
              logInteraction("pinch");
            }
          }
          const nx = clamp(panStart.current.x + gs.dx, 0, maxX);
          const ny = clamp(panStart.current.y + gs.dy, 0, maxY);
          pan.setValue({ x: nx - panStart.current.x, y: ny - panStart.current.y });
        },
        onPanResponderRelease: (_e, gs) => {
          pan.flattenOffset();
          setDragging(false);
          cancelLongPress();
          lastInteractAt.current = Date.now();
          const absX = clamp(panStart.current.x + gs.dx, 0, maxX);
          const absY = clamp(panStart.current.y + gs.dy, 0, maxY);
          posRef.current = { x: absX, y: absY };
          const cx = clamp(absX + PET_SIZE / 2, 0, W);
          const cy = clamp(absY + PET_SIZE / 2, 0, H);
          if (longPressFired.current) {
            // Long-press release → hand goes back, not a tap.
            longPressFired.current = false;
            if (interactionRef.current === "reach") setInteractionBoth(null);
            maybeRestoreHeadphones();
            return;
          }
          if (!movedFar.current) {
            // Tap → single: happy bounce; double (within 350ms): head pat.
            const now = Date.now();
            if (now - lastTapAt.current < 350) {
              lastTapAt.current = 0;
              setInteractionBoth("headpat");
              logInteraction("headpat");
            } else {
              lastTapAt.current = now;
            }
            doHappy();
            return;
          }
          if (interactionRef.current === "pinch") setInteractionBoth(null);
          maybeRestoreHeadphones();
          void hitTestAt(cx, cy).then(async (zone) => {
            const fx = clamp(cx - PET_SIZE / 2, 0, maxX) / Math.max(1, maxX);
            const fy = clamp(cy - PET_SIZE / 2, 0, maxY) / Math.max(1, maxY);
            const next = await petStore.drop({ zone, fx, fy });
            doHappy();
            if (zone === "tab-space") onNavigate("space");
            else if (zone === "tab-chat") onNavigate("chat");
            // Spring to the new rest position (anchor or free spot).
            const target = await (async () => {
              if (next.perch === "input-top" || next.perch === "ai-bubble") {
                return resolveRestPosition();
              }
              const p = next.pos[next.location];
              return { x: clamp(p.fx * W, 0, maxX), y: clamp(p.fy * H, 0, maxY) };
            })();
            springTo(target.x, target.y);
          });
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      W,
      H,
      maxX,
      maxY,
      doHappy,
      onNavigate,
      setInteractionBoth,
      cancelLongPress,
      maybeRestoreHeadphones,
    ],
  );

  if (!pet || section !== pet.location) return null;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Animated.View
        {...responder.panHandlers}
        accessibilityRole="image"
        accessibilityLabel={t("pet.a11y.pet")}
        style={{
          position: "absolute",
          width: PET_SIZE,
          height: PET_SIZE,
          transform: pan.getTranslateTransform(),
        }}
      >
        <PetFace
          skin={pet.skin}
          mood={mood}
          size={PET_SIZE}
          interaction={interaction}
          aiState={activity.avatarState}
          onInteractionEnd={handleInteractionEnd}
        />
      </Animated.View>
    </View>
  );
}
