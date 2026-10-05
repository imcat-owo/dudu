/**
 * Batch 7 I4 — standalone QR scanner ("扫一扫").
 *
 * Kelivo has a standalone qr_scan_page.dart used for importing provider
 * configs; dudu already had scan flows embedded in the API-group editor and
 * the theme share sheet, but no standalone entry. This is the standalone
 * one: scan anything and it does the sensible thing —
 * - `dudu-provider:v1:` → imports as a new API group (validated by
 *   decodeShare, same as the editor flow)
 * - theme bundle JSON → stages as try-on (same as the theme share flow)
 * - http(s) URL → shows it with copy (never auto-opens)
 * - anything else → shows the text with copy
 */

import { CameraView, useCameraPermissions } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import { Check, Copy, QrCode } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, TextInput, View } from "react-native";
import { decodeShare, payloadToGroup } from "../api-groups/sharing";
import { groupStore } from "../api-groups/store";
import { TText } from "../font";
import { t } from "../i18n";
import { radii } from "../theme/radii";
import { parseImportBundle } from "../theme/share";
import { useTheme } from "../theme/ThemeContext";
import { Button, Card, Sheet, useColors, useStyles } from "../ui";
import { hapticTap } from "./haptics";

type ScanOutcome =
  | { kind: "provider"; name: string }
  | { kind: "theme"; name: string }
  | { kind: "url"; url: string }
  | { kind: "text"; text: string }
  | { kind: "invalid" };

function classify(text: string): ScanOutcome {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "invalid" };
  const provider = decodeShare(trimmed);
  if (provider) return { kind: "provider", name: provider.name || trimmed.slice(0, 24) };
  const theme = parseImportBundle(trimmed);
  if (theme.ok) {
    const name =
      (theme.bundle.meta as { name?: string } | undefined)?.name ?? t("extras.scan.theme");
    return { kind: "theme", name };
  }
  if (/^https?:\/\/[^\s]+$/i.test(trimmed)) return { kind: "url", url: trimmed };
  return { kind: "text", text: trimmed.length > 500 ? `${trimmed.slice(0, 500)}…` : trimmed };
}

export function QrScanSheet({ onClose }: { onClose: () => void }) {
  const colors = useColors();
  const s = useStyles();
  const { stageBundle } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [paste, setPaste] = useState("");
  const [copied, setCopied] = useState(false);

  const handle = (text: string) => {
    if (scanned) return;
    setScanned(true);
    hapticTap();
    const o = classify(text);
    setOutcome(o);
    if (o.kind === "provider") {
      const payload = decodeShare(text.trim());
      if (payload) {
        const g = payloadToGroup(payload);
        void groupStore.upsert(g).catch(() => {
          setOutcome({ kind: "invalid" });
        });
      }
    } else if (o.kind === "theme") {
      const parsed = parseImportBundle(text.trim());
      if (parsed.ok) {
        stageBundle({
          ...parsed.bundle,
          meta: { ...parsed.bundle.meta, updatedAt: new Date().toISOString() },
        });
      }
    }
  };

  const copyText = (value: string) => {
    void Clipboard.setStringAsync(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const reset = () => {
    setScanned(false);
    setOutcome(null);
    setPaste("");
  };

  let body: React.ReactNode;
  if (!permission) {
    body = (
      <View style={{ padding: 20, alignItems: "center" }}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  } else if (!permission.granted) {
    body = (
      <View style={{ gap: 12, paddingVertical: 8 }}>
        <TText style={{ color: colors.text }}>{t("extras.scan.cameraDenied")}</TText>
        <Button primary onPress={() => void requestPermission()}>
          {t("extras.scan.allowCamera")}
        </Button>
      </View>
    );
  } else if (outcome) {
    body = (
      <View style={{ gap: 12, paddingVertical: 4 }}>
        <Card style={{ gap: 8, alignItems: "center", paddingVertical: 20 }}>
          {outcome.kind === "invalid" ? (
            <TText style={{ color: colors.text, textAlign: "center" }}>
              {t("extras.scan.invalid")}
            </TText>
          ) : (
            <>
              <Check size={28} color={colors.blueDark} />
              <TText style={{ color: colors.text, textAlign: "center", fontSize: 15 }}>
                {outcome.kind === "provider" &&
                  t("extras.scan.providerImported", { name: outcome.name })}
                {outcome.kind === "theme" && t("extras.scan.themeStaged", { name: outcome.name })}
                {outcome.kind === "url" && t("extras.scan.urlFound")}
                {outcome.kind === "text" && t("extras.scan.textFound")}
              </TText>
              {(outcome.kind === "url" || outcome.kind === "text") && (
                <TText
                  style={{ color: colors.muted, textAlign: "center", fontSize: 13 }}
                  numberOfLines={3}
                >
                  {outcome.kind === "url" ? outcome.url : outcome.text}
                </TText>
              )}
              {outcome.kind === "theme" && (
                <TText style={[s.small, { color: colors.muted, textAlign: "center" }]}>
                  {t("extras.scan.themeTryOn")}
                </TText>
              )}
            </>
          )}
        </Card>
        {(outcome.kind === "url" || outcome.kind === "text") && (
          <Button
            small
            icon={copied ? Check : Copy}
            onPress={() =>
              copyText(outcome.kind === "url" ? outcome.url : (outcome as { text: string }).text)
            }
          >
            {copied ? t("extras.scan.copied") : t("common.copy")}
          </Button>
        )}
        <Button small onPress={reset}>
          {t("extras.scan.scanAgain")}
        </Button>
      </View>
    );
  } else {
    body = (
      <View style={{ gap: 12, paddingVertical: 4 }}>
        <View style={{ borderRadius: radii.lg, overflow: "hidden" }}>
          <CameraView
            style={{ height: 300 }}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={(e) => handle(e.data)}
          />
        </View>
        <TText style={[s.small, { color: colors.muted, textAlign: "center" }]}>
          {t("extras.scan.hint")}
        </TText>
        <TextInput
          style={[s.input, { minHeight: 64, textAlignVertical: "top" }]}
          value={paste}
          onChangeText={setPaste}
          placeholder={t("extras.scan.pastePh")}
          placeholderTextColor={colors.muted}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button small disabled={!paste.trim()} onPress={() => handle(paste)}>
          {t("extras.scan.handle")}
        </Button>
      </View>
    );
  }

  return (
    <Sheet title={t("extras.scan.title")} onClose={onClose}>
      {body}
    </Sheet>
  );
}

export function QrScanButton() {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Button
        icon={QrCode}
        onPress={() => {
          hapticTap();
          setOpen(true);
        }}
      >
        {t("extras.scan.title")}
      </Button>
      {open && <QrScanSheet onClose={() => setOpen(false)} />}
    </View>
  );
}
