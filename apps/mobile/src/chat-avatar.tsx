/**
 * ChatAvatar — the small round avatar shown next to chat bubbles.
 *
 * Source of truth is the theme bundle (Settings → Appearance → avatar):
 *   bundle.avatar.assistant / bundle.avatar.user (user-picked images).
 * Fallbacks when nothing is picked:
 *   assistant → Mascot (the theme's default assistant face)
 *   user      → lucide User icon in a token-colored disc
 *
 * Compact by design (owner direction 2026-10-03): base size comes from the
 * theme bundle (bundle.avatar.size, design §9), mildly scaled with the
 * font-size setting. No hardcoded colors — everything from tokens.
 */
import { User } from "lucide-react-native";
import { useState } from "react";
import { Image, PixelRatio, View } from "react-native";
import { AnimatedAvatar } from "./animated-avatar";
import { useFontSizeSetting } from "./app-settings";
import { soraSource } from "./avatar-assets";
import type { AvatarState } from "./avatar-state";
import { t } from "./i18n";
import { useTheme } from "./theme/ThemeContext";
import { useColors } from "./ui";

/** Fallback diameter (pt) when the theme bundle doesn't set avatar.size. */
const DEFAULT_AVATAR_SIZE = 30;

/**
 * Standard avatar diameter (pt): theme bundle's avatar.size, scaled by the
 * font-size setting. "system" follows the OS text size: RN Text scales
 * automatically via allowFontScaling, but avatars are View/Image, so the
 * OS font scale must be read explicitly (review P3-9, 2026-10-03).
 */
export function useAvatarSize(): number {
  const { bundle } = useTheme();
  const { scale, followSystem } = useFontSizeSetting();
  const effectiveScale = followSystem ? PixelRatio.getFontScale() : scale;
  return Math.round((bundle.avatar?.size ?? DEFAULT_AVATAR_SIZE) * effectiveScale);
}

export function ChatAvatar({
  who,
  liveState,
}: {
  who: "user" | "assistant";
  liveState?: AvatarState;
}) {
  const colors = useColors();
  const { bundle } = useTheme();
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const size = useAvatarSize();
  const rawUri = who === "assistant" ? bundle.avatar?.assistant : bundle.avatar?.user;
  // Remember WHICH uri failed, not just that one failed: picking a new
  // avatar in Settings retries the new URI, while the same dead URI stays
  // on the fallback (re-review P2, 2026-10-03).
  const uri = rawUri && rawUri !== failedUri ? rawUri : undefined;

  if (uri) {
    return (
      <Image
        accessibilityRole="image"
        accessibilityLabel={t(who === "assistant" ? "a11y.aiAvatar" : "a11y.userAvatar")}
        source={{ uri }}
        onError={() => setFailedUri(rawUri ?? null)}
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
    );
  }

  if (who === "assistant") {
    // A3: the default face is alive — idle loop, working while generating,
    // making_something while a creative tool runs, celebration clip on
    // milestones. A user-picked avatar stays exactly as she chose it
    // (static image, via the uri branch above).
    // Default assistant face: the Sora avatar (owner finalized 2026-10-03,
    // "和 Muse 一样的"). Devil stickers stay selectable via Appearance →
    // avatar; picking one sets bundle.avatar.assistant and takes the uri
    // branch above.
    if (!uri && liveState) {
      return <AnimatedAvatar state={liveState} size={size} />;
    }
    return (
      <Image
        accessibilityRole="image"
        accessibilityLabel={t("a11y.aiAvatar")}
        source={soraSource()}
        resizeMode="cover"
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
    );
  }

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={t("a11y.userAvatar")}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.sky,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <User size={size * 0.55} color={colors.blueDark} />
    </View>
  );
}
