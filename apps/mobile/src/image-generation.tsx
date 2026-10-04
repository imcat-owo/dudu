import { Download, Share2, X } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  useWindowDimensions,
  View,
} from "react-native";
import { TText } from "./font";
import { t } from "./i18n";
import { useTheme } from "./theme/ThemeContext";
import { IconButton, useColors, useStyles } from "./ui";

// Pure protocol (no RN) — re-exported here so existing importers keep working.
export {
  buildImageUrl,
  encodeImageMessage,
  extractImageMessage,
  extractImageMessageStrict,
  type ImageMessage,
  parseImageCommand,
  parseImageMessage,
} from "./image/protocol.js";

import type { ImageMessage } from "./image/protocol.js";

/**
 * Download a remote image to a local file so it can be saved or shared.
 * Returns the local file URI.
 */
async function cacheImageLocally(uri: string): Promise<string> {
  const FileSystem = await import("expo-file-system/legacy");
  if (uri.startsWith("file://")) return uri;
  const target = `${FileSystem.cacheDirectory}dudu-image-${Date.now()}.png`;
  const dl = await FileSystem.downloadAsync(uri, target);
  return dl.uri;
}

async function saveToPhotoLibrary(uri: string): Promise<"ok" | "denied" | "failed"> {
  try {
    const localUri = await cacheImageLocally(uri);
    const MediaLibrary = await import("expo-media-library");
    const perm = await MediaLibrary.requestPermissionsAsync();
    if (!perm.granted) return "denied";
    await MediaLibrary.createAssetAsync(localUri);
    return "ok";
  } catch {
    return "failed";
  }
}

async function shareImage(uri: string): Promise<boolean> {
  try {
    const localUri = await cacheImageLocally(uri);
    const Sharing = await import("expo-sharing");
    if (!(await Sharing.isAvailableAsync())) return false;
    await Sharing.shareAsync(localUri, { mimeType: "image/png" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fullscreen image viewer: the picture large, with Save / Share / Close.
 */
function ImageViewerModal({ image, onClose }: { image: ImageMessage; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const [busy, setBusy] = useState<"save" | "share" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const onSave = async () => {
    if (busy) return;
    setBusy("save");
    setNotice(null);
    const r = await saveToPhotoLibrary(image.uri);
    setBusy(null);
    setNotice(r === "ok" ? t("image.saved") : t("image.saveFailed"));
  };

  const onShare = async () => {
    if (busy) return;
    setBusy("share");
    setNotice(null);
    const ok = await shareImage(image.uri);
    setBusy(null);
    if (!ok) setNotice(t("image.shareFailed"));
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.96)" }}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "flex-end",
            paddingTop: 56,
            paddingHorizontal: 16,
          }}
        >
          <IconButton icon={X} label={t("common.close")} onPress={onClose} />
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Image
            source={{ uri: image.uri }}
            style={{ width: width - 32, height: height * 0.62 }}
            resizeMode="contain"
            accessibilityLabel={image.prompt || t("image.viewFullscreen")}
          />
        </View>
        <View style={{ paddingHorizontal: 24, paddingBottom: 48, gap: 12 }}>
          {!!image.prompt && (
            <TText
              numberOfLines={3}
              style={{ color: "#fff", opacity: 0.75, fontSize: 13, textAlign: "center" }}
            >
              {image.prompt}
            </TText>
          )}
          {!!notice && (
            <TText style={{ color: "#fff", fontSize: 13, textAlign: "center" }}>{notice}</TText>
          )}
          <View style={{ flexDirection: "row", justifyContent: "center", gap: 28, paddingTop: 4 }}>
            <View style={{ alignItems: "center", gap: 4 }}>
              <IconButton icon={Download} label={t("common.save")} onPress={() => void onSave()} />
              <TText style={{ color: "#fff", opacity: 0.8, fontSize: 11 }}>
                {busy === "save" ? "…" : t("common.save")}
              </TText>
            </View>
            <View style={{ alignItems: "center", gap: 4 }}>
              <IconButton icon={Share2} label={t("common.share")} onPress={() => void onShare()} />
              <TText style={{ color: "#fff", opacity: 0.8, fontSize: 11 }}>
                {busy === "share" ? "…" : t("common.share")}
              </TText>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Generated image bubble. Shows the image with the prompt as caption.
 * Tapping opens the fullscreen viewer (save / share / close).
 */
export function ImageBubble({ image, user }: { image: ImageMessage; user: boolean }) {
  const colors = useColors();
  const s = useStyles();
  const { tokens } = useTheme();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [viewing, setViewing] = useState(false);
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
        <Pressable
          onPress={() => setViewing(true)}
          accessibilityRole="button"
          accessibilityLabel={t("image.viewFullscreen")}
        >
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
        </Pressable>
      )}
      {!!image.prompt && (
        <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
          <TText numberOfLines={2} style={{ fontSize: 12, color: colors.muted, lineHeight: 16 }}>
            {image.prompt}
          </TText>
        </View>
      )}
      {viewing && <ImageViewerModal image={image} onClose={() => setViewing(false)} />}
    </View>
  );
}
