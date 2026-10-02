import { Audio } from "expo-av";
import * as Clipboard from "expo-clipboard";
import * as Location from "expo-location";
import * as MediaLibrary from "expo-media-library";
import * as Notifications from "expo-notifications";
import { Alert } from "react-native";

export type PermissionKind =
  | "audio"
  | "photos"
  | "location"
  | "clipboard"
  | "notifications"
  | "bluetooth";

export type PermissionStatus = "granted" | "denied" | "undetermined" | "unavailable";

export const PERMISSION_LABELS: Record<PermissionKind, string> = {
  audio: "Microphone",
  photos: "Photo library",
  location: "Location",
  clipboard: "Clipboard",
  notifications: "Notifications",
  bluetooth: "Bluetooth",
};

function normalize(status: string | undefined): PermissionStatus {
  if (status === "granted") return "granted";
  if (status === "denied") return "denied";
  return "undetermined";
}

/** Microphone — expo-av */
export async function requestAudioPermission(): Promise<PermissionStatus> {
  try {
    const res = await Audio.requestPermissionsAsync();
    return normalize(res.status);
  } catch {
    return "unavailable";
  }
}

export async function checkAudioPermission(): Promise<PermissionStatus> {
  try {
    const res = await Audio.getPermissionsAsync();
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

/** Bluetooth — react-native-ble-plx (lazy; may be unavailable) */
export type BleDevice = { id: string; name: string | null; rssi: number | null };

export async function checkBluetoothAvailable(): Promise<boolean> {
  try {
    // Lazy: BLE native module is optional.
    require("react-native-ble-plx");
    return true;
  } catch {
    return false;
  }
}

export async function scanBluetoothDevices(timeoutMs = 8000): Promise<BleDevice[]> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { BleManager } = require("react-native-ble-plx") as typeof import("react-native-ble-plx");
  const manager = new BleManager();
  try {
    const state = await manager.state();
    if (state !== "PoweredOn") {
      throw new Error(`Bluetooth is ${state}. Turn it on and try again.`);
    }
    const found = new Map<string, BleDevice>();
    try {
      return await new Promise<BleDevice[]>((resolve, reject) => {
        const timer = setTimeout(() => {
          manager.stopDeviceScan();
          resolve([...found.values()]);
        }, timeoutMs);
        manager.startDeviceScan(null, null, (error, device) => {
          if (error) {
            clearTimeout(timer);
            reject(error);
            return;
          }
          if (device?.id && !found.has(device.id)) {
            found.set(device.id, { id: device.id, name: device.name, rssi: device.rssi });
          }
        });
      });
    } finally {
      manager.stopDeviceScan();
    }
  } finally {
    manager.destroy();
  }
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
      "Allow this action?",
      `${action}\n\n${detail}`,
      [
        { text: "Deny", style: "cancel", onPress: () => resolve(false) },
        { text: "Allow", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
