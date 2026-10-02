import { Bluetooth, Camera, Clipboard, LocateFixed, Mic, Bell } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import {
  checkers,
  PERMISSION_LABELS,
  type PermissionKind,
  type PermissionStatus,
  requesters,
} from "./device-permissions";
import { Button, colors, Sheet, s } from "./ui";

const ICONS: Record<PermissionKind, typeof Mic> = {
  audio: Mic,
  photos: Camera,
  location: LocateFixed,
  clipboard: Clipboard,
  notifications: Bell,
  bluetooth: Bluetooth,
};

const ORDER: PermissionKind[] = [
  "audio",
  "photos",
  "location",
  "clipboard",
  "notifications",
  "bluetooth",
];

function statusText(status: PermissionStatus): string {
  switch (status) {
    case "granted":
      return "Allowed";
    case "denied":
      return "Denied";
    case "unavailable":
      return "Unavailable";
    default:
      return "Not asked";
  }
}

export function DevicePermissionsSheet({ onClose }: { onClose: () => void }) {
  const [statuses, setStatuses] = useState<Record<PermissionKind, PermissionStatus>>({
    audio: "undetermined",
    photos: "undetermined",
    location: "undetermined",
    clipboard: "granted",
    notifications: "undetermined",
    bluetooth: "undetermined",
  });
  const [busy, setBusy] = useState<PermissionKind | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const next = { ...statuses };
      for (const kind of ORDER) {
        try {
          next[kind] = await checkers[kind]();
        } catch {
          next[kind] = "unavailable";
        }
      }
      if (active) setStatuses(next);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function request(kind: PermissionKind) {
    setBusy(kind);
    try {
      const status = await requesters[kind]();
      setStatuses((prev) => ({ ...prev, [kind]: status }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet title="设备权限" subtitle="What the assistant may access" onClose={onClose}>
      <View style={{ gap: 4 }}>
        <Text style={s.muted}>
          助手在 App 内有完整权限。跨出 App 的ing the app boundary asks
          you first.
        </Text>
        {ORDER.map((kind) => {
          const Icon = ICONS[kind];
          const status = statuses[kind];
          return (
            <View
              key={kind}
              style={[
                s.between,
                {
                  paddingVertical: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.line,
                },
              ]}
            >
              <View style={[s.row, { gap: 12, flex: 1 }]}>
                <Icon size={19} color={colors.text} />
                <View style={{ flex: 1 }}>
                  <Text style={s.text}>{PERMISSION_LABELS[kind]}</Text>
                  <Text style={s.small}>{statusText(status)}</Text>
                </View>
              </View>
              {busy === kind ? (
                <ActivityIndicator color={colors.blueDark} />
              ) : (
                status !== "granted" &&
                status !== "unavailable" && (
                  <Button small onPress={() => void request(kind)}>
                    Allow
                  </Button>
                )
              )}
            </View>
          );
        })}
        <Text style={[s.small, { marginTop: 12 }]}>
          蓝牙扫描需要系统蓝牙权限 first use.
        </Text>
      </View>
    </Sheet>
  );
}
