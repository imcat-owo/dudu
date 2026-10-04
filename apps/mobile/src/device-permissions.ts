import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from "expo-audio";
import * as Clipboard from "expo-clipboard";
import * as Location from "expo-location";
import * as MediaLibrary from "expo-media-library";
import * as Notifications from "expo-notifications";
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
  if (status !== "granted") throw new Error(t("perm.photoDenied"));
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
  if (status !== "granted") throw new Error(t("perm.locationDenied"));
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

/** P3-2: scanBluetoothDevices + BleDevice removed — dead exports, zero
 * callers repo-wide. BLE isn't bundled; checkBluetoothAvailable() is the
 * honest surface. */

export async function checkBluetoothAvailable(): Promise<boolean> {
  // BLE native module not bundled yet. Return false so UI shows "Unavailable".
  return false;
}

export const requesters: Record<PermissionKind, () => Promise<PermissionStatus>> = {
  audio: requestAudioPermission,
  photos: requestPhotoPermission,
  location: requestLocationPermission,
  clipboard: () => Promise.resolve<PermissionStatus>("granted"),
  notifications: requestNotificationPermission,
  // BLE module not bundled — never claim granted. UI hides the Allow button
  // for "unavailable" so this is unreachable, but honesty matters.
  bluetooth: () => Promise.resolve<PermissionStatus>("unavailable"),
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
