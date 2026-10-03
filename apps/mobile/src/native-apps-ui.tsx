/**
 * 原生应用授权 (Native App Authorizations) — settings UI.
 *
 * Lists every iOS-native capability third-party apps can request
 * authorization for via public API. Each row shows the honest auth state:
 * - granted / denied (→ iOS Settings) / undetermined (→ Allow button)
 * - unavailable (native module missing in this build)
 * - needs-setup (she must do something outside the app first)
 *
 * Apple Music links to the music room instead of duplicating logic.
 * Sora gray, compact refined type, lucide icons only. Zero emoji.
 */

import {
  AudioWaveform,
  BellRing,
  Calendar,
  Check,
  CloudSun,
  HeartPulse,
  House,
  Mic,
  Music,
  Users,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, View } from "react-native";
import { TText } from "./font";
import { type StringKey, t } from "./i18n";
import {
  checkers,
  NATIVE_APP_ORDER,
  NATIVE_APPS,
  type NativeAppId,
  type NativeAppStatus,
  requesters,
} from "./native-apps";
import { Button, useColors, useStyles } from "./ui";

const ICONS: Record<NativeAppId, typeof Music> = {
  "apple-music": Music,
  calendar: Calendar,
  reminders: BellRing,
  contacts: Users,
  healthkit: HeartPulse,
  homekit: House,
  siri: Mic,
  weather: CloudSun,
  shazam: AudioWaveform,
};

function statusText(status: NativeAppStatus): string {
  switch (status) {
    case "granted":
      return t("napp.status.granted");
    case "denied":
      return t("napp.status.denied");
    case "unavailable":
      return t("napp.status.unavailable");
    case "needs-setup":
      return t("napp.status.needsSetup");
    default:
      return t("napp.status.undetermined");
  }
}

function NativeAppRow({
  id,
  status,
  busy,
  onRequest,
}: {
  id: NativeAppId;
  status: NativeAppStatus;
  busy: boolean;
  onRequest: () => void;
}) {
  const colors = useColors();
  const s = useStyles();
  const def = NATIVE_APPS[id];
  const Icon = ICONS[id];

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
      {/* Name + status */}
      <View style={[s.between]}>
        <View style={[s.row, { gap: 10, flex: 1 }]}>
          <Icon size={18} color={colors.text} />
          <TText style={[s.text, { fontSize: 14 }]}>{t(def.nameKey as StringKey)}</TText>
        </View>
        <TText style={[s.small, { color: statusColor }]}>{statusText(status)}</TText>
      </View>

      {/* What this is for (human language) */}
      <TText style={[s.small, { fontSize: 12 }]}>{t(def.descKey as StringKey)}</TText>

      {/* Setup instructions (unwired capabilities) */}
      {def.setupKey && (status === "needs-setup" || status === "unavailable") && (
        <TText style={[s.small, { fontSize: 12, color: colors.muted }]}>
          {t(def.setupKey as StringKey)}
        </TText>
      )}

      {/* Authorization control */}
      <View style={[s.between]}>
        <TText style={s.small}>{t("napp.sysAuth")}</TText>
        {busy ? (
          <ActivityIndicator color={colors.blueDark} size="small" />
        ) : status === "granted" ? (
          <Check size={16} color={colors.green} />
        ) : status === "denied" ? (
          <Button small onPress={() => void Linking.openSettings()}>
            {t("napp.openSettings")}
          </Button>
        ) : status === "unavailable" || status === "needs-setup" || !def.wired ? (
          <TText style={s.small}>{statusText(status)}</TText>
        ) : (
          <Button
            small
            onPress={() => {
              // Apple HIG: explain WHY before the system prompt.
              Alert.alert(t(def.nameKey as StringKey), t(def.descKey as StringKey), [
                { text: t("common.cancel"), style: "cancel" },
                { text: t("common.allow"), onPress: onRequest },
              ]);
            }}
          >
            {t("common.allow")}
          </Button>
        )}
      </View>
    </View>
  );
}

export function NativeAppsSheet({ onClose }: { onClose: () => void }) {
  const s = useStyles();
  const [statuses, setStatuses] = useState<Record<NativeAppId, NativeAppStatus>>(
    Object.fromEntries(
      NATIVE_APP_ORDER.map((id) => [id, "undetermined" as NativeAppStatus]),
    ) as Record<NativeAppId, NativeAppStatus>,
  );
  const [busy, setBusy] = useState<NativeAppId | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const next = {} as Record<NativeAppId, NativeAppStatus>;
      for (const id of NATIVE_APP_ORDER) {
        try {
          next[id] = await checkers[id]();
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

  const handleRequest = async (id: NativeAppId) => {
    setBusy(id);
    try {
      const status = await requesters[id]();
      setStatuses((prev) => ({ ...prev, [id]: status }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ gap: 4 }}>
      <TText style={[s.small, { marginBottom: 8 }]}>{t("napp.intro")}</TText>
      {NATIVE_APP_ORDER.map((id) => (
        <NativeAppRow
          key={id}
          id={id}
          status={statuses[id]}
          busy={busy === id}
          onRequest={() => void handleRequest(id)}
        />
      ))}
    </View>
  );
}
