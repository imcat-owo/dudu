/**
 * ChatAvatar — the small round avatar shown next to chat bubbles.
 *
 * Source of truth is the theme bundle (Settings → Appearance → avatar):
 *   bundle.avatar.assistant / bundle.avatar.user (user-picked images).
 * Fallbacks when nothing is picked:
 *   assistant → Mascot (the theme's default assistant face)
 *   user      → lucide User icon in a token-colored disc
 *
 * Compact by design (owner direction 2026-10-03): 30pt base, mildly scaled
 * with the font-size setting. No hardcoded colors — everything from tokens.
 */
import { User } from "lucide-react-native";
import { useState } from "react";
import { Image, View } from "react-native";
import { useFontSizeSetting } from "./app-settings";
import { t } from "./i18n";
import { useTheme } from "./theme/ThemeContext";
import { Mascot, useColors } from "./ui";

const AVATAR_BASE = 30;

export function ChatAvatar({ who }: { who: "user" | "assistant" }) {
  const colors = useColors();
  const { bundle } = useTheme();
  const { scale } = useFontSizeSetting();
  const [failed, setFailed] = useState(false);
  const size = Math.round(AVATAR_BASE * scale);
  // A dead URI (e.g. from a server-synced bundle) falls back instead of
  // rendering a broken image (review P2, 2026-10-03).
  const uri = failed
    ? undefined
    : who === "assistant"
      ? bundle.avatar?.assistant
      : bundle.avatar?.user;

  if (uri) {
    return (
      <Image
        accessibilityRole="image"
        accessibilityLabel={t(who === "assistant" ? "a11y.aiAvatar" : "a11y.userAvatar")}
        source={{ uri }}
        onError={() => setFailed(true)}
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
    );
  }

  if (who === "assistant") {
    return (
      <View
        accessibilityRole="image"
        accessibilityLabel={t("a11y.aiAvatar")}
        style={{ width: size, height: size }}
      >
        <Mascot size={size} />
      </View>
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
