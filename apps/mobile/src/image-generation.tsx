import { useState } from "react";
import { ActivityIndicator, Image, Text, View } from "react-native";
import { useTheme } from "./theme/ThemeContext";
import { useColors, useStyles } from "./ui";

export type ImageMessage = {
  uri: string;
  prompt: string;
};

/**
 * Detect an image message encoded in message content.
 * Convention: {"type":"image_message","uri":"...","prompt":"..."}
 */
export function parseImageMessage(content: string): ImageMessage | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as Record<string, unknown>).type === "image_message" &&
      typeof (parsed as Record<string, unknown>).uri === "string" &&
      typeof (parsed as Record<string, unknown>).prompt === "string"
    ) {
      const p = parsed as { uri: string; prompt: string };
      if (p.uri) return { uri: p.uri, prompt: p.prompt };
    }
  } catch {
    // not JSON — not an image message
  }
  return null;
}

export function encodeImageMessage(uri: string, prompt: string): string {
  return JSON.stringify({ type: "image_message", uri, prompt });
}

/**
 * Build a Pollinations.ai image URL. Free, no API key needed.
 * https://image.pollinations.ai/prompt/{prompt}?width=&height=&model=&seed=
 */
export function buildImageUrl(
  prompt: string,
  opts?: { width?: number; height?: number; model?: string; seed?: number },
): string {
  const width = opts?.width ?? 1024;
  const height = opts?.height ?? 1024;
  const model = opts?.model ?? "flux";
  const seed = opts?.seed ?? Math.floor(Math.random() * 1000000);
  const encoded = encodeURIComponent(prompt.trim());
  return (
    `https://image.pollinations.ai/prompt/${encoded}` +
    `?width=${width}&height=${height}&model=${model}&seed=${seed}` +
    `&nologo=true&private=true&enhance=true`
  );
}

/** Detect the /img command. Returns the prompt, or null if not an image request. */
export function parseImageCommand(text: string): string | null {
  const trimmed = text.trim();
  const match = /^\/img\s+(.+)$/is.exec(trimmed);
  return match ? match[1].trim() : null;
}

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
          <Text style={[s.muted, { textAlign: "center" }]}>
            图片加载失败。{"\n"}用 /img 再试一次。
          </Text>
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
              <Text style={[s.muted, { marginTop: 8 }]}>画画中…</Text>
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
          <Text numberOfLines={2} style={{ fontSize: 12, color: colors.muted, lineHeight: 16 }}>
            {image.prompt}
          </Text>
        </View>
      )}
    </View>
  );
}
