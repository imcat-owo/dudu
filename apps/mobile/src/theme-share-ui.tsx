/**
 * Theme pack import/export UI (theme-design.md §7, Phase 1b item 1).
 *
 * Three paths, aligned with Kelivo's sharing model:
 *  - JSON paste: copy out / paste in, validated loudly on import.
 *  - QR code: show a QR of the bundle; scan one to import.
 *  - System share sheet: hand the JSON to iOS share.
 *
 * Local file:// image URIs are stripped on export (they're meaningless on
 * another device) and the UI says so honestly.
 */

import { CameraView, useCameraPermissions } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Pressable, Share, TextInput, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { t } from "./i18n";
import {
  bundleFitsQr,
  exportBundleJson,
  type ImportErrorCode,
  parseImportBundle,
  stripLocalUris,
} from "./theme/share";
import { useTheme } from "./theme/ThemeContext";
import type { ThemeBundle } from "./theme/types";
import { Button, Card, SectionHeading, Sheet, useColors } from "./ui";
import { TText } from "./font";

function importErrorText(code: ImportErrorCode): string {
  switch (code) {
    case "empty":
      return t("appearance.shareImportErrorEmpty");
    case "not-json":
      return t("appearance.shareImportErrorJson");
    case "invalid-bundle":
      return t("appearance.shareImportErrorBundle");
  }
}

export function ShareSection() {
  const { bundle, stageBundle } = useTheme();
  const colors = useColors();
  const [notice, setNotice] = useState("");
  const [qrOpen, setQrOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);

  const doCopy = async () => {
    const { bundle: shippable, stripped } = stripLocalUris(bundle);
    await Clipboard.setStringAsync(exportBundleJson(shippable));
    setNotice(
      stripped.length > 0
        ? `${t("appearance.shareCopied")} · ${t("appearance.shareStripped")}`
        : t("appearance.shareCopied"),
    );
  };

  const doShare = async () => {
    const { bundle: shippable, stripped } = stripLocalUris(bundle);
    try {
      await Share.share({ message: exportBundleJson(shippable) });
      if (stripped.length > 0) setNotice(t("appearance.shareStripped"));
      else setNotice("");
    } catch {
      // User dismissed the sheet — not an error.
    }
  };

  const doImport = (text: string): boolean => {
    const result = parseImportBundle(text);
    if (!result.ok) {
      setNotice(importErrorText(result.code));
      return false;
    }
    // Import lands as a try-on: the user sees it first, Apply keeps it.
    stageBundle({
      ...result.bundle,
      meta: { ...result.bundle.meta, updatedAt: new Date().toISOString() },
    });
    setNotice(t("appearance.shareImported"));
    return true;
  };

  return (
    <View>
      <SectionHeading title={t("appearance.shareLabel")} />
      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          <Button small onPress={() => void doCopy()}>
            {t("appearance.shareCopyJson")}
          </Button>
          <Button small onPress={() => void doShare()}>
            {t("appearance.shareSystem")}
          </Button>
          <Button small onPress={() => setQrOpen(true)}>
            {t("appearance.shareQr")}
          </Button>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          <Button small onPress={() => setPasteOpen(true)}>
            {t("appearance.sharePasteTitle")}
          </Button>
          <Button small onPress={() => setScanOpen(true)}>
            {t("appearance.shareScanQr")}
          </Button>
        </View>
        {notice ? <TText style={{ color: colors.text, fontSize: 13 }}>{notice}</TText> : null}
      </Card>
      {qrOpen ? <QrSheet bundle={bundle} onClose={() => setQrOpen(false)} /> : null}
      {pasteOpen ? (
        <PasteSheet
          onClose={() => setPasteOpen(false)}
          onImport={(text) => {
            if (doImport(text)) setPasteOpen(false);
          }}
        />
      ) : null}
      {scanOpen ? (
        <ScanSheet
          onClose={() => setScanOpen(false)}
          onImport={(text) => {
            if (doImport(text)) setScanOpen(false);
          }}
        />
      ) : null}
    </View>
  );
}

function QrSheet({ bundle, onClose }: { bundle: ThemeBundle; onClose: () => void }) {
  const colors = useColors();
  const { bundle: shippable, stripped } = stripLocalUris(bundle);
  const json = exportBundleJson(shippable);
  const fits = bundleFitsQr(json);
  return (
    <Sheet title={t("appearance.shareQrTitle")} onClose={onClose}>
      <View style={{ gap: 12, alignItems: "center", paddingVertical: 8 }}>
        {fits ? (
          <View
            style={{
              padding: 16,
              borderRadius: 16,
              backgroundColor: "#ffffff",
            }}
          >
            <QRCode value={json} size={200} />
          </View>
        ) : (
          <TText style={{ color: colors.text, fontSize: 14, textAlign: "center" }}>
            {t("appearance.shareQrTooBig")}
          </TText>
        )}
        {stripped.length > 0 ? (
          <TText style={{ color: colors.muted, fontSize: 12, textAlign: "center" }}>
            {t("appearance.shareStripped")}
          </TText>
        ) : null}
        <Button small onPress={onClose}>
          {t("appearance.shareClose")}
        </Button>
      </View>
    </Sheet>
  );
}

function PasteSheet({
  onClose,
  onImport,
}: {
  onClose: () => void;
  onImport: (text: string) => void;
}) {
  const colors = useColors();
  const [text, setText] = useState("");
  return (
    <Sheet title={t("appearance.sharePasteTitle")} onClose={onClose}>
      <View style={{ gap: 12, paddingVertical: 4 }}>
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={t("appearance.sharePasteHint")}
          placeholderTextColor={colors.muted}
          style={{
            minHeight: 160,
            color: colors.text,
            fontSize: 13,
            padding: 12,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.line,
            backgroundColor: colors.card,
            textAlignVertical: "top",
          }}
        />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Button primary onPress={() => onImport(text)}>
            {t("appearance.shareDoImport")}
          </Button>
          <Button onPress={onClose}>{t("appearance.shareClose")}</Button>
        </View>
      </View>
    </Sheet>
  );
}

function ScanSheet({
  onClose,
  onImport,
}: {
  onClose: () => void;
  onImport: (text: string) => void;
}) {
  const colors = useColors();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  if (!permission) {
    return (
      <Sheet title={t("appearance.shareScanQr")} onClose={onClose}>
        <View style={{ padding: 20 }}>
          <TText style={{ color: colors.text }}>…</TText>
        </View>
      </Sheet>
    );
  }
  if (!permission.granted) {
    return (
      <Sheet title={t("appearance.shareScanQr")} onClose={onClose}>
        <View style={{ gap: 12, paddingVertical: 8 }}>
          <TText style={{ color: colors.text, fontSize: 14 }}>
            {t("appearance.shareCameraDenied")}
          </TText>
          <Button primary onPress={() => void requestPermission()}>
            {t("appearance.shareScanQr")}
          </Button>
        </View>
      </Sheet>
    );
  }
  return (
    <Sheet title={t("appearance.shareScanQr")} onClose={onClose}>
      <View style={{ gap: 12, paddingVertical: 4 }}>
        <View style={{ borderRadius: 16, overflow: "hidden" }}>
          <CameraView
            style={{ height: 320 }}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={(e) => {
              if (scanned) return;
              setScanned(true);
              onImport(e.data);
            }}
          />
        </View>
        <Pressable onPress={onClose}>
          <TText style={{ color: colors.muted, fontSize: 13, textAlign: "center" }}>
            {t("appearance.shareClose")}
          </TText>
        </Pressable>
      </View>
    </Sheet>
  );
}
