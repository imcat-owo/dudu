import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
} from "expo-audio";
import * as Clipboard from "expo-clipboard";
import * as Location from "expo-location";
import * as MediaLibrary from "expo-media-library";
import * as Notifications from "expo-notifications";
import { Alert } from "react-native";
import { t } from "./i18n";

export type PermissionKind =
  | "audio"
  | "photos"
  | "location"
  | "clipboard"
  | "notifications"
  | "bluetooth";

export type PermissionStatus = "granted" | "denied" | "undetermined" | "unavailable";

export const PERMISSION_LABELS: Record<PermissionKind, string> = {
  audio: t("perm.kind.audio"),
  photos: t("perm.kind.photos"),
  location: t("perm.kind.location"),
  clipboard: t("perm.kind.clipboard"),
  notifications: t("perm.kind.notifications"),
  bluetooth: t("perm.kind.bluetooth"),
};

function normalize(status: string | undefined): PermissionStatus {
  if (status === "granted") return "granted";
  if (status === "denied") return "denied";
  return "undetermined";
}

/** Microphone — expo-audio */
export async function requestAudioPermission(): Promise<PermissionStatus> {
  try {
    const res = await requestRecordingPermissionsAsync();
    return normalize(res.status);
  } catch {
    return "unavailable";
  }
}

export async function checkAudioPermission(): Promise<PermissionStatus> {
  try {
    const res = await getRecordingPermissionsAsync();
    return normalize(res.status);
  } catch {
    return "unavailable";
  }
}

/** Photo library — expo-media-library */
export async function requestPhotoPermission(): Promise<PermissionStatus> {
  try {
    const res = await MediaLibrary.requestPermissionsAsync();
    return normalize(res.status);
  } catch {
    return "unavailable";
  }
}

export async function checkPhotoPermission(): Promise<PermissionStatus> {
  try {
    const res = await MediaLibrary.getPermissionsAsync();
    return normalize(res.status);
  } catch {
    return "unavailable";
  }
}

export async function readRecentPhotos(limit = 10): Promise<{ uri: string; id: string }[]> {
  const { status } = await MediaLibrary.requestPermissionsAsync();
  if (status !== "granted") throw new Error("Photo library permission denied.");
  const result = await MediaLibrary.getAssetsAsync({
    first: limit,
    sortBy: ["creationTime"],
    mediaType: ["photo"],
  });
  return result.assets.map((a) => ({ uri: a.uri, id: a.id }));
}

/** Location — expo-location */
export async function requestLocationPermission(): Promise<PermissionStatus> {
  try {
    const res = await Location.requestForegroundPermissionsAsync();
    return normalize(res.status);
  } catch {
    return "unavailable";
  }
}

export async function checkLocationPermission(): Promise<PermissionStatus> {
  try {
    const res = await Location.getForegroundPermissionsAsync();
    return normalize(res.status);
  } catch {
    return "unavailable";
  }
}

export async function readLocation(): Promise<{ latitude: number; longitude: number }> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") throw new Error("Location permission denied.");
  const pos = await Location.getCurrentPositionAsync({});
  return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
}

/** Clipboard — expo-clipboard (no permission prompt needed on iOS) */
export async function readClipboard(): Promise<string> {
  return Clipboard.getStringAsync();
}

export async function writeClipboard(text: string): Promise<void> {
  await Clipboard.setStringAsync(text);
}

/** Notifications — expo-notifications */
export async function requestNotificationPermission(): Promise<PermissionStatus> {
  try {
    const res = await Notifications.requestPermissionsAsync();
    return normalize(res.status);
  } catch {
    return "unavailable";
  }
}

export async function checkNotificationPermission(): Promise<PermissionStatus> {
  try {
    const res = await Notifications.getPermissionsAsync();
    return normalize(res.status);
  } catch {
    return "unavailable";
  }
}

/** Bluetooth — not yet implemented (requires native BLE module). */
export type BleDevice = { id: string; name: string | null; rssi: number | null };

export async function checkBluetoothAvailable(): Promise<boolean> {
  // BLE native module not bundled yet. Return false so UI shows "Unavailable".
  return false;
}

export async function scanBluetoothDevices(timeoutMs = 8000): Promise<BleDevice[]> {
  throw new Error("Bluetooth scanning is not available in this build.");
}

export const requesters: Record<PermissionKind, () => Promise<PermissionStatus>> = {
  audio: requestAudioPermission,
  photos: requestPhotoPermission,
  location: requestLocationPermission,
  clipboard: () => Promise.resolve<PermissionStatus>("granted"),
  notifications: requestNotificationPermission,
  bluetooth: () => Promise.resolve<PermissionStatus>("granted"),
};

export const checkers: Record<PermissionKind, () => Promise<PermissionStatus>> = {
  audio: checkAudioPermission,
  photos: checkPhotoPermission,
  location: checkLocationPermission,
  clipboard: () => Promise.resolve<PermissionStatus>("granted"),
  notifications: checkNotificationPermission,
  bluetooth: () =>
    checkBluetoothAvailable().then((ok) =>
      ok ? ("undetermined" as PermissionStatus) : ("unavailable" as PermissionStatus),
    ),
};

/**
 * Permission model: the AI has full access to in-app capabilities.
 * Anything crossing the app boundary (photos, location, bluetooth, sharing
 * outward) requires an explicit user confirmation popup first.
 */
export function confirmBoundaryAction(action: string, detail: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      t("perm.confirmAction"),
      `${action}\n\n${detail}`,
      [
        { text: t("common.deny"), style: "cancel", onPress: () => resolve(false) },
        { text: t("common.allow"), onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
