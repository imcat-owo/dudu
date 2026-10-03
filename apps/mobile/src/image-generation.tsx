import { useState } from "react";
import { ActivityIndicator, Image, View } from "react-native";
import { useTheme } from "./theme/ThemeContext";
import { useColors, useStyles } from "./ui";
import { TText } from "./font";
// Pure protocol (no RN) — re-exported here so existing importers keep working.
export {
  buildImageUrl,
  encodeImageMessage,
  type ImageMessage,
  parseImageCommand,
  parseImageMessage,
} from "./image/protocol.js";
import type { ImageMessage } from "./image/protocol.js";

/**
 * Generated image bubble. Shows the image with the prompt as caption.
 * Tapping could open fullscreen later — for now just displays inline.
 */
export function ImageBubble({ image, user }: { image: ImageMessage; user: boolean }) {
  const colors = useColors();
  const s = useStyles();
  const { tokens } = useTheme();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Same surface tokens as text bubbles (review P3, 2026-10-03).
  const bubble = user ? tokens.userBubble : tokens.aiBubble;
  const radius = bubble.radius ?? 16;

  return (
    <View
      style={{
        borderRadius: radius,
        overflow: "hidden",
        backgroundColor: bubble.bg,
        maxWidth: "100%",
      }}
    >
      {failed ? (
        <View style={{ padding: 20, alignItems: "center" }}>
          <TText style={[s.muted, { textAlign: "center" }]}>
            图片加载失败。{"\n"}用 /img 再试一次。
          </TText>
        </View>
      ) : (
        <View>
          {loading && (
            <View
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1,
              }}
            >
              <ActivityIndicator size="large" color={colors.blue} />
              <TText style={[s.muted, { marginTop: 8 }]}>画画中…</TText>
            </View>
          )}
          <Image
            source={{ uri: image.uri }}
            style={{ width: 280, height: 280, borderRadius: radius }}
            resizeMode="cover"
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setFailed(true);
            }}
          />
        </View>
      )}
      {!!image.prompt && (
        <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
          <TText numberOfLines={2} style={{ fontSize: 12, color: colors.muted, lineHeight: 16 }}>
            {image.prompt}
          </TText>
        </View>
      )}
    </View>
  );
}
