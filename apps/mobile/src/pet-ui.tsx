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
 * - Mood is derived: dragged > happy (2.5s after drop/tap) > HER (her
 *   message 6s, her return 4s — he perceives her, P2-30) > AI-busy >
 *   music-bopping > sleepy (90s idle) > idle.
 */
import { useVideoPlayer, VideoView } from "expo-video";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  AppState,
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
import { petStore } from "./pet/instance";
import { getAiBubbleMessageId, hitTestAt, measureZone } from "./pet/registry";
import {
  type PetMood,
  type PetPersisted,
  type PetSkin,
  petActivity,
  resolvePetMood,
} from "./pet/store";
import { registerPetSkinHandler } from "./pet/tools";

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

function PetFace({
  skin,
  mood,
  size,
  aiState,
}: {
  skin: PetSkin;
  mood: PetMood;
  size: number;
  /** The AI's current AvatarState — drives the "busy" mood video, mirroring AnimatedAvatar. */
  aiState: AvatarState;
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

  // Wire the AI "set_pet_skin" tool to immediate apply via petStore.
  useEffect(() => {
    registerPetSkinHandler(async (skin) => {
      await petStore.setSkin(skin);
    });
  }, []);
  const [dragging, setDragging] = useState(false);
  const [, setTick] = useState(0);
  const lastHappyAt = useRef(0);
  const lastInteractAt = useRef(Date.now());
  const pan = useRef(new Animated.ValueXY()).current;
  const panStart = useRef({ x: 0, y: 0 });
  /** Last known absolute pet position (updated on spring completion / drag). */
  const posRef = useRef({ x: 0, y: 0 });
  const movedFar = useRef(false);
  const stateRef = useRef<PetPersisted | null>(null);
  stateRef.current = pet;

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
    const timer = setInterval(() => setTick((n) => n + 1), 5000);
    return () => {
      unsub();
      unsubAct();
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mood: PetMood = useMemo(
    () =>
      resolvePetMood({
        dragging,
        aiBusy: activity.aiBusy,
        musicPlaying: activity.musicPlaying,
        lastHappyAt: lastHappyAt.current,
        // P2-30: her talking to him / coming back counts as interaction —
        // he doesn't doze off right after she spoke to him.
        lastInteractAt: Math.max(
          lastInteractAt.current,
          activity.lastHerMessageAt,
          activity.lastHerBackAt,
        ),
        lastHerMessageAt: activity.lastHerMessageAt,
        lastHerBackAt: activity.lastHerBackAt,
        now: Date.now(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dragging, activity, pet],
  );

  // P2-30: he perceives her comings and goings. When the app returns to the
  // foreground after she'd been away a while (>10s, so rapid switches don't
  // spam greetings), he notices she's back → greeting bounce.
  useEffect(() => {
    let backgroundedAt = 0;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background" || state === "inactive") {
        backgroundedAt = Date.now();
      } else if (state === "active") {
        if (backgroundedAt > 0 && Date.now() - backgroundedAt > 10000) {
          petActivity.noteHerBack();
        }
        backgroundedAt = 0;
      }
    });
    return () => sub.remove();
  }, []);

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
          setDragging(true);
          lastInteractAt.current = Date.now();
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
          const nx = clamp(panStart.current.x + gs.dx, 0, maxX);
          const ny = clamp(panStart.current.y + gs.dy, 0, maxY);
          pan.setValue({ x: nx - panStart.current.x, y: ny - panStart.current.y });
        },
        onPanResponderRelease: (_e, gs) => {
          pan.flattenOffset();
          setDragging(false);
          lastInteractAt.current = Date.now();
          const absX = clamp(panStart.current.x + gs.dx, 0, maxX);
          const absY = clamp(panStart.current.y + gs.dy, 0, maxY);
          posRef.current = { x: absX, y: absY };
          const cx = clamp(absX + PET_SIZE / 2, 0, W);
          const cy = clamp(absY + PET_SIZE / 2, 0, H);
          if (!movedFar.current) {
            // Tap → happy bounce.
            doHappy();
            return;
          }
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
    [W, H, maxX, maxY, doHappy, onNavigate],
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
        <PetFace skin={pet.skin} mood={mood} size={PET_SIZE} aiState={activity.avatarState} />
      </Animated.View>
    </View>
  );
}
