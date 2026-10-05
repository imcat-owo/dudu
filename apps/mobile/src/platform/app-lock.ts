/**
 * H8 — Face ID / Touch ID app lock.
 *
 * Fully implemented in TS via expo-local-authentication. Biometric data
 * NEVER leaves the device — iOS handles it in the Secure Enclave, we only
 * get a success/failure boolean.
 *
 * - Global app lock: require biometrics on launch / foreground.
 * - Idle re-lock: lock again after N seconds in background.
 * - Lock-on-exit: lock the moment the app backgrounds.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { type StringKey, t } from "../i18n";

const KEYS = {
  enabled: "dudu.app-lock.enabled.v1",
  idleSeconds: "dudu.app-lock.idle-seconds.v1",
  biometricType: "dudu.app-lock.biometric-type.v1",
} as const;

/** Idle timeout options. -1 = lock on background, 0 = never auto re-lock. */
export const APP_LOCK_IDLE_OPTIONS = [
  { seconds: -1, labelKey: "platform.applock.idle.onExit" },
  { seconds: 30, labelKey: "platform.applock.idle.30s" },
  { seconds: 60, labelKey: "platform.applock.idle.1m" },
  { seconds: 300, labelKey: "platform.applock.idle.5m" },
  { seconds: 900, labelKey: "platform.applock.idle.15m" },
  { seconds: 0, labelKey: "platform.applock.idle.never" },
] as const;

export type BiometricKind = "face-id" | "touch-id" | "iris" | "unknown" | "none";

async function loadAuth(): Promise<{
  isEnrolledAsync(): Promise<boolean>;
  supportedAuthenticationTypesAsync(): Promise<number[]>;
  authenticateAsync(options: {
    promptMessage: string;
    cancelLabel: string;
    disableDeviceFallback: boolean;
  }): Promise<{ success: boolean }>;
  AuthenticationType: {
    FACIAL_RECOGNITION: number;
    FINGERPRINT: number;
    IRIS: number;
  };
} | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const req = (typeof require !== "undefined" ? require : null) as
      | ((id: string) => unknown)
      | null;
    if (!req) return null;
    return req("expo-local-authentication") as {
      isEnrolledAsync(): Promise<boolean>;
      supportedAuthenticationTypesAsync(): Promise<number[]>;
      authenticateAsync(options: {
        promptMessage: string;
        cancelLabel: string;
        disableDeviceFallback: boolean;
      }): Promise<{ success: boolean }>;
      AuthenticationType: {
        FACIAL_RECOGNITION: number;
        FINGERPRINT: number;
        IRIS: number;
      };
    };
  } catch {
    return null;
  }
}

export interface AppLockState {
  enabled: boolean;
  idleSeconds: number;
  biometricKind: BiometricKind;
  enrolled: boolean;
  locked: boolean;
}

type Listener = () => void;

function createAppLockStore() {
  let state: AppLockState = {
    enabled: false,
    idleSeconds: -1,
    biometricKind: "none",
    enrolled: false,
    locked: false,
  };
  let lastUnlockedAt = 0;
  let lastBackgroundAt = 0;
  const listeners = new Set<Listener>();

  function emit() {
    for (const l of listeners) l();
  }

  function setState(patch: Partial<AppLockState>) {
    state = { ...state, ...patch };
    emit();
  }

  /** Probe device capabilities. Safe to call on any platform. */
  async function refreshCapabilities(): Promise<void> {
    try {
      const auth = await loadAuth();
      if (!auth) {
        setState({ enrolled: false, biometricKind: "none" });
        return;
      }
      const [enrolled, types] = await Promise.all([
        auth.isEnrolledAsync(),
        auth.supportedAuthenticationTypesAsync(),
      ]);
      let kind: BiometricKind = "none";
      if (types.includes(auth.AuthenticationType.FACIAL_RECOGNITION)) kind = "face-id";
      else if (types.includes(auth.AuthenticationType.FINGERPRINT)) kind = "touch-id";
      else if (types.includes(auth.AuthenticationType.IRIS)) kind = "iris";
      else if (enrolled) kind = "unknown";
      setState({ enrolled, biometricKind: kind });
    } catch {
      setState({ enrolled: false, biometricKind: "none" });
    }
  }

  async function load(): Promise<void> {
    try {
      const [e, i] = await Promise.all([
        AsyncStorage.getItem(KEYS.enabled),
        AsyncStorage.getItem(KEYS.idleSeconds),
      ]);
      setState({
        enabled: e === "1",
        idleSeconds: i == null ? -1 : Number(i),
      });
    } catch {
      /* keep defaults */
    }
    await refreshCapabilities();
    // If lock is enabled, start locked until the user authenticates.
    if (state.enabled) setState({ locked: true });
  }

  async function setEnabled(on: boolean): Promise<boolean> {
    // Enabling requires a successful biometric check first — proves the
    // user can actually unlock later.
    if (on) {
      const ok = await authenticate("platform.applock.prompt.enable");
      if (!ok) return false;
    }
    try {
      await AsyncStorage.setItem(KEYS.enabled, on ? "1" : "0");
    } catch {
      return false;
    }
    setState({ enabled: on, locked: on });
    return true;
  }

  async function setIdleSeconds(seconds: number): Promise<void> {
    try {
      await AsyncStorage.setItem(KEYS.idleSeconds, String(seconds));
    } catch {
      /* non-fatal */
    }
    setState({ idleSeconds: seconds });
  }

  /** Prompt for biometrics. Returns true on success. */
  async function authenticate(
    promptKey: StringKey = "platform.applock.prompt.unlock",
  ): Promise<boolean> {
    try {
      const auth = await loadAuth();
      if (!auth) return false;
      const result = await auth.authenticateAsync({
        promptMessage: t(promptKey),
        cancelLabel: t("common.cancel"),
        disableDeviceFallback: false,
      });
      if (result.success) {
        lastUnlockedAt = Date.now();
        setState({ locked: false });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /** Call when the app goes to background. */
  function onBackground(): void {
    lastBackgroundAt = Date.now();
    if (!state.enabled) return;
    if (state.idleSeconds === -1) {
      setState({ locked: true });
    }
  }

  /** Call when the app comes to foreground. Decides whether to re-lock. */
  function onForeground(): boolean {
    if (!state.enabled || state.locked) return state.locked;
    const idle = state.idleSeconds;
    if (idle === 0) return false;
    if (idle === -1) {
      // Already locked in onBackground.
      return true;
    }
    const awayMs = Date.now() - Math.max(lastBackgroundAt, lastUnlockedAt);
    if (awayMs >= idle * 1000) {
      setState({ locked: true });
      return true;
    }
    return false;
  }

  function lockNow(): void {
    if (state.enabled) setState({ locked: true });
  }

  return {
    subscribe(l: Listener) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    getState(): AppLockState {
      return state;
    },
    load,
    refreshCapabilities,
    setEnabled,
    setIdleSeconds,
    authenticate,
    onBackground,
    onForeground,
    lockNow,
    /** Test hook. */
    __resetForTests() {
      state = {
        enabled: false,
        idleSeconds: -1,
        biometricKind: "none",
        enrolled: false,
        locked: false,
      };
      lastUnlockedAt = 0;
      lastBackgroundAt = 0;
      emit();
    },
  };
}

export type AppLockStore = ReturnType<typeof createAppLockStore>;
export const appLockStore = createAppLockStore();
