/**
 * Device permissions settings — her P0 permission suite UI.
 *
 * For each of the 5 out-of-app capabilities:
 *  1. System permission state (granted / denied / not asked / unavailable)
 *     - "Allow" first explains WHY (Apple HIG), then opens the iOS dialog.
 *     - Denied offers a path to iOS Settings.
 *     - Bluetooth honestly reports "unavailable" (no BLE module in this build).
 *  2. AI authorization preference: ask each time / always allow / never allow.
 *     Revocable here at any time — this is HER switch, not the AI's.
 *
 * Sora gray, compact refined type (12–14px), lucide icons only. Zero emoji.
 */

import { Bell, Bluetooth, Camera, Check, Clipboard, LocateFixed } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, View } from "react-native";
import {
  AI_AUTH_PREFERENCES,
  type AiAuthPreference,
  setAiAuthPreference,
  useAiAuthPreference,
} from "./ai-authorization";
import { CAPABILITIES, CAPABILITY_ORDER, type CapabilityId } from "./capabilities";
import { checkers, type PermissionStatus, requesters } from "./device-permissions";
import { TText } from "./font";
import { t } from "./i18n";
import { Button, Sheet, useColors, useStyles } from "./ui";

const ICONS: Record<CapabilityId, typeof Camera> = {
  bluetooth: Bluetooth,
  photos: Camera,
  location: LocateFixed,
  clipboard: Clipboard,
  notifications: Bell,
};

function statusText(status: PermissionStatus): string {
  switch (status) {
    case "granted":
      return t("perm.status.granted");
    case "denied":
      return t("perm.status.denied");
    case "unavailable":
      return t("perm.status.unavailable");
    default:
      return t("perm.status.undetermined");
  }
}

function aiAuthLabel(pref: AiAuthPreference): string {
  switch (pref) {
    case "always":
      return t("perm.aiAuth.always");
    case "never":
      return t("perm.aiAuth.never");
    default:
      return t("perm.aiAuth.ask");
  }
}

function CapabilityRow({
  id,
  status,
  busy,
  onRequest,
}: {
  id: CapabilityId;
  status: PermissionStatus;
  busy: boolean;
  onRequest: () => void;
}) {
  const colors = useColors();
  const s = useStyles();
  const def = CAPABILITIES[id];
  const Icon = ICONS[id];
  const aiPref = useAiAuthPreference(id);

  const statusColor =
    status === "granted" ? colors.green : status === "denied" ? colors.danger : colors.muted;

  return (
    <View
      style={{
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.line,
        gap: 8,
      }}
    >
      {/* Name + system status */}
      <View style={[s.between]}>
        <View style={[s.row, { gap: 10, flex: 1 }]}>
          <Icon size={18} color={colors.text} />
          <TText style={[s.text, { fontSize: 14 }]}>{t(def.nameKey)}</TText>
        </View>
        <TText style={[s.small, { color: statusColor }]}>{statusText(status)}</TText>
      </View>

      {/* What this lets the AI do (human language) */}
      <TText style={[s.small, { fontSize: 12 }]}>{t(def.aiDescriptionKey)}</TText>

      {/* System permission control */}
      <View style={[s.between]}>
        <TText style={s.small}>{t("perm.sysPerm")}</TText>
        {busy ? (
          <ActivityIndicator color={colors.blueDark} size="small" />
        ) : status === "granted" ? (
          <Check size={16} color={colors.green} />
        ) : status === "denied" ? (
          <Button small onPress={() => void Linking.openSettings()}>
            {t("perm.openSettings")}
          </Button>
        ) : status === "unavailable" ? (
          <TText style={s.small}>{t("perm.status.unavailable")}</TText>
        ) : (
          <Button small onPress={onRequest}>
            {t("common.allow")}
          </Button>
        )}
      </View>

      {/* AI authorization preference — her revocable switch */}
      <View style={[s.between]}>
        <TText style={s.small}>{t("perm.aiAuth.section")}</TText>
        <View
          style={{
            flexDirection: "row",
            borderRadius: 8,
            overflow: "hidden",
            borderWidth: 1,
            borderColor: colors.line,
          }}
        >
          {AI_AUTH_PREFERENCES.map((pref) => {
            const active = aiPref === pref;
            return (
              <Pressable
                key={pref}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => void setAiAuthPreference(id, pref)}
                style={{
                  paddingVertical: 5,
                  paddingHorizontal: 9,
                  backgroundColor: active ? colors.blueDark : "transparent",
                }}
              >
                <TText
                  style={[s.small, { fontSize: 11, color: active ? colors.onBlue : colors.muted }]}
                >
                  {aiAuthLabel(pref)}
                </TText>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

export function DevicePermissionsSheet({ onClose }: { onClose: () => void }) {
  const s = useStyles();
  const [statuses, setStatuses] = useState<Record<CapabilityId, PermissionStatus>>({
    bluetooth: "unavailable",
    photos: "undetermined",
    location: "undetermined",
    clipboard: "granted",
    notifications: "undetermined",
  });
  const [busy, setBusy] = useState<CapabilityId | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const next: Record<CapabilityId, PermissionStatus> = {
        bluetooth: "unavailable",
        photos: "undetermined",
        location: "undetermined",
        clipboard: "granted",
        notifications: "undetermined",
      };
      for (const id of CAPABILITY_ORDER) {
        try {
          next[id] = (await checkers[id]()) as PermissionStatus;
        } catch {
          next[id] = "unavailable";
        }
      }
      if (active) setStatuses(next);
    })();
    return () => {
      active = false;
    };
  }, []);

  /** Apple HIG: explain WHY before the system dialog. */
  async function requestWithRationale(id: CapabilityId) {
    const def = CAPABILITIES[id];
    const go = await new Promise<boolean>((resolve) => {
      Alert.alert(
        t("perm.whyTitle"),
        `${t(def.nameKey)}\n\n${t(def.whyKey)}`,
        [
          { text: t("perm.whyLater"), style: "cancel", onPress: () => resolve(false) },
          { text: t("perm.whyContinue"), onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
    if (!go) return;
    setBusy(id);
    try {
      const status = (await requesters[id]()) as PermissionStatus;
      setStatuses((prev) => ({ ...prev, [id]: status }));
    } catch {
      setStatuses((prev) => ({ ...prev, [id]: "unavailable" as PermissionStatus }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet title={t("perm.sheetTitle")} subtitle={t("perm.sheetSubtitle")} onClose={onClose}>
      <View>
        <TText style={[s.muted, { fontSize: 13, marginBottom: 4 }]}>{t("perm.intro")}</TText>
        {CAPABILITY_ORDER.map((id) => (
          <CapabilityRow
            key={id}
            id={id}
            status={statuses[id]}
            busy={busy === id}
            onRequest={() => void requestWithRationale(id)}
          />
        ))}
        <TText style={[s.small, { marginTop: 12, fontSize: 12 }]}>{t("perm.bluetoothNote")}</TText>
        <View style={{ height: 8 }} />
      </View>
    </Sheet>
  );
}
