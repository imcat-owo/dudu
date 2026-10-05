/**
 * AppLockGate — single source of truth for the Face ID / Touch ID app lock.
 *
 * B1: the lock gate used to live inside WorkspaceApp (cloud mode only), so
 * the default local mode never hit it — the settings toggle was decoration.
 * The gate now wraps the whole app ABOVE the mode branch in App.tsx, so
 * neither mode can bypass it.
 *
 * When locked, renders the lock screen instead of any app content (chat,
 * our-space, settings — everything). Biometrics never leave the device.
 */

import { type ReactNode, useEffect, useSyncExternalStore } from "react";
import { AppState, Text } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { t } from "../i18n";
import { Button, Mascot, useColors, useStyles } from "../ui";
import { appLockStore } from "./app-lock";

export function AppLockGate({ children }: { children: ReactNode }) {
  const colors = useColors();
  const s = useStyles();
  const lockState = useSyncExternalStore(appLockStore.subscribe, appLockStore.getState);

  // Load persisted settings once. If the lock is enabled, the store starts
  // locked until the user authenticates.
  useEffect(() => {
    void appLockStore.load();
  }, []);

  // Re-evaluate the lock on foreground / background transitions.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        appLockStore.onForeground();
      } else if (state === "background") {
        appLockStore.onBackground();
      }
    });
    return () => sub.remove();
  }, []);

  if (lockState.enabled && lockState.locked) {
    return (
      <SafeAreaProvider>
        <SafeAreaView
          style={{
            flex: 1,
            backgroundColor: colors.canvas,
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            gap: 16,
          }}
        >
          <Mascot size={56} />
          <Text style={{ fontSize: 22, color: colors.text, fontWeight: "500" }}>
            {t("platform.applock.locked.title")}
          </Text>
          <Text style={[s.muted, { textAlign: "center" }]}>
            {t("platform.applock.locked.hint")}
          </Text>
          <Button primary onPress={() => void appLockStore.authenticate()}>
            {t("platform.applock.unlock")}
          </Button>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }
  return <>{children}</>;
}
